import { beforeEach, expect, it, vi } from "vitest";
import { Material, MeshStandardMaterial, ShaderLib, UniformsUtils, type WebGLRenderer } from "three";

import {
  advanceScanBand,
  holdScanBand,
  resetScanBand,
  scanBandMaterialProps,
  scanBandOnBeforeCompile,
  scanRangeAlong,
  SHARED_AXIS,
  SHARED_SCAN,
  STANDING,
  SWEEP_CYCLE_S,
  SWEEP_PROGRESS,
  type ScanAxis,
} from "./scanBand";

function shader() {
  return {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
  } as Parameters<Material["onBeforeCompile"]>[0];
}

/** Feet to head for a body laid on its back, head towards −Z. */
const SUPINE: ScanAxis = [0, 0, -1];

beforeEach(() => {
  resetScanBand();
  advanceScanBand(0, STANDING, 0, 0);
});

it("uses the same callback and default cache key for two separate materials", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true));
  expect(first).not.toBe(second);
  expect(first.onBeforeCompile).toBe(scanBandOnBeforeCompile);
  expect(second.onBeforeCompile).toBe(first.onBeforeCompile);
  expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
  expect(first.customProgramCacheKey).toBe(Material.prototype.customProgramCacheKey);
});

it("binds exactly the same uniform objects into two independent shaders", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true));
  const a = shader();
  const b = shader();
  first.onBeforeCompile(a, {} as WebGLRenderer);
  second.onBeforeCompile(b, {} as WebGLRenderer);
  expect(a.uniforms.uScanAt).toBe(SHARED_SCAN);
  expect(b.uniforms.uScanAt).toBe(a.uniforms.uScanAt);
  // The axis travels the same way. One write, every material.
  expect(a.uniforms.uScanAxis).toBe(SHARED_AXIS);
  expect(b.uniforms.uScanAxis).toBe(a.uniforms.uScanAxis);
  expect(a.vertexShader).toBe(b.vertexShader);
  expect(a.fragmentShader).toBe(b.fragmentShader);
});

it("writes the shared value once per advance regardless of attached materials", () => {
  const a = shader();
  const b = shader();
  scanBandOnBeforeCompile(a);
  scanBandOnBeforeCompile(b);
  let value = SHARED_SCAN.value;
  const write = vi.fn((next: number) => { value = next; });
  Object.defineProperty(SHARED_SCAN, "value", { configurable: true, get: () => value, set: write });
  try {
    advanceScanBand(SWEEP_CYCLE_S / 4, STANDING, -1, 1);
    expect(write).toHaveBeenCalledExactlyOnceWith(0);
    expect(a.uniforms.uScanAt?.value).toBe(0);
    expect(b.uniforms.uScanAt?.value).toBe(0);
  } finally {
    Object.defineProperty(SHARED_SCAN, "value", { configurable: true, writable: true, value });
  }
});

it("goes from one end to the other and back without walking any materials", () => {
  // Written in fractions of a cycle rather than seconds: the invariant is
  // "half a sweep reaches the far end", and tying it to the current duration
  // made three tests fail when the sweep was slowed down for readability.
  const quarter = SWEEP_CYCLE_S / 4;
  advanceScanBand(0, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
  advanceScanBand(quarter * 2, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(1);
  advanceScanBand(quarter, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(0);
  advanceScanBand(quarter, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
});

// ---------------------------------------------------------------------------
// The axis is a parameter, and this is why
// ---------------------------------------------------------------------------
//
// The band began sweeping world Y, which is feet-to-head only while the body
// stands. Laying it on a gurney turns world Y into shoulder-to-shoulder. These
// fail if anyone reintroduces the assumption, which is the point of them: the
// decision then cannot be lost in a refactor the way a sentence in a brief can.

it("sweeps along the axis it is given, not along Y", () => {
  advanceScanBand(0, SUPINE, -1, 1);
  expect(SHARED_AXIS.value).toEqual([0, 0, -1]);
  expect(SHARED_SCAN.value).toBe(-1);

  advanceScanBand(SWEEP_CYCLE_S / 2, SUPINE, -1, 1);
  expect(SHARED_SCAN.value).toBe(1);
});

it("normalises the axis, so a caller may hand it any length", () => {
  advanceScanBand(0, [0, 0, -4], -1, 1);
  expect(SHARED_AXIS.value).toEqual([0, 0, -1]);
});

it("refuses an axis with no direction rather than lighting the whole body", () => {
  // A zero vector projects every vertex onto 0, so every fragment sits in the
  // band at once. Silently glowing everything is a worse failure than an error.
  expect(() => advanceScanBand(0, [0, 0, 0], -1, 1)).toThrow(/must have a direction/);
});

it("measures a box's reach along the axis, not along Y", () => {
  // A standing body: 0.4 wide, 1.8 tall, 0.3 deep, centred on the origin.
  const min = [-0.2, -0.9, -0.15] as const;
  const max = [0.2, 0.9, 0.15] as const;

  expect(scanRangeAlong(min, max, STANDING)).toEqual({ from: -0.9, to: 0.9 });
  // Along Z the same box reaches 0.15 either way. Reusing the Y extent here
  // would sweep 0.9 of empty space before the band ever touched the body.
  expect(scanRangeAlong(min, max, [0, 0, 1])).toEqual({ from: -0.15, to: 0.15 });
});

it("measures the reach of a box that is not centred on the origin", () => {
  const range = scanRangeAlong([0, 1, 0], [2, 3, 0], [1, 0, 0]);
  expect(range).toEqual({ from: 0, to: 2 });
});

it("measures a diagonal axis rather than the nearest cardinal one", () => {
  // A unit cube from the origin, swept corner to corner: the projection of its
  // half-extent onto a normalised diagonal, twice.
  const range = scanRangeAlong([0, 0, 0], [1, 1, 1], [1, 1, 1]);
  expect(range.to - range.from).toBeCloseTo(Math.sqrt(3), 10);
});

it("does not assign onBeforeCompile at all when disabled, including after a toggle", () => {
  for (const enabled of [false, true, false]) {
    const props = scanBandMaterialProps(enabled);
    const material = new MeshStandardMaterial(props);
    expect(Object.hasOwn(props, "onBeforeCompile")).toBe(enabled);
    expect(Object.hasOwn(material, "onBeforeCompile")).toBe(enabled);
    if (!enabled) expect(material.onBeforeCompile).toBe(Material.prototype.onBeforeCompile);
    material.dispose();
  }
});

it("injects into the installed r185 chunks and fails explicitly if they change", () => {
  const input = shader();
  scanBandOnBeforeCompile(input);
  expect(input.vertexShader).toContain("dot((modelMatrix * vec4(transformed, 1.0)).xyz, uScanAxis)");
  expect(input.fragmentShader).toContain("totalEmissiveRadiance +=");
  expect(() => scanBandOnBeforeCompile({ ...shader(), vertexShader: "changed" })).toThrow(/chunks are missing/);
});

// ---------------------------------------------------------------------------
// A uniform of its own, without losing the shared program
// ---------------------------------------------------------------------------
//
// Lighting a whole structure needs its own reach along the axis, which is
// per-material data. The obvious way to supply it — a closure per mesh — is
// exactly what would end the shared compile. three calls the callback as a
// method, so `this` is the material and one function can serve them all.

it("keeps one cache key even when each material carries its own span", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true, [0.2, 0.5]));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true, [1.1, 1.4]));
  expect(first.onBeforeCompile).toBe(second.onBeforeCompile);
  expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
});

