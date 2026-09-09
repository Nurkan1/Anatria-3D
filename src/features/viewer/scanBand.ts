import type { Material } from "three";

/**
 * The sweep band, and the one detail the whole design rests on.
 *
 * # Why the function and the uniforms are module-level
 *
 * three builds its program cache key from `material.customProgramCacheKey()`,
 * whose default returns `this.onBeforeCompile.toString()`. Handing every
 * material the *same* function is therefore what makes 3,478 materials share
 * one compiled program instead of compiling one each. Measured on the whole
 * male atlas: `programs` goes from 2 to 3.
 *
 * The uniforms are shared objects for the same reason. Assigning the same
 * object into every shader means one write a frame updates all of them, and
 * nothing ever walks the 3,478.
 *
 * **If a later change makes either of these per-mesh, the mode stops being
 * affordable**, and the symptom is a multi-second freeze on entry rather than
 * anything that looks like a bug.
 */

/**
 * The direction the band travels, as a unit vector in world space.
 *
 * A vector rather than an assumed axis, and that is a decision rather than
 * generality for its own sake. The band began life sweeping world Y, which is
 * feet-to-head for a body that is standing up — and the next thing this mode
 * does is lay the body on a gurney, at which point world Y becomes shoulder to
 * shoulder and the sweep is nonsense. Naming the axis at the call site means
 * the question has to be answered rather than inherited.
 *
 * A plain array, not a `Vector3`: three's uniform setter accepts one, and it
 * keeps this module free of any runtime import from three.
 */
export type ScanAxis = readonly [number, number, number];

/** Feet to head, for a body standing up. */
export const STANDING: ScanAxis = [0, 1, 0];

export const SHARED_SCAN = { value: 0 };
export const SHARED_AXIS: { value: number[] } = { value: [...STANDING] };

/**
 * How far the mode is into its arrival: 0 the instant it is switched on, 1 once
 * it is fully up.
 *
 * # Why the entrance is a uniform and not an animation in the ring
 *
 * The instrument and the light on the body have to arrive *together*. Two
 * separate ramps — one in a component's frame loop, one here — drift apart the
 * first time a frame is long, and what the reader sees is a ring that is
 * already lit throwing light that has not caught up. One clock, read by both,
 * cannot do that.
 *
 * It is a shared uniform for the same reason the sweep position is: one write a
 * frame reaches all 3,478 materials, and uniform *values* play no part in the
 * program cache key, so the entrance costs nothing at compile time.
 */
export const SCAN_ENTRY = { value: 0 };

/**
 * The colour of the light, as emissive radiance rather than a screen colour.
 *
 * A shared uniform like the rest, and mutated in place rather than replaced:
 * every material holds a reference to *this* object, so assigning a new one
 * here would leave 3,478 shaders pointing at the old value. Changing the colour
 * therefore costs three float writes, not a walk of the scene.
 */
export const SCAN_TINT: { value: number[] } = { value: [0.1, 1.2, 1.5] };

/**
 * How bright the whole structure is, relative to the plane crossing it.
 *
 * One ratio rather than a second colour: the wake and the band are the same
 * light seen at two strengths, and letting them drift apart in hue was how an
 * early version ended up with a green plane trailing a blue-green body.
 */
const WAKE_OF_BAND = 0.29;

/**
 * Reveal the tissue's own colour instead of throwing light at it.
 *
 * # What this is for
 *
 * On a carbon body the sweep is a light in the dark, which reads well and tells
 * you *where* the plane is. This is the other question — *what* it reached —
 * and colour answers it better than brightness does: a lit grey liver is a lit
 * grey shape, while a liver that comes back to its own colour against a black
 * body is a liver.
 *
 * # Why it replaces the glow rather than joining it
 *
 * Both at once is worse than either. Added radiance washes towards white, and a
 * hue seen through a white wash is a paler version of itself — so the glow
 * would be hiding the very thing this exists to show. One or the other, chosen
 * by the reader.
 *
 * A shared uniform, so the switch costs one float write rather than a walk of
 * 3,478 materials.
 */
export const SCAN_REVEAL = { value: 0 };

