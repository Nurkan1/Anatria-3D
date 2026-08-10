import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { GHOST_CLICK_THROUGH, type PathologyOverlay } from "@/stores/sceneStore";

import { shouldSuppressClick } from "./areaSelect";
import { coverageColour } from "./coverage";
import { scanColour } from "./scan";
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

/**
 * The colour the assistant marks what it is explaining.
 *
 * # Why green, when warm would carry further
 *
 * Against the grey of a scanned body a warm colour would stand out best, and
 * that was the first instinct. It is not available. **Amber is what mild
 * pathology looks like** — `AMBER` below is the low end of the severity ramp —
 * so a healthy artery marked in orange would be wearing the appearance of a
 * diseased one. In an atlas for medical students that is not a clash of taste,
 * it is a false statement about anatomy, and no amount of legend fixes a colour
 * that says the wrong thing before anyone reads the legend.
 *
 * Everything else is spoken for too: cyan is the reader's selection, violet a
 * traced pathway, crimson severe disease, warm cream the cursor's own light,
 * and the slate-to-mint ramp the revision map.
 *
 * Green is the one meaning left unclaimed, and it happens to be the right
 * answer anyway — near enough the complement of the blue-grey a scanned body
 * settles into that it separates from it harder than a warm colour would, and
 * it carries no clinical reading at all.
 */
const LIT_LIGHT = new THREE.Color("#35e07a");

/**
 * How strongly the assistant's light burns, against the cursor's.
 *
 * Brighter on purpose. The cursor's light is ambient feedback that follows a
 * hand around and must not shout; this one marks the single structure a
 * sentence is about, and it has to survive being read past.
 */
const LIT_FLOOR = 0.22;
const LIT_RANGE = 0.75;

/**
 * How strongly the buried part of a lit structure shows through the body.
 *
 * # Why brightness alone could never have worked
 *
 * Emissive is a property of a fragment, and a fragment behind the ribs is never
 * drawn. The pulmonary arteries sit under the sternum, the ribs, the pectoral
 * muscles and the skin; you can raise their emissive to any number you like and
 * the pixel on screen still belongs to the rib in front. The assistant was
 * naming structures the reader had no way to find.
 *
 * # What is drawn instead
 *
 * A second pass over the same geometry with `depthFunc: GreaterDepth` — which
 * inverts the usual test, so it paints **only where the structure is behind
 * something else**. The part you can already see is left alone, because there
 * the depth is equal rather than greater and the test fails.
 *
 * So the structure keeps its ordinary shading where it is visible, and shows as
 * a luminous silhouette exactly where it is hidden. Nothing is moved and
 * nothing is drawn in front of where it really is: the ghost appears *at* the
 * structure's own depth. A reader can tell the two apart, which is the honest
 * part — the silhouette says "behind this", not "here".
 *
 * # Why not the obvious alternatives
 *
 * `depthTest: false` would draw the whole structure over everything, which is
 * cheaper and says something false: an aorta floating in front of the sternum.
 * Bloom would need a post-processing pass across the whole scene, which is a
 * dependency, a frame cost on an 8 GB laptop, and the sort of thing that
 * behaves differently under WebKitGTK than under Chromium. This is core depth
 * state, one extra draw for the handful of structures a sentence names, and
 * identical on both platforms.
 *
 * It also switches itself off when it is not needed: with the body in glass,
 * nothing opaque writes depth, so nothing tests as occluded and no silhouette
 * is drawn.
 */
const OCCLUDED_FLOOR = 0.16;
const OCCLUDED_RANGE = 0.34;

/**
 * How solid a marked structure stays when the body around it is ghosted.
 *
 * # The thing brightness could not fix
 *
 * Ghosting multiplies every structure's opacity, and it does not ask which one
 * is being explained. In the glass body everything drops to a tenth — including
 * the aorta the assistant just named, which then contributes a tenth of each
 * pixel it covers and competes with twenty other veils for the rest. Draining
 * the colour from the body helped and could not finish the job: the marked
 * structure was still nine parts transparent.
 *
 * So a marked structure keeps its own opacity instead of inheriting the
 * reader's ghosting. The body turns to glass; what is being talked about stays
 * substantial. That is what makes the two modes work together rather than
 * cancel.
 *
 * # Why the two floors differ
 *
 * The assistant lights the handful of structures one sentence is about, and
 * they can afford to be nearly solid. A selection can be anything — a whole
 * region gathered for study — and holding all of it at that opacity would put
 * the glass body back where it started.
 *
 * Both are floors, never ceilings: neither can make a structure *more*
 * transparent than the reader asked for, and in a solid body both are inert.
 */
