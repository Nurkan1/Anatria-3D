import { memo, useCallback, useMemo } from "react";
import * as THREE from "three";

import { GHOST_CLICK_THROUGH, type PathologyOverlay } from "@/stores/sceneStore";

import { shouldSuppressClick } from "./areaSelect";
import { coverageColour } from "./coverage";
import { probeGlow, reportDepthStack, stackFromCrossings } from "./depthStack";
import type { ManifestOrgan } from "@/lib/schemas";

import {
  tissueColour,
  tissueDepthBias,
  tissueOpacity,
  tissueRoughness,
} from "./palette";

/** Mid-severity overlay. */
const AMBER = new THREE.Color("#e8a33d");
/** Full-severity overlay. */
const CRIMSON = new THREE.Color("#c62828");
/** Selection accent, matching the brand cyan. */
const SELECTED = new THREE.Color("#00a8e8");

/**
 * The light the cursor casts into the body.
 *
 * A warm near-white rather than another accent colour, and that is the whole
 * design: cyan would read as "selected", amber as "diseased". Warm white reads
 * as *illuminated* — something a lamp is falling on, not something the app has
 * marked. Which is exactly what it is.
 */
const PROBE_LIGHT = new THREE.Color("#ffe8c4");

/** Opting a mesh out of raycasting entirely. */
const NO_RAYCAST = () => null;
/** three.js's default mesh raycast, named so it can be restored explicitly. */
const DEFAULT_RAYCAST = THREE.Mesh.prototype.raycast;

/**
 * Severity maps tissue -> amber -> crimson rather than tissue -> crimson, so
 * the low end of the scale stays visually distinct instead of washing out into
 * a barely-tinted red.
 *
 * It starts from the structure's own tissue colour, which is what keeps a mild
 * overlay reading as *that organ, affected* rather than as a generic red blob:
 * a lightly infarcted myocardium and a lightly inflamed lung should not arrive
 * at the same pixel.
 */
function pathologyColour(tissue: THREE.Color, severity: number): THREE.Color {
  const clamped = Math.min(Math.max(severity, 0), 1);
  return clamped <= 0.5
    ? tissue.clone().lerp(AMBER, clamped * 2)
    : AMBER.clone().lerp(CRIMSON, (clamped - 0.5) * 2);
}

interface OrganMeshProps {
  organ: ManifestOrgan;
  geometry: THREE.BufferGeometry;
  /** Node transform from the glTF — organs are placed in body space. */
  matrix: THREE.Matrix4;
  visible: boolean;
  /** 1 is solid; below that the structure is ghosted. */
  opacity: number;
  hovered: boolean;
  selected: boolean;
  overlay: PathologyOverlay | undefined;
  /**
   * How much this structure has been studied, when the revision map is on.
   * `undefined` means the map is off — which is not the same as never studied,
   * and the two must not be confused into the same colour.
   *
   * Two numbers rather than one object, because this component is memoised and
   * an object prop would be a fresh identity on every render.
   */
  coverageTouches: number | undefined;
  /** The busiest structure in the journal, which sets the top of the ramp. */
  coverageBusiest: number | undefined;
  /**
   * How far down the cursor's column this structure sits — 0 is the surface.
   * `undefined` means the ray never reached it.
   */
  probeDepth: number | undefined;
  clippingPlanes: THREE.Plane[];
  onHover: (organId: string | null) => void;
  onSelect: (organId: string, additive: boolean) => void;
  /** Double-click: isolate for study. `additive` extends the current set. */
  onStudy: (organId: string, additive: boolean) => void;
  /** Everything the pointer's ray crossed, nearest first. */
  onProbe: (organIds: string[]) => void;
  onContextMenu: (organId: string, x: number, y: number) => void;
  /**
   * Hands the live mesh and its resting transform to whoever animates the
   * exploded view. Called with `null` on unmount.
   *
   * The displacement is applied by mutating `mesh.matrix` from one loop rather
   * than by re-rendering with a new matrix, for the reason the eye and the
   * pathway marker are also imperative: it changes every frame, and routing it
   * through React would re-render the scene graph sixty times a second.
   */
  onRegister?: (organId: string, mesh: THREE.Mesh | null, base: THREE.Matrix4) => void;
}

