import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { meshUrl } from "@/lib/manifest";
import { useSceneStore } from "@/stores/sceneStore";

import { brainOrganIds, ENOUGH_TO_DRAW } from "./brainSet";

/**
 * The resting screen: the brain, alone, lit from inside.
 *
 * # What this deliberately is not
 *
 * **It is ornament, and it says nothing.** The travelling light is a sine wave
 * over surface position, not a signal and not a simulation. In an app that
 * spends its whole interface saying it is not a medical device, an animation
 * that could be read as brain *activity* would undo that quietly — so there is
 * no label, no legend, and nothing that invites the reading.
 *
 * # Why it costs almost nothing
 *
 * Three decisions, in order of how much they matter:
 *
 * 1. **One draw call, not a hundred.** The brain is ~105 separate meshes in the
 *    atlas. They are merged once, on the way in, into a single geometry.
 * 2. **Thirty frames a second, not sixty.** The canvas renders on demand and an
 *    interval asks for a frame at 30 Hz. A body turning this slowly gains
 *    nothing from the other thirty, and halving the frames halves the GPU.
 * 3. **Nothing at all when unwatched.** `frameloop="demand"` plus an interval
 *    that stops with the component: no hidden render loop survives it.
 *
 * It also degrades rather than stutters — see `useFramePacing`.
 */

/** ~30 fps. A slow rotation gains nothing above this and costs twice. */
const FRAME_MS = 33;

/** Frames to watch before deciding the machine is struggling. */
const SAMPLE_FRAMES = 45;

/** Above this average frame time, drop the second pass. ~22 fps. */
const STRUGGLING_MS = 45;

/**
 * The look, gathered so taste can be adjusted without reading the shader.
 *
 * The numbers are small because the blending is additive over roughly a
 * hundred overlapping shells: every value here is paid once *per layer the eye
 * looks through*, so what reads as gentle on one surface saturates to white on
 * forty. The first version had a constant term in the fragment colour — a
 * base glow every layer contributed regardless of angle — and the middle of
 * the brain came out solid white with no background behind it.
 */
export const LOOK = {
  /** Overall strength. Sets how much of the background survives. */
  opacity: 0.055,
  /**
   * How tight the lit edge is. Higher is narrower.
   *
   * This is what keeps the interior clear, and it has to be steeper than
   * intuition suggests. Cortex is folded: from any angle a large share of the
   * surface is presented edge-on, so a gentle exponent lights most of the
   * brain rather than its outline, and forty layers of "most" is white.
   */
  rimSharpness: 5.2,
  /**
   * The mesh over the top, and the value that needed cutting hardest.
   *
   * Drawn on the merged geometry, `wireframe` is every edge of every triangle
   * of a hundred anatomical meshes. At that density it stops reading as a
   * lattice and becomes fog — it was most of the brightness, not a detail on
   * top of it.
   */
  wireOpacity: 0.009,

  /**
   * The waves, which are the whole character of the thing.
   *
   * Each is a front expanding from one point on the cortex, not a band
   * sweeping the whole shape. That difference is what makes it read as
   * something starting *somewhere* rather than as a scanner passing over —
   * and it is the only reason the effect suggests a thought at all.
   */
  waves: 3,
  /**
   * Seconds a wave takes to cross and fade.
   *
   * Bounded by the stagger, not by taste: with three waves evenly spread round
   * `waveLife + waveRest`, a life longer than twice the gap puts all three in
   * flight together, and three fronts at once is a flash rather than a
   * procession. At 4.6 against a 2.33 gap there are never more than two.
   */
  waveLife: 4.6,
  /** Seconds of quiet after it, so the procession breathes. */
  waveRest: 2.4,
  /**
   * Front speed, in brain radii per second.
   *
   * Fast enough that a front clears the far side within its life — 4.6 s at
   * 0.46 covers 2.1 radii against a diameter of 2. Slower and every wave dies
   * halfway across, which looks like it ran out rather than like it arrived.
   */
  waveSpeed: 0.46,
  /** Thickness of the front, in brain radii. Thin reads as a pulse. */
  waveWidth: 0.13,
  /** How bright a front gets, against a rim of 1.0. */
  waveStrength: 1.35,
  /**
   * The ignition at the origin, as a fraction of the front behind it.
   *
   * Its own number because it is the one thing here that is *not* subtle by
   * construction: the flash lands on a small patch all at once, so at parity
   * with the ring it reads as a strobe rather than as something beginning.
   * Well under half, and it announces the wave without starting it with a bang.
   */
  sparkStrength: 0.4,

  /**
   * The wordmark the light writes, and how rarely it does it.
   *
   * Rare on purpose. A mark that appears every few seconds is a logo
   * animation; one that surfaces roughly twice a minute, at an angle you did
   * not choose, reads as something the light happened to trace.
   */
  wordEvery: 34,
  wordVisible: 5.5,
  wordStrength: 0.38,
} as const;

