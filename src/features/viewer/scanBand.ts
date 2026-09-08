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

let elapsed = 0;

/** One full there-and-back, in seconds. */
const CYCLE = 12;

type Shader = Parameters<Material["onBeforeCompile"]>[0];

/** The same function object is attached to every experimental material. */
export function scanBandOnBeforeCompile(shader: Shader): void {
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
    "uniform float uScanAt;\nvarying float vScanAlong;\n" +
    shader.fragmentShader.replace(
      fragmentChunk,
      `${fragmentChunk}
    float scanBand = 1.0 - smoothstep(0.008, 0.025, abs(vScanAlong - uScanAt));
    totalEmissiveRadiance += vec3(0.1, 1.2, 1.5) * scanBand;`,
    );
}

const ON = Object.freeze({ onBeforeCompile: scanBandOnBeforeCompile });
const OFF = Object.freeze({});

/** Off means no callback prop at all, not an identity shader callback. */
export function scanBandMaterialProps(enabled: boolean) {
  return enabled ? ON : OFF;
}

export function resetScanBand(): void {
  elapsed = 0;
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

  elapsed = (elapsed + delta) % CYCLE;
  const half = CYCLE / 2;
  const progress = elapsed <= half ? elapsed / half : (CYCLE - elapsed) / half;
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
