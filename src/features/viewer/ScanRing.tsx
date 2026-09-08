import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { SCAN_ENTRY, SHARED_SCAN } from "./scanBand";

/**
 * The ring the sweep appears to come from.
 *
 * # Why a ring above a standing body, and not a gurney
 *
 * The obvious staging was a body laid on a table, and it cost more than it
 * looked. Laying the body down means either rotating the scene root — which
 * moves the ground under picking, labels, clipping planes, `orientView` and
 * every bounds calculation that assumes up is +Y — or faking it with the
 * camera, which falls apart the moment the reader orbits, and orbiting is the
 * point.
 *
 * A ring around a standing body has neither problem. Nothing rotates, the sweep
 * axis stays Y, and it reads correctly from every angle, which a table seen
 * from below does not.
 *
 * # It is not decoration, it is the explanation
 *
 * The ring rides at exactly the height the band is lighting, because they are
 * driven by the same shared uniform. Without it the band is a glow with no
 * cause; with it the reader can see what is doing the reading and where it has
 * got to.
 *
 * # The emitters are instanced, and the radii do not touch
 *
 * Twenty-four emitter blocks are one `InstancedMesh` and therefore one draw
 * call, not twenty-four. That is what lets the ring look like an instrument
 * rather than a hoop without costing anything.
 *
 * **Every radius here is deliberately disjoint.** The first version overlapped
 * the inner light ring with the shell — spans of `[r-1.35t, r-0.65t]` and
 * `[r-t, r+t]` — and the two surfaces fought over the depth test along the
 * intersection. The symptom was white speckles scattered around the ring, which
 * reads as a texture problem and is not one. Concentric geometry that shares
 * space z-fights; keep the bands apart and it cannot.
 *
 * # What it costs
 *
 * Five draw calls. The shell and the emitters are ordinary opaque geometry. The
 * wash across the reading plane is additive with depth writing off, which is
 * why it is safe where the emissive plane rejected in phase 0 was not:
 * **additive blending is order-independent**, so it needs no correct sort
 * against the thousands of transparent shells underneath it.
 */

/** Emitter blocks around the inner face. One instanced draw call, not 24. */
const EMITTERS = 24;

/**
 * Fade a geometry out along one measure of its own vertices.
 *
 * **In additive blending, black is transparent**: the fragment adds nothing, so
 * a colour ramp to black *is* a fade to invisible. That is the whole trick
 * here, and it buys a gradient with no texture to load, no alpha to sort and no
 * shader of our own to compile — a `MeshBasicMaterial` with `vertexColors` on
 * ordinary geometry.
 *
 * `weight` receives each vertex and returns 1 where the light is strongest and
 * 0 where it should vanish.
 */