export function setScanReveal(on: boolean): void {
  SCAN_REVEAL.value = on ? 1 : 0;
}

/**
 * The colour a structure has when nothing is draining it.
 *
 * A material given none keeps whatever it is already drawn in: the mix runs
 * against its own diffuse, which is a no-op rather than a black structure. That
 * matters because it is the state every material is in for the first render
 * after the mode is switched on.
 */
const KEEPS_ITS_OWN: readonly [number, number, number] = [-1, -1, -1];

/** Point the light at a colour. See `scanTints` for why the list is short. */
export function setScanTint(light: readonly [number, number, number]): void {
  SCAN_TINT.value[0] = light[0];
  SCAN_TINT.value[1] = light[1];
  SCAN_TINT.value[2] = light[2];
}

/**
 * How long the arrival takes, in seconds.
 *
 * It was 0.9 and that was too quick to see: with an eased curve the middle of
 * a short ramp goes past in a handful of frames, so what arrives is a flash
 * rather than a movement. Two and a bit seconds is long enough for the aperture
 * to read as closing and short enough that nobody is waiting on a switch.
 */
export const SCAN_ENTRY_S = 2.2;

let elapsed = 0;
let entry = 0;

/**
 * One full there-and-back, in seconds.
 *
 * Twelve was too quick to read: a structure lit and went dark before the eye
 * had found the name of it in the readout, which defeats the point of naming
 * anything. Twenty gives a body about ten seconds head to feet — slow enough
 * to follow, fast enough not to feel like waiting.
 */
export const SWEEP_CYCLE_S = 20;

type Shader = Parameters<Material["onBeforeCompile"]>[0];

/**
 * A span the plane can never be inside, for a material given none.
 *
 * `from` above `to` fails the test for every value. A zero span would have been
 * the obvious placeholder and is a trap: it lights the structure whenever the
 * sweep passes the origin, which on this atlas is somewhere around the hips.
 */
const NEVER: readonly [number, number] = [1, -1];

/**
 * The same function object is attached to every experimental material.
 *
 * three calls this as `material.onBeforeCompile(...)` — a method call, so
 * `this` **is the material**. That is what lets one shared function give every
 * structure a uniform of its own without a closure per mesh, and therefore
 * without losing the shared program: uniform *values* play no part in the
 * cache key, only the source of this function does.
 */