/**
 * Memoised, and it is load-bearing rather than a micro-optimisation.
 *
 * The atlas puts three and a half thousand of these on screen, and their parent
 * re-renders on **every pointer move that changes what is hovered** — which,
 * moving across a body, is most of them. Unmemoised, one mouse movement was
 * three and a half thousand component invocations, each running its own memo
 * comparisons and callbacks. That is the difference between this being pleasant
 * on a modest laptop and being unusable on one.
 *
 * The default shallow comparison is enough *because every prop is either a
 * primitive or a stable reference*: geometries and matrices come from memoised
 * maps, the callbacks are store actions or `useCallback`, and the coverage
 * numbers are passed as two scalars for exactly this reason. Any prop built
 * inline in the parent silently switches this off for every structure at once —
 * which is what `onStudy` was doing.
 */
export const OrganMesh = memo(function OrganMesh({
  organ,
  geometry,
  matrix,
  visible,
  opacity: layerOpacity,
  hovered,
  selected,
  overlay,
  coverageTouches,
  coverageBusiest,
  probeDepth,
  clippingPlanes,
  onHover,
  onSelect,
  onStudy,
  onProbe,
  onContextMenu,
  onRegister,
}: OrganMeshProps) {
  // Memoised so React does not detach and reattach the ref on every render —
  // with thousands of meshes on screen, an inline callback would churn the
  // registry each time anything was hovered.
  const register = useCallback(
    (mesh: THREE.Mesh | null) => onRegister?.(organ.organ_id, mesh, matrix),
    [onRegister, organ.organ_id, matrix],
  );
  const userData = useMemo(() => ({ organId: organ.organ_id }), [organ.organ_id]);

  // The reader's ghosting, times the tissue's own transparency. A cornea is
  // see-through whatever the reader has done to the nervous system, and
  // ghosting that system has to still work on top of it.
  const opacity = layerOpacity * tissueOpacity(organ);
  /** See-through enough that the pointer belongs to whatever is behind it. */
  const clickThrough = opacity < GHOST_CLICK_THROUGH;
  const ghosted = opacity < 1;
  const depthBias = tissueDepthBias(organ);
  const { color, emissive, emissiveIntensity } = useMemo(() => {
    // The revision map replaces the tissue colour outright rather than tinting
    // it. Mixing the two would make "muscle I have studied" and "bone I have
    // glanced at" arrive at similar pixels, and the whole value of the map is
    // that the shape of your own attention is legible at a glance.
    const tissue =
      coverageTouches !== undefined && coverageBusiest !== undefined
        ? coverageColour(coverageTouches, coverageBusiest)
        : tissueColour(organ);
    const base = overlay ? pathologyColour(tissue, overlay.severity) : tissue;
    /*
     * Selection tints the tissue rather than washing light over it.
     *
     * The old treatment added a saturated emissive at 0.55, which on a small
     * structure looked fine and on a large one was a disaster: select a
     * ventricle, fill the screen with it, and the whole view turns flat cyan.
     * Emissive is *added after lighting*, so it erases exactly what carries
     * form — the shading, the specular, the groove between two parts.
     *
     * Mixing the colour instead keeps every one of those. The structure is
     * unmistakably picked out, and it still reads as a shaded object made of
     * something. The small emissive on top is what makes a selection in deep
     * shadow still announce itself.
     */
    if (selected) {
      return {
        color: base.clone().lerp(SELECTED, 0.5),
        emissive: SELECTED,
        emissiveIntensity: 0.14,
      };
    }
    if (hovered) {
      return {
        color: base.clone().lerp(SELECTED, 0.24),
        emissive: SELECTED,
        emissiveIntensity: 0.07,
      };
    }
    if (overlay) {
      // Pathology glows on its own so it stays legible when the organ is
      // neither hovered nor selected — that is the whole point of the overlay.
      //
      // It also outranks the cursor's light below. An overlay is a statement
      // about the anatomy; the light is a statement about where a hand happens
      // to be, and when the two disagree the anatomy wins. The structure is
      // still named in the panel, so nothing is lost by it.
      return {
        color: base,
        emissive: base,
        emissiveIntensity: 0.15 + overlay.severity * 0.35,
      };
    }
    /*
     * Lit by the cursor, falling off with depth.
     *
     * Emissive here, where selection deliberately avoids it. Selection had to
     * preserve the shading that carries an organ's form; this is a *light*, and
     * a light is added after shading — that is what it means. It also only
     * becomes visible when you can see through what is in front, which is
     * exactly when it is wanted: solid, everything past the first layer is
     * hidden anyway, so the effect costs nothing and shows nothing.
     */
    if (probeDepth !== undefined) {
      const glow = probeGlow(probeDepth);
      if (glow > 0) {
        return {
          color: base,
          emissive: PROBE_LIGHT,
          emissiveIntensity: 0.08 + glow * 0.5,
        };
      }
    }
    return { color: base, emissive: tissue, emissiveIntensity: 0 };
  }, [organ, hovered, selected, overlay, coverageTouches, coverageBusiest, probeDepth]);

  return (
    <mesh
      ref={register}
      geometry={geometry}
      // The glTF node transform positions the organ within the body. Driving
      // it from the matrix directly (rather than decomposed TRS) keeps any
      // shear or non-uniform scale the export produced.
      matrix={matrix}
      matrixAutoUpdate={false}
      visible={visible}
      // Which structure the organ *is*, readable from a raw intersection. The
      // depth stack walks a list of meshes it has no React context for, and
      // this is the only thing tying one back to the atlas.
      userData={userData}
      // Raycasting against an invisible mesh would still report hits, so hidden
      // organs must stop receiving pointer events, or an isolated view would
      // keep selecting the things it is hiding.
      //
      // Ghosted structures *do* still receive them, and that is a change: they
      // used to be excluded here. Click-through is still exactly as it was —
      // if you can see through it you can click through it — but it is now the
      // handlers that step aside rather than the ray, because a ray that never
      // reaches the skin cannot report that the skin is there. The depth stack
      // needs the whole crossing, ghosted layers included.
      raycast={visible ? DEFAULT_RAYCAST : NO_RAYCAST}
      onPointerMove={(event) => {
        // The frontmost crossing owns the reading, and it is the only handler
        // that sees the full list — `intersections` is every mesh the ray met,
        // sorted by distance. Stopping here keeps the ones behind from each
        // recomputing the same answer.
        event.stopPropagation();
        reportDepthStack();
        onProbe(stackFromCrossings(event.intersections));
      }}
      onPointerOver={(event) => {
        // No `stopPropagation` when ghosted: the event carries on to the next
        // structure along the ray, so what gets hovered is the first thing you
        // could actually pick — which is what it was before.
        if (clickThrough) return;
        event.stopPropagation();
        onHover(organ.organ_id);
      }}
      onPointerOut={(event) => {
        if (clickThrough) return;
        event.stopPropagation();
        onHover(null);
      }}
      onClick={(event) => {
        if (clickThrough) return;
        event.stopPropagation();
        // A loop that finished over this structure must not also select it —
        // R3F raises `click` on pointer-up however far the pointer travelled.
        if (shouldSuppressClick()) return;
        // Ctrl/Cmd builds a set; a plain click replaces it. This is the gesture
        // every file manager and design tool already trained people on.
        onSelect(organ.organ_id, event.ctrlKey || event.metaKey);
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        onContextMenu(organ.organ_id, event.clientX, event.clientY);
      }}
      onDoubleClick={(event) => {
        // Single click selects; double click enters study mode — the structure
        // alone, centred. Holding shift or ctrl adds to the set instead of
        // replacing it, which is how you build up a group to compare.
        event.stopPropagation();
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        onStudy(organ.organ_id, additive);
      }}
    >
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={tissueRoughness(organ.system)}
        metalness={0.05}
        transparent={ghosted}
        opacity={opacity}
        // The detail that makes layered ghosting work instead of producing the
        // spattered mess an earlier build had. Transparent meshes render in a
        // pass sorted back-to-front *per object*, which cannot be right for
        // thousands of interpenetrating structures. Letting them write depth
        // makes them occlude each other in that arbitrary order; not writing it
        // makes them accumulate instead — which is exactly the X-ray look.
        //
        // Solid meshes still write depth, so a ghosted layer never hides a
        // solid one behind it.
        depthWrite={!ghosted}
        // Sheets that lie flat on other tissue — see `tissueDepthBias`.
        polygonOffset={depthBias !== 0}
        polygonOffsetFactor={depthBias}
        polygonOffsetUnits={depthBias}
        clippingPlanes={clippingPlanes}
        // Without this the cut face of a clipped organ is invisible, and the
        // section reads as a hollow shell rather than a cut through tissue.
        side={clippingPlanes.length > 0 ? THREE.DoubleSide : THREE.FrontSide}
      />
    </mesh>
  );
});