/**
 * Where one wave is in its life, at a given moment.
 *
 * Pure, and deliberately not random: the waves are evenly staggered around a
 * shared period so there is always one in flight and never all three at once.
 * Reaching for `Math.random` per frame would restart a front every frame; per
 * emission it would be untestable. A phase offset gives a procession that can
 * be reasoned about and checked.
 *
 * `emission` counts which wave this is, so the caller knows when to choose a
 * new starting point on the cortex.
 */
export function waveState(
  index: number,
  seconds: number,
  life = LOOK.waveLife,
  rest = LOOK.waveRest,
  count = LOOK.waves,
): { age: number; emission: number; active: boolean } {
  const period = life + rest;
  const shifted = seconds - (index * period) / count;
  if (shifted < 0) return { age: 0, emission: 0, active: false };
  const emission = Math.floor(shifted / period);
  const age = shifted - emission * period;
  return { age, emission, active: age <= life };
}

const NERVOUS_MESH = "nervous_male.glb";
const DRACO_DECODER_PATH = "/draco/";

/**
 * The shell's look, in one place.
 *
 * A fresnel rim does the work: facing surfaces stay nearly clear and glancing
 * ones light up, which is what makes a solid lump of cortex read as a volume
 * rather than a silhouette. The travelling band is added on top, never
 * multiplied, so it brightens without ever darkening what is under it.
 */
const SHELL_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vLocal;

  void main() {
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uBody;
  uniform vec3 uPulse;
  uniform float uOpacity;
  uniform float uRimSharpness;
  uniform float uRadius;

  uniform vec3 uWaveSeed[WAVE_COUNT];
  uniform float uWaveAge[WAVE_COUNT];
  uniform float uWaveSpeed;
  uniform float uWaveWidth;
  uniform float uWaveStrength;
  uniform float uSparkStrength;
  uniform float uWaveLife;

  uniform sampler2D uWord;
  uniform float uWordStrength;
  uniform float uWordAngle;

  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vLocal;

  /**
   * One thought: a front leaving a point on the cortex, and the flash it left.
   *
   * Two terms rather than one. The ring alone is a ripple in water; the ignition
   * at the origin is what makes it read as something starting *there* — the
   * difference between a wave passing over the brain and a wave coming out of it.
   */
  float wave(vec3 p, vec3 seed, float age) {
    if (age < 0.0) return 0.0;

    float distance = length(p - seed);
    float front = age * uWaveSpeed * uRadius;
    float width = uWaveWidth * uRadius;

    // The expanding ring, thinning as it goes: a front that keeps its
    // brightness across the whole brain looks like a sweep, not a pulse.
    float ring = 1.0 - smoothstep(0.0, width, abs(distance - front));

    // The ignition, brief and only at the source.
    float spark = (1.0 - smoothstep(0.0, width * 1.6, distance))
                * (1.0 - smoothstep(0.0, uWaveLife * 0.22, age));

    // Out over its life, so nothing ever switches off with an edge.
    float fade = 1.0 - smoothstep(0.0, uWaveLife, age);

    return (ring * fade + spark * uSparkStrength) * uWaveStrength;
  }

  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(vViewW)));
    float rim = pow(1.0 - facing, uRimSharpness);

    float thought = 0.0;
    for (int i = 0; i < WAVE_COUNT; i++) {
      thought += wave(vLocal, uWaveSeed[i], uWaveAge[i]);
    }

    // The wordmark, painted by the light rather than drawn over it.
    //
    // Projected flat onto a plane fixed to the brain, so the folds carry it and
    // the rotation sweeps it past instead of pasting it to the screen. The
    // plane's angle changes each time it surfaces, which is why it never quite
    // arrives the same way twice.
    float word = 0.0;
    if (uWordStrength > 0.001) {
      float c = cos(uWordAngle);
      float sn = sin(uWordAngle);
      vec2 planar = vec2(vLocal.x * c - vLocal.z * sn, vLocal.y);
      vec2 uv = planar / (uRadius * 2.0) + 0.5;
      // Outside the letters there is nothing to add, and a clamped sampler
      // would otherwise smear the edge pixels right across the lobes.
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        word = texture2D(uWord, uv).r * uWordStrength;
      }
    }

    float lit = thought + word;

    // **No constant term.** Anything added here is added again for every shell
    // the eye looks through, and the brain is about forty deep through the
    // middle — a base glow of 0.35 is white before the rim contributes at all.
    float glow = rim + lit;

    // Grey where it is only shape, green where something is passing through.
    // Saturating the mix well before the light peaks keeps the colour of a
    // front constant while its brightness still climbs.
    vec3 colour = mix(uBody, uPulse, clamp(lit * 2.2, 0.0, 1.0));

    gl_FragColor = vec4(colour * glow, uOpacity * glow);
  }