function fadeToBlack(
  geometry: THREE.BufferGeometry,
  tint: THREE.Color,
  weight: (x: number, y: number, z: number) => number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(0, Math.min(1, weight(position.getX(i), position.getY(i), position.getZ(i))));
    colours[i * 3] = tint.r * t;
    colours[i * 3 + 1] = tint.g * t;
    colours[i * 3 + 2] = tint.b * t;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** Slow enough to read as a machine working, not as something spinning. */
const TURNS_PER_SECOND = 0.04;

/**
 * How much wider the ring is at the moment it appears, as a fraction.
 *
 * The aperture closes onto the body as the light comes up. It is the same
 * movement a real gantry makes when it is brought to a patient, and it is the
 * reason the entrance reads as a machine arriving rather than an effect fading
 * in — a fade is a change of picture, a movement is an event.
 */
const ENTRY_APERTURE = 0.34;

/** How many times the name repeats around the band. */
const NAMEPLATE_REPEATS = 5;

/**
 * The name, drawn once into a canvas and wrapped around the outside.
 *
 * A canvas texture rather than 3D text: real glyphs would mean a font to load,
 * a text engine to pull in and geometry per letter, for something read at a
 * glance from across the viewport. This is one texture and one draw call, and
 * repeating it around the band means it is legible from any angle instead of
 * only from the side the plate happens to face.
 *
 * Drawn on transparent black so it can be additive like the rest of the ring's
 * light — see the note on why additive is the safe blend in this scene.
 */
function nameplateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "600 34px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.letterSpacing = "10px";
    context.shadowColor = "#1ae0ff";
    context.shadowBlur = 18;
    context.fillStyle = "#d6fbff";
    context.fillText("ANATRIA 3D", canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = NAMEPLATE_REPEATS;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * How strong the light is at rest.
 *
 * These were four times higher and the disc read as a solid cyan slab: additive
 * blending saturates fast, and past a point the gradient underneath it stops
 * being visible at all. Kept low enough that the falloff shows and the body
 * stays readable through it — the light is meant to reveal the anatomy, not
 * replace it.
 */
const DISC_OPACITY = 0.14;
const LENS_OPACITY = 0.1;
const EMITTER_GLOW = 2.2;

/**
 * The colour of the lit inner edge, at full power.
 *
 * It comes up by being darkened towards black rather than by being made
 * transparent: it is opaque geometry inboard of the emitters, and turning it
 * transparent would put a thin ring into the sorted pass for no reason. A lamp
 * that is not yet at full brightness is dimmer, not see-through.
 */
const EDGE_LIT = new THREE.Color("#8ff4ff");

export function ScanRing({
  bounds,
  instrument,
}: {
  bounds: THREE.Box3 | null;
  /**
   * Draw the hardware, or only the light it throws.
   *
   * False while an answer is being written: the assistant is moving the scene
   * then, and a solid ring passing over the body hides the thing it is showing.
   */
  instrument: boolean;
}) {
  const ring = useRef<THREE.Group>(null);
  const emitters = useRef<THREE.InstancedMesh>(null);
  const discMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const lensMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const emitterMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const nameplateMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const edgeMaterial = useRef<THREE.MeshBasicMaterial>(null);

  const shape = useMemo(() => {
    if (!bounds || bounds.isEmpty()) return null;
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    // Wide enough to clear the fingertips of an arm at rest, so the ring never
    // appears to pass through the body it is reading.
    const radius = Math.max(size.x, size.z) * 0.72;
    const tube = radius * 0.035;
    return {
      x: centre.x,
      z: centre.z,
      radius,
      tube,
      // Three disjoint bands, outermost first. The shell occupies
      // [radius-tube, radius+tube]; nothing else may enter that span.
      emitterRadius: radius - tube * 2.6,
      lightRadius: radius - tube * 4.4,
      emitter: tube * 0.9,
    };
  }, [bounds]);

  /**
   * The light itself: a disc thrown inward across the plane being read, and a
   * skirt that gives it height either side of the ring.
   *
   * Both are built once per shape and disposed with it. Symmetric about the
   * ring plane on purpose — the ring sweeps up as well as down, and light that
   * only fell downwards would look wrong for half of every cycle.
   */
  const glow = useMemo(() => {
    if (!shape) return null;
    const tint = new THREE.Color("#1ae0ff");

    // Brightest at the rim, where the emitters are, fading towards the axis.
    // Squared so the falloff is soft near the body rather than a flat wash.
    const disc = fadeToBlack(
      new THREE.RingGeometry(shape.lightRadius * 0.05, shape.lightRadius, 64, 8),
      tint,
      (x, y) => Math.pow(Math.hypot(x, y) / shape.lightRadius, 2),
    );

    // A flattened sphere, not a cylinder.
    //
    // The first attempt was an open cylinder and it read as a box: a cylinder
    // seen near edge-on is a rectangle, and its silhouette ends abruptly at the
    // left and right — which is exactly where an additive surface is brightest,
    // because that is where the view grazes it. Bright light stopping at a
    // straight edge is the one thing that cannot look like light.
    //
    // **A sphere has no hard silhouette from any angle.** Flattened onto the
    // ring plane and faded from equator to poles it reads as a lens of light
    // around the ring, and it stays round however the reader orbits.
    const skirt = fadeToBlack(
      new THREE.SphereGeometry(shape.lightRadius, 48, 24),
      tint,
      (x, y, z) => {
        const r = Math.hypot(x, y, z) || 1;
        // Brightest at the equator, which is the plane the ring is reading,
        // and gone by the poles.
        return Math.pow(1 - Math.abs(y / r), 2.6);
      },
    );

    return { disc, skirt };
  }, [shape]);

  // Only drawn when the hardware is. Built unconditionally it meant a canvas
  // and a texture upload for every question asked, to be disposed unused.
  const nameplate = useMemo(() => (instrument ? nameplateTexture() : null), [instrument]);

  useEffect(
    () => () => {
      glow?.disc.dispose();
      glow?.skirt.dispose();
    },
    [glow],
  );
  useEffect(() => () => nameplate?.dispose(), [nameplate]);

  useLayoutEffect(() => {
    const mesh = emitters.current;
    if (!mesh || !shape) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < EMITTERS; i++) {
      const angle = (i / EMITTERS) * Math.PI * 2;
      position.set(Math.cos(angle) * shape.emitterRadius, 0, Math.sin(angle) * shape.emitterRadius);
      // Each block faces the axis, so the lit face is the one turned inwards
      // towards the body rather than out at the room.
      rotation.set(0, -angle, 0);
      matrix.compose(position, quaternion.setFromEuler(rotation), scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [shape]);

  useFrame((state, delta) => {
    const group = ring.current;
    if (!group) return;
    group.position.y = SHARED_SCAN.value;
    // Turning at the rate it is up, so the ring is nearly still as it appears
    // and eases into its cadence. A hoop already spinning at full rate while
    // its lamps are still coming on is two entrances at once.
    group.rotation.y += delta * Math.PI * 2 * TURNS_PER_SECOND * SCAN_ENTRY.value;

    /**
     * Light that never changes does not read as light.
     *
     * A real beam varies as it travels — what it crosses reflects differently
     * from one moment to the next — and a constant additive surface is the one
     * thing that gives the trick away. So the intensity breathes.
     *
     * **The phase is driven by where the sweep is, not only by the clock.** Tie
     * it to time alone and it pulses on its own like a decoration; tie it to
     * travel and the variation belongs to the movement, which is what the eye
     * is actually reading. The slower clock term is there so it is still alive
     * at the top and bottom of the stroke, where travel briefly stops.
     */
    const travel = Math.sin(SHARED_SCAN.value * 34);
    const drift = Math.sin(state.clock.elapsedTime * 1.7);
    const breath = 0.78 + 0.22 * (travel * 0.6 + drift * 0.4);

    /**
     * The arrival, read from the same uniform the body's light is scaled by.
     *
     * Not a clock of its own: the ring and the band it appears to cast have to
     * come up together, and two ramps started in the same second still drift
     * apart the first time a frame is long. The scene advances it once; both
     * ends read the one value.
     */
    const arrival = SCAN_ENTRY.value;
    const aperture = 1 + ENTRY_APERTURE * (1 - arrival);
    // Radial only. Scaling Y as well would squash the lens of light through the
    // ring plane, and the plane is the one thing that must stay where the band
    // says it is.
    group.scale.x = aperture;
    group.scale.z = aperture;

    if (discMaterial.current) discMaterial.current.opacity = DISC_OPACITY * breath * arrival;
    if (lensMaterial.current) lensMaterial.current.opacity = LENS_OPACITY * breath * arrival;
    if (nameplateMaterial.current) nameplateMaterial.current.opacity = arrival;
    if (edgeMaterial.current) edgeMaterial.current.color.copy(EDGE_LIT).multiplyScalar(arrival);
    if (emitterMaterial.current) {
      emitterMaterial.current.emissiveIntensity = EMITTER_GLOW * (0.85 + 0.3 * breath) * arrival;
    }
  });

  if (!shape) return null;

  return (
    <group ref={ring} position={[shape.x, 0, shape.z]}>
      {/*
        The machine, or only its light.
        =============================

        While an answer is being written the assistant is isolating structures
        and lighting the ones it names, and a solid ring sliding across the body
        hides exactly what the reader is being shown. So the hardware is for the
        reader who asked for it by hand; a sweep that runs by itself is light
        alone, passing through without covering anything.

        It is also cheapest in the busiest moment, which is the right way round:
        four fewer draw calls precisely while the assistant is moving the scene.
      */}
      {instrument && (
        <>
          {/* The shell. Lit like the rest of the scene rather than emissive, so
              it reads as an object in the room and not as a light. */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[shape.radius, shape.tube, 10, 96]} />
            <meshStandardMaterial color="#1b2735" roughness={0.3} metalness={0.75} />
          </mesh>

          {/* The name, wrapped around the outside of the shell and turning with
              it. Sits just clear of the shell's own radius so the two surfaces
              cannot fight over the depth test — the mistake that speckled the
              first ring. */}
          <mesh>
            <cylinderGeometry
              args={[shape.radius + shape.tube * 1.02, shape.radius + shape.tube * 1.02,
                     shape.tube * 1.6, 96, 1, true]}
            />
            <meshBasicMaterial
              ref={nameplateMaterial}
              map={nameplate}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>

          {/* The emitter array: what makes it read as an instrument. */}
          <instancedMesh ref={emitters} args={[undefined, undefined, EMITTERS]}>
            <boxGeometry args={[shape.emitter * 0.55, shape.emitter * 0.7, shape.emitter * 2.2]} />
            <meshStandardMaterial
              color="#0b1c24"
              ref={emitterMaterial}
              emissive="#1ae0ff"
              emissiveIntensity={EMITTER_GLOW}
              roughness={0.25}
              metalness={0.4}
            />
          </instancedMesh>

          {/* A thin bright line inboard of the emitters, clear of both other
              radii. This is the edge that is meant to look switched on. */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[shape.lightRadius, shape.tube * 0.22, 6, 96]} />
            <meshBasicMaterial ref={edgeMaterial} color="#8ff4ff" toneMapped={false} />
          </mesh>
        </>
      )}

      {/* The light. Additive and never occluding — see the note above on why
          this shape is safe here where a blended plane was not. Both carry
          their fade in vertex colour, so neither needs alpha or a texture. */}
      {glow && (
        <>
          <mesh geometry={glow.disc} rotation={[-Math.PI / 2, 0, 0]}>
            <meshBasicMaterial
              ref={discMaterial}
              vertexColors
              transparent
              opacity={DISC_OPACITY}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          {/* Flattened here rather than in the geometry, so the fade above is
              written in the sphere's own frame and stays readable. */}
          <mesh geometry={glow.skirt} scale={[1, 0.42, 1]}>
            <meshBasicMaterial
              ref={lensMaterial}
              vertexColors
              transparent
              opacity={LENS_OPACITY}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