it("gives each material the span it was built with", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true, [0.2, 0.5]));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true, [1.1, 1.4]));
  const a = shader();
  const b = shader();
  first.onBeforeCompile(a, {} as WebGLRenderer);
  second.onBeforeCompile(b, {} as WebGLRenderer);
  expect(a.uniforms.uOrganSpan?.value).toEqual([0.2, 0.5]);
  expect(b.uniforms.uOrganSpan?.value).toEqual([1.1, 1.4]);
  // The sweep position stays shared even though the spans are not.
  expect(a.uniforms.uScanAt).toBe(b.uniforms.uScanAt);
});

it("gives a material with no span one the sweep can never be inside", () => {
  // A zero span would have lit the structure whenever the sweep passed the
  // origin, which on this atlas is around the hips — a bug that looks like a
  // feature.
  const material = new MeshStandardMaterial(scanBandMaterialProps(true));
  const compiled = shader();
  material.onBeforeCompile(compiled, {} as WebGLRenderer);
  const [from, to] = compiled.uniforms.uOrganSpan?.value as [number, number];
  expect(from).toBeGreaterThan(to);
});

it("lights the whole structure as well as the slice", () => {
  const compiled = shader();
  scanBandOnBeforeCompile(compiled);
  expect(compiled.fragmentShader).toContain("uniform vec2 uOrganSpan");
  // Feathered at both ends: a structure arrives and leaves rather than blinks.
  expect(compiled.fragmentShader).toContain("smoothstep(uOrganSpan.x - 0.02");
  expect(compiled.fragmentShader).toContain("1.0 - smoothstep(uOrganSpan.y - 0.02");
});

// ---------------------------------------------------------------------------
// Holding the sweep where the reader put it
// ---------------------------------------------------------------------------

it("puts the sweep exactly where it is held", () => {
  holdScanBand(0, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
  holdScanBand(1, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(1);
  holdScanBand(0.25, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBeCloseTo(-0.5);
});

it("resumes from the height it was left at, not from the clock", () => {
  // The difference between a control and an interruption. A reader who moved
  // the light to the chest and let go expects it to carry on from the chest.
  holdScanBand(0.5, STANDING, -1, 1);
  advanceScanBand(0, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBeCloseTo(0);
});

it("carries on in the outward direction after a hold", () => {
  // Wound onto the first half of the stroke, so the next movement is a gentle
  // continuation rather than a snap to the far end.
  holdScanBand(0.5, STANDING, -1, 1);
  advanceScanBand(SWEEP_CYCLE_S / 4, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBeGreaterThan(0);
});

it("clamps a hold to the travel it actually has", () => {
  holdScanBand(4, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(1);
  holdScanBand(-4, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
});

it("publishes where it is so a control can follow without React", () => {
  holdScanBand(0.3, STANDING, -1, 1);
  expect(SWEEP_PROGRESS.value).toBeCloseTo(0.3);
  advanceScanBand(0, STANDING, -1, 1);
  expect(SWEEP_PROGRESS.value).toBeCloseTo(0.3);
});