export function scanBandOnBeforeCompile(this: unknown, shader: Shader): void {
  const vertexChunk = "#include <project_vertex>";
  const fragmentChunk = "#include <emissivemap_fragment>";
  if (
    !shader.vertexShader.includes(vertexChunk) ||
    !shader.fragmentShader.includes(fragmentChunk)
  ) {
    throw new Error("Patient scan PoC: the expected Three r185 shader chunks are missing.");
  }
  shader.uniforms.uScanAt = SHARED_SCAN;
  shader.uniforms.uScanAxis = SHARED_AXIS;
  shader.uniforms.uScanEntry = SCAN_ENTRY;
  shader.uniforms.uScanTint = SCAN_TINT;
  shader.uniforms.uScanReveal = SCAN_REVEAL;

  // This structure's own reach along the axis, and its own undrained colour,
  // both read off the material through `this`. Written once at compile and
  // never touched again, so the per-frame cost stays the single shared write
  // for the sweep position. Per-material *values* play no part in the program
  // cache key — only the source of this function does — which is why every
  // structure can carry a colour of its own without any of them compiling a
  // shader of its own.
  const owner = this as
    | {
        userData?: {
          scanSpan?: readonly [number, number];
          revealColour?: readonly [number, number, number];
        };
      }
    | undefined;
  const span = owner?.userData?.scanSpan ?? NEVER;
  shader.uniforms.uOrganSpan = { value: [span[0], span[1]] };
  const reveal = owner?.userData?.revealColour ?? KEEPS_ITS_OWN;
  shader.uniforms.uRevealColour = { value: [reveal[0], reveal[1], reveal[2]] };

  // How far along the axis this fragment sits. The projection happens in the
  // vertex shader and travels as a single float, so the fragment shader does a
  // subtract and a smoothstep and nothing else.
  shader.vertexShader =
    "varying float vScanAlong;\nuniform vec3 uScanAxis;\n" +
    shader.vertexShader.replace(
      vertexChunk,
      `${vertexChunk}\nvScanAlong = dot((modelMatrix * vec4(transformed, 1.0)).xyz, uScanAxis);`,
    );
  shader.fragmentShader =
    "uniform float uScanAt;\nuniform float uScanEntry;\nuniform vec3 uScanTint;\n" +
    "uniform float uScanReveal;\nuniform vec3 uRevealColour;\n" +
    "uniform vec2 uOrganSpan;\nvarying float vScanAlong;\n" +
    shader.fragmentShader.replace(
      fragmentChunk,
      `${fragmentChunk}
    float scanBand = 1.0 - smoothstep(0.008, 0.025, abs(vScanAlong - uScanAt));
    // The whole structure, while the plane is anywhere inside it. Feathered at
    // both ends so a structure arrives and leaves rather than blinking, which
    // is the difference between a scanner finding something and a bulb
    // switching on.
    float wake = smoothstep(uOrganSpan.x - 0.02, uOrganSpan.x + 0.02, uScanAt)
               * (1.0 - smoothstep(uOrganSpan.y - 0.02, uOrganSpan.y + 0.02, uScanAt));
    // Give the structure its colour back while the plane is inside it.
    //
    // This lands *before* the lighting model runs, so what comes back is lit
    // like tissue rather than pasted on flat — which is the whole reason the
    // effect costs a mix and not a shader of its own. A material with no
    // colour to reveal mixes against its own diffuse and changes nothing.
    vec3 revealTo = uRevealColour.r < 0.0 ? diffuseColor.rgb : uRevealColour;
    diffuseColor.rgb = mix(diffuseColor.rgb, revealTo, wake * uScanReveal * uScanEntry);
    // Everything this mode adds is scaled by the arrival, so the light comes
    // up on the body instead of being there the frame the switch is thrown.
    // The glow stands aside when colour is doing the telling.
    totalEmissiveRadiance += uScanTint * (scanBand + ${WAKE_OF_BAND} * wake)
                           * uScanEntry * (1.0 - uScanReveal);`,
    );
}

const ON = Object.freeze({ onBeforeCompile: scanBandOnBeforeCompile });
const OFF = Object.freeze({});

/**
 * Off means no callback prop at all, not an identity shader callback.
 *
 * `span` is this structure's own reach along the sweep axis. It travels on
 * `userData` because that is where the shared `onBeforeCompile` can reach it —
 * see the note about `this` there.
 */
export function scanBandMaterialProps(
  enabled: boolean,
  span?: readonly [number, number],
  revealColour?: readonly [number, number, number],
) {
  if (!enabled) return OFF;
  if (!span && !revealColour) return ON;
  return { ...ON, userData: { scanSpan: span, revealColour } };
}

/**
 * Where the sweep is, from 0 at one end of its travel to 1 at the other.
 *
 * Published so a control can follow the sweep without the sweep having to
 * report to React sixty times a second — the slider reads this in its own frame
 * loop, exactly as the readout reads what is being crossed.
 */
export const SWEEP_PROGRESS = { value: 0 };

/**
 * How far above the crown the ring starts, as a fraction of the body's height.
 *
 * Shared with the ring rather than owned by it: the descent has to end exactly
 * where the sweep begins, and two numbers that have to agree are one number.
 */
export const SCAN_DROP = 0.42;

/**
 * Back to the start of the mode: at the head, still, and dark.
 *
 * **The sweep starts at the crown and travels down**, which is a consequence of
 * how the mode opens rather than a preference. The ring descends into frame
 * from above; a sweep that then began at the feet would mean the instrument
 * arriving at the head and the light appearing at the ankles. Head-first is
 * also the order a reader expects of a scan, and the order the crossing readout
 * names structures in.
 */
export function resetScanBand(): void {
  // Half a cycle is the far end of the outward stroke, so the next frame is the
  // first of the return leg: downward, from the crown.
  elapsed = SWEEP_CYCLE_S / 2;
  SWEEP_PROGRESS.value = 1;
  resetScanEntry();
}