const LIT_MIN_OPACITY = 0.92;
const SELECTED_MIN_OPACITY = 0.55;

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
  /**
   * Where this structure sits in what the assistant has lit — 0 is the first it
   * named. `undefined` means the assistant is not pointing at it.
   */
  litDepth: number | undefined;
  /**
   * Drain this structure's colour: the body is scanned and this one is not
   * what is being looked at. Resolved in the parent so the rule lives in one
   * place rather than three thousand.
   */
  scanned: boolean;
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
  litDepth,
  scanned,
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

  /** How brightly the assistant is lighting this one, 0 when it is not. */
  const litGlow = litDepth !== undefined ? probeGlow(litDepth) : 0;

  // The reader's ghosting, times the tissue's own transparency. A cornea is
  // see-through whatever the reader has done to the nervous system, and
  // ghosting that system has to still work on top of it.
  //
  // Then lifted back up if this is a structure being pointed at — see
  // `LIT_MIN_OPACITY`. A floor, so it can only ever make something *less*
  // transparent than the ghosting asked for, and in a solid body it does
  // nothing at all.
  const opacity = Math.max(
    layerOpacity * tissueOpacity(organ),
    litGlow > 0 ? LIT_MIN_OPACITY : 0,
    selected ? SELECTED_MIN_OPACITY : 0,
  );
  /** See-through enough that the pointer belongs to whatever is behind it. */
  const clickThrough = opacity < GHOST_CLICK_THROUGH;
  const ghosted = opacity < 1;
  const depthBias = tissueDepthBias(organ);

  /**
   * Recompile the shader when a structure crosses between solid and see-through.
   *
   * **Without this, ghosting a structure that was already on screen does
   * nothing at all.** three.js bakes the decision into the program: a material
   * compiled while `transparent` is false gets `#define OPAQUE`, and that define
   * is `diffuseColor.a = 1.0` inside the fragment shader — the alpha is
   * discarded before blending ever sees it. Setting `transparent` and `opacity`
   * afterwards changes two properties the compiled program no longer reads.
   *
   * Only `needsUpdate` bumps the material's version, which is what makes the
   * renderer recompute its parameters. React Three Fiber assigns props straight
   * onto the material and never sets it, so nothing else will.
   *
   * The symptom is confusing rather than obviously broken: structures that were
   * *already* translucent — a cornea, a system the reader had ghosted earlier —
   * compiled without the define and respond immediately, so the view goes half
   * glass and half solid. Restarting the app appears to "fix" it, because the
   * meshes are then built see-through from the start.
   *
   * Cheap despite running across the whole atlas: three caches programs by
   * their parameters, so thousands of materials crossing together share one
   * compile and the rest are cache hits.
   */
  const material = useRef<THREE.MeshStandardMaterial>(null);
  useEffect(() => {
    if (material.current) material.current.needsUpdate = true;
  }, [ghosted]);
  const { color, emissive, emissiveIntensity } = useMemo(() => {
    // The revision map replaces the tissue colour outright rather than tinting
    // it. Mixing the two would make "muscle I have studied" and "bone I have
    // glanced at" arrive at similar pixels, and the whole value of the map is
    // that the shape of your own attention is legible at a glance.
    //
    // The revision map wins over the scan when both are on. The map is a
    // statement about the reader's own work; the scan is a way of looking. A
    // scan on top would grey out the very thing the map exists to show, and
    // the reader would be left with two controls that cancel each other.
    const tissue =
      coverageTouches !== undefined && coverageBusiest !== undefined
        ? coverageColour(coverageTouches, coverageBusiest)
        : scanned
          ? scanColour(tissueColour(organ))
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
    /*
     * What the assistant is explaining, and it outranks the selection.
     *
     * It has to. The assistant calls `focus_organ` before it explains anything,
     * and that *selects* the structure — so with selection on top, its own
     * light was computed and then thrown away every single time, and every
     * explanation was marked with the quiet 0.14 selection tint instead of the
     * light meant for it. The brighter treatment existed and was unreachable.
     *
     * Safe to be this bright where selection is not, because of what each one
     * has to survive. A selection can be anything — a ventricle filling the
     * screen — and a strong emissive across it erases the shading that carries
     * its form. The assistant lights at most a handful of structures it is
     * naming in a sentence, and it stops as soon as the explanation moves on.
     *
     * It does *not* outrank a pathology overlay, which is checked first below.
     * An overlay is a statement about the anatomy and this is a statement about
     * attention, so when they disagree the anatomy wins — the same rule the
     * cursor's light already followed. Marking a diseased structure must not
     * paint the disease out of it.
     */
    if (overlay) {
      // Pathology glows on its own so it stays legible when the organ is
      // neither hovered nor selected — that is the whole point of the overlay.
      return {
        color: base,
        emissive: base,
        emissiveIntensity: 0.15 + overlay.severity * 0.35,
      };
    }
    if (litGlow > 0) {
      return {
        color: base.clone().lerp(LIT_LIGHT, 0.45),
        emissive: LIT_LIGHT,
        emissiveIntensity: LIT_FLOOR + litGlow * LIT_RANGE,
      };
    }
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
  }, [
    organ,
    hovered,
    selected,
    overlay,
    coverageTouches,
    coverageBusiest,
    probeDepth,
    litDepth,
    scanned,
  ]);

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
        ref={material}
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

      {/*
        The buried part of what the assistant is explaining — see
        `OCCLUDED_FLOOR`. A child rather than a sibling so it inherits the glTF
        node transform above and cannot drift from the structure it belongs to,
        and it inherits `visible` too, so a hidden structure has no ghost.
      */}
      {litGlow > 0 && (
        <mesh
          geometry={geometry}
          // Never a pointer target. It occupies the same space as its parent,
          // which already answers for both of them.
          raycast={NO_RAYCAST}
          // After the opaque pass, or the depth it tests against is not there
          // yet and nothing reads as occluded.
          renderOrder={4}
        >
          <meshBasicMaterial
            color={LIT_LIGHT}
            transparent
            opacity={OCCLUDED_FLOOR + litGlow * OCCLUDED_RANGE}
            // The whole technique, in one property: pass only where this
            // fragment is *further* than what has already been drawn.
            depthFunc={THREE.GreaterDepth}
            depthWrite={false}
            toneMapped={false}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      )}
    </mesh>
  );
});