`;

/**
 * Ask for frames at a fixed rate, and give up detail before giving up smoothness.
 *
 * The honest answer to "only if the machine can take it". There is no reliable
 * way to ask a browser whether a computer is fast; there is a very reliable way
 * to watch how long its frames actually take and do less when they are slow.
 */
/**
 * The wordmark, drawn once into a canvas and handed to the shader as light.
 *
 * A canvas rather than a font file or a text mesh: this needs one channel of
 * luminance sampled per fragment, not glyph geometry, and it saves shipping a
 * typeface for nine letters. Transparent everywhere but the letters, so the
 * shader's bounds check and the texture agree about where there is nothing.
 */
function wordmarkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  // 512, not 1024. Four megabytes of video memory for a mark that is meant to
  // be almost subliminal was paying full price for something nobody reads at
  // full resolution — and at this strength the two are indistinguishable.
  canvas.width = 512;
  canvas.height = 512;
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.clearRect(0, 0, canvas.width, canvas.height);
    paint.fillStyle = "#ffffff";
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    // Spaced like the mark in the corner, and for the same reason: at this
    // brightness the letters are read by their gaps as much as their strokes.
    paint.letterSpacing = "13px";
    paint.font = "600 58px ui-sans-serif, system-ui, -apple-system, sans-serif";
    paint.fillText("ANATRIA3D", canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/**
 * When the mark surfaces, and at what angle.
 *
 * Returned as a plain number so the frame loop can write it into a uniform
 * without a render. The angle is derived from the cycle index rather than
 * `Math.random`, so a cycle keeps the same angle for its whole appearance —
 * drawn fresh each frame it would jitter through every angle at once.
 */
export function wordmarkAt(seconds: number): { strength: number; angle: number } {
  const cycle = Math.floor(seconds / LOOK.wordEvery);
  const into = seconds - cycle * LOOK.wordEvery;
  if (into > LOOK.wordVisible) return { strength: 0, angle: 0 };

  // In and out on a raised cosine: no edge to catch the eye at either end,
  // which is what stops it reading as a logo being switched on.
  const phase = into / LOOK.wordVisible;
  const strength = (0.5 - Math.cos(phase * Math.PI * 2) * 0.5) * LOOK.wordStrength;
  // `x - floor(x)`, not `x % 1`. JavaScript's remainder keeps the sign of the
  // dividend, so half the cycles came out negative — the shader would still
  // have taken it, sin and cos being indifferent, and the angles would simply
  // not have been spread the way this claims to spread them.
  const noise = Math.sin(cycle * 12.9898) * 43758.5453;
  const angle = (noise - Math.floor(noise)) * Math.PI * 2;
  return { strength, angle };
}

function useFramePacing(): boolean {
  const invalidate = useThree((state) => state.invalidate);
  const [heavy, setHeavy] = useState(true);
  const samples = useRef<number[]>([]);
  const decided = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => invalidate(), FRAME_MS);
    return () => clearInterval(timer);
  }, [invalidate]);

  useFrame((_, delta) => {
    if (decided.current) return;
    samples.current.push(delta * 1000);
    if (samples.current.length < SAMPLE_FRAMES) return;
    decided.current = true;
    const mean =
      samples.current.reduce((total, ms) => total + ms, 0) / samples.current.length;
    if (mean > STRUGGLING_MS) setHeavy(false);
  });

  return heavy;
}

function Brain({ organIds, still }: { organIds: string[]; still: boolean }) {
  const { nodes } = useGLTF(meshUrl(NERVOUS_MESH), DRACO_DECODER_PATH);
  const organs = useSceneStore((s) => s.organs);
  const group = useRef<THREE.Group>(null);
  const heavy = useFramePacing();

  /**
   * Every brain mesh, welded into one and centred on the origin.
   *
   * Merged rather than mapped over: a hundred draw calls twice a frame is the
   * difference between a resting screen and a fan spinning up. Centring here
   * rather than moving the camera keeps the rotation about the brain's own
   * middle, which is the only axis that does not look like a wobble.
   */
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const organId of organIds) {
      const organ = organs[organId];
      if (!organ) continue;
      const node =
        nodes[organ.node] ?? nodes[THREE.PropertyBinding.sanitizeNodeName(organ.node)];
      if (!(node instanceof THREE.Mesh)) continue;
      node.updateWorldMatrix(true, false);
      // Baked into the vertices: the merge cannot carry a per-part transform,
      // and every one of these meshes has its own place in the head.
      const part = node.geometry.clone().applyMatrix4(node.matrixWorld);
      // Only what the shader reads. Dropping uv/colour/tangent here is most of
      // the memory this screen uses.
      for (const name of Object.keys(part.attributes)) {
        if (name !== "position" && name !== "normal") part.deleteAttribute(name);
      }
      parts.push(part);
    }
    if (parts.length === 0) return null;

    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return null;

    merged.computeBoundingSphere();
    const centre = merged.boundingSphere?.center ?? new THREE.Vector3();
    merged.translate(-centre.x, -centre.y, -centre.z);
    merged.computeBoundingSphere();
    return merged;
  }, [nodes, organIds, organs]);

  // Held apart from the material so the frame loop writes to values the type
  // system knows exist, rather than reaching back through `uniforms`.
  const time = useMemo(() => ({ value: 0 }), []);
  const wordStrength = useMemo(() => ({ value: 0 }), []);
  const wordAngle = useMemo(() => ({ value: 0 }), []);
  const word = useMemo(() => wordmarkTexture(), []);

  /**
   * Where each wave is starting from, and how far into its life it is.
   *
   * Arrays of uniforms rather than three sets: the shader loops over them, and
   * a negative age is how a wave says it is resting. Held in refs beside them
   * so the frame loop can tell when an emission has rolled over and it is time
   * to choose somewhere new.
   */
  const waveSeeds = useMemo(
    () => ({
      value: Array.from({ length: LOOK.waves }, () => new THREE.Vector3()),
    }),
    [],
  );
  const waveAges = useMemo(
    () => ({ value: Array.from({ length: LOOK.waves }, () => -1) }),
    [],
  );
  const emissions = useRef<number[]>(Array.from({ length: LOOK.waves }, () => -1));

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERTEX,
        // GLSL needs the array bound at compile time, so the count is
        // substituted rather than passed — one source of truth, still `LOOK`.
        fragmentShader: SHELL_FRAGMENT.replaceAll("WAVE_COUNT", String(LOOK.waves)),
        uniforms: {
          uTime: time,
          uBody: { value: new THREE.Color("#9aa3b0") },
          uPulse: { value: new THREE.Color("#38bdf8") },
          uOpacity: { value: LOOK.opacity },
          uRimSharpness: { value: LOOK.rimSharpness },
          uWaveSeed: waveSeeds,
          uWaveAge: waveAges,
          uWaveSpeed: { value: LOOK.waveSpeed },
          uWaveWidth: { value: LOOK.waveWidth },
          uWaveStrength: { value: LOOK.waveStrength },
          uSparkStrength: { value: LOOK.sparkStrength },
          uWaveLife: { value: LOOK.waveLife },
          uWord: { value: word },
          uWordStrength: wordStrength,
          uWordAngle: wordAngle,
          // The geometry is centred but not normalised, so the shader needs
          // its own extent to map a local position into the texture.
          uRadius: { value: 1 },
        },
        transparent: true,
        // Depth writing off because this is a translucent shell seen through
        // itself: writing it would let near folds erase far ones.
        //
        // Back faces culled, which the first version did not do. With additive
        // blending every back face is another layer summed into the same
        // pixel, so keeping them doubled the count the eye looks through for a
        // depth cue the rim already provides. It also halves the fill cost.
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending,
      }),
    [time, word, wordStrength, wordAngle, waveSeeds, waveAges],
  );

  const wireframe = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#7dd3fc",
        wireframe: true,
        transparent: true,
        opacity: LOOK.wireOpacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  // The extent the shader maps the wordmark across, taken from the geometry
  // once it exists rather than guessed at material-creation time.
  useEffect(() => {
    const radius = geometry?.boundingSphere?.radius;
    if (radius) material.uniforms.uRadius!.value = radius;
  }, [geometry, material]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
      material.dispose();
      wireframe.dispose();
      word.dispose();
    };
  }, [geometry, material, wireframe, word]);

  useFrame((state) => {
    if (still) return;
    const seconds = state.clock.elapsedTime;
    time.value = seconds;

    const positions = geometry?.getAttribute("position");
    for (let index = 0; index < LOOK.waves; index += 1) {
      const wave = waveState(index, seconds);
      waveAges.value[index] = wave.active ? wave.age : -1;
      // A new emission gets a new origin, chosen from the cortex itself rather
      // than from a box around it: a front starting in the empty space between
      // the lobes would expand into view from nowhere.
      if (wave.emission !== emissions.current[index] && positions) {
        emissions.current[index] = wave.emission;
        const vertex = Math.floor(Math.random() * positions.count);
        waveSeeds.value[index]!.fromBufferAttribute(positions, vertex);
      }
    }

    const mark = wordmarkAt(seconds);
    wordStrength.value = mark.strength;
    wordAngle.value = mark.angle;
    if (group.current) group.current.rotation.y = seconds * 0.13;
  });

  if (!geometry) return null;
  const radius = geometry.boundingSphere?.radius ?? 1;

  return (
    <group ref={group} scale={1 / radius}>
      <mesh geometry={geometry} material={material} />
      {heavy && <mesh geometry={geometry} material={wireframe} />}
    </group>
  );
}

/**
 * The overlay itself.
 *
 * Returns nothing when the brain is not already in memory. The alternative was
 * fetching a nine-megabyte mesh the moment someone walked away from their desk,
 * which is a strange thing for a screen that exists to do nothing.
 */
export function IdleScreen({ onDismiss }: { onDismiss: () => void }) {
  const organs = useSceneStore((s) => s.organs);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);

  const organIds = useMemo(() => brainOrganIds(Object.values(organs)), [organs]);
  const loaded = !hiddenSystems.includes("nervous");

  // Honoured rather than ignored: someone who has asked their system for less
  // motion has asked every application, and a decorative rotation is exactly
  // what that setting is about. The brain still appears; it simply holds still.
  const still = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    [],
  );

  if (!loaded || organIds.length < ENOUGH_TO_DRAW) return null;

  return (
    <div
      className="fixed inset-0 z-50 cursor-none bg-slate-950"
      onPointerDown={onDismiss}
      role="presentation"
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 3.1], fov: 42 }}
      >
        <Brain organIds={organIds} still={still} />
      </Canvas>
      <p className="pointer-events-none absolute bottom-6 left-8 text-[11px] tracking-[0.3em] text-slate-700">
        ANATRIA<span className="text-sky-900">3D</span>
      </p>
    </div>
  );
}