/** Put the arrival back to the start, so the mode comes up again. */
export function resetScanEntry(): void {
  entry = 0;
  SCAN_ENTRY.value = 0;
}

/**
 * Advance the arrival. Called once per frame while the mode is on.
 *
 * Eased at both ends rather than linear: a ramp that starts and stops abruptly
 * reads as a fade, and a fade is a transition between two pictures. This is
 * meant to read as a machine powering up, which has weight at the beginning and
 * settles at the end.
 */
export function advanceScanEntry(delta: number): number {
  entry = Math.max(0, Math.min(1, entry + delta / SCAN_ENTRY_S));
  // Smootherstep rather than smoothstep: its first *and* second derivatives are
  // zero at both ends, so there is no moment where the movement visibly starts
  // or visibly stops. Smoothstep still arrives with a small kick, which is what
  // made the short entrance read as a switch being flipped.
  SCAN_ENTRY.value = entry * entry * entry * (entry * (entry * 6 - 15) + 10);
  return SCAN_ENTRY.value;
}

/**
 * Put the sweep where the reader wants it.
 *
 * `elapsed` is wound to match, so letting go resumes from that height instead
 * of jumping back to wherever the clock had got to. Always on the outward half
 * of the stroke: a reader who released at the chest expects the next movement
 * to be gentle and downward, not a snap to the far end.
 */
export function holdScanBand(
  progress: number,
  axis: ScanAxis,
  from: number,
  to: number,
): void {
  const clamped = Math.max(0, Math.min(1, progress));
  const unit = normalise(axis);
  SHARED_AXIS.value[0] = unit[0];
  SHARED_AXIS.value[1] = unit[1];
  SHARED_AXIS.value[2] = unit[2];

  elapsed = clamped * (SWEEP_CYCLE_S / 2);
  SWEEP_PROGRESS.value = clamped;
  SHARED_SCAN.value = from + (to - from) * clamped;
}

/**
 * How far a box reaches along an arbitrary axis.
 *
 * The band used to sweep `bounds.min.y` to `bounds.max.y`, which is only the
 * extent along the axis while the axis *is* Y. For any other direction the
 * extent of an axis-aligned box is its centre projected onto the axis, plus or
 * minus the half-extents weighted by the absolute components — the standard
 * projection, exact and O(1), no corner walking.
 */
export function scanRangeAlong(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  axis: ScanAxis,
): { from: number; to: number } {
  const unit = normalise(axis);
  let centre = 0;
  let reach = 0;
  for (let i = 0; i < 3; i++) {
    centre += ((min[i]! + max[i]!) / 2) * unit[i]!;
    reach += ((max[i]! - min[i]!) / 2) * Math.abs(unit[i]!);
  }
  return { from: centre - reach, to: centre + reach };
}

/**
 * Advance the sweep. Called once per frame by the scene, never per material.
 *
 * `from` and `to` are distances along `axis`, as `scanRangeAlong` returns them.
 */
export function advanceScanBand(
  delta: number,
  axis: ScanAxis,
  from: number,
  to: number,
): void {
  const unit = normalise(axis);
  SHARED_AXIS.value[0] = unit[0];
  SHARED_AXIS.value[1] = unit[1];
  SHARED_AXIS.value[2] = unit[2];

  // The sweep travels at the rate the instrument is up.
  //
  // Without this the entrance is a contradiction: lights rising slowly over a
  // plane already crossing the body at full speed. Scaled by the arrival, the
  // machine powers up almost still and eases into its cadence — and once it is
  // up the factor is 1, so nothing about the sweep's own timing changes.
  elapsed = (elapsed + delta * SCAN_ENTRY.value) % SWEEP_CYCLE_S;
  const half = SWEEP_CYCLE_S / 2;
  const progress = elapsed <= half ? elapsed / half : (SWEEP_CYCLE_S - elapsed) / half;
  SWEEP_PROGRESS.value = progress;
  SHARED_SCAN.value = from + (to - from) * progress;
}

/** A zero-length axis would put the whole body in the band; refuse it. */
function normalise(axis: ScanAxis): [number, number, number] {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error("Patient scan: the sweep axis must have a direction.");
  }
  return [axis[0] / length, axis[1] / length, axis[2] / length];
}
