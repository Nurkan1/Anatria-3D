import { beforeEach, expect, it, vi } from "vitest";
import { Material, MeshStandardMaterial, ShaderLib, UniformsUtils, type WebGLRenderer } from "three";

import {
  advanceScanBand,
  advanceScanEntry,
  holdScanBand,
  resetScanBand,
  resetScanEntry,
  SCAN_ENTRY,
  SCAN_ENTRY_S,
  SCAN_DIRECTION,
  SCAN_GHOST,
  SCAN_REVEAL,
  SCAN_TINT,
  setScanGhost,
  setScanReveal,
  setScanTint,
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
  // Up, unless a test is about the arrival itself. The sweep travels at the
  // rate the instrument is up, so a suite left at zero would be testing a
  // scanner that has not finished switching on.
  advanceScanEntry(SCAN_ENTRY_S);
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
  //
  // It opens at `to` rather than at `from`: the mode's entrance is a ring
  // descending onto the crown, so the first stroke goes down.
  const quarter = SWEEP_CYCLE_S / 4;
  advanceScanBand(0, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(1);
  advanceScanBand(quarter * 2, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
  advanceScanBand(quarter, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(0);
  advanceScanBand(quarter, STANDING, -1, 1);
  expect(SHARED_SCAN.value).toBe(1);
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
  expect(SHARED_SCAN.value).toBe(1);

  advanceScanBand(SWEEP_CYCLE_S / 2, SUPINE, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
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

// ---------------------------------------------------------------------------
// The arrival
// ---------------------------------------------------------------------------
//
// Switching the mode on is a shot rather than a state change, and the ring and
// the light on the body have to come up together. They do because both read
// this one uniform — the ring never runs a clock of its own.

it("starts dark, so nothing is lit the frame the switch is thrown", () => {
  resetScanEntry();
  expect(SCAN_ENTRY.value).toBe(0);
});

it("does not travel until the instrument is up", () => {
  // The entrance would otherwise contradict itself: lights rising slowly over
  // a plane already crossing the body at full speed.
  resetScanBand();
  advanceScanBand(SWEEP_CYCLE_S / 4, STANDING, -1, 1);
  // Still at the crown, where it was put: a quarter of a cycle of travel that
  // moved it nowhere.
  expect(SWEEP_PROGRESS.value).toBe(1);

  advanceScanEntry(SCAN_ENTRY_S);
  advanceScanBand(SWEEP_CYCLE_S / 4, STANDING, -1, 1);
  expect(SWEEP_PROGRESS.value).toBeCloseTo(0.5);
});

it("is fully up after its own duration, and goes no further", () => {
  resetScanEntry();
  advanceScanEntry(SCAN_ENTRY_S);
  expect(SCAN_ENTRY.value).toBeCloseTo(1);
  advanceScanEntry(SCAN_ENTRY_S * 4);
  expect(SCAN_ENTRY.value).toBe(1);
});

it("eases rather than ramping, so the arrival has weight at the start", () => {
  // A linear ramp reads as a fade between two pictures. This one is behind
  // linear early and ahead of it late, which is what a machine powering up
  // looks like.
  resetScanEntry();
  advanceScanEntry(SCAN_ENTRY_S * 0.25);
  expect(SCAN_ENTRY.value).toBeLessThan(0.25);
  advanceScanEntry(SCAN_ENTRY_S * 0.5);
  expect(SCAN_ENTRY.value).toBeGreaterThan(0.75);
});

it("winds the arrival back with the sweep, and on its own", () => {
  resetScanEntry();
  advanceScanEntry(SCAN_ENTRY_S);
  resetScanBand();
  expect(SCAN_ENTRY.value).toBe(0);

  advanceScanEntry(SCAN_ENTRY_S);
  resetScanEntry();
  expect(SCAN_ENTRY.value).toBe(0);
});

it("scales everything the mode adds by the arrival, from one shared uniform", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true, [0.2, 0.5]));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true, [1.1, 1.4]));
  const a = shader();
  const b = shader();
  first.onBeforeCompile(a, {} as WebGLRenderer);
  second.onBeforeCompile(b, {} as WebGLRenderer);
  expect(a.uniforms.uScanEntry).toBe(SCAN_ENTRY);
  expect(b.uniforms.uScanEntry).toBe(a.uniforms.uScanEntry);
  // Both terms inside the multiplication: an entrance that brought the band up
  // but left the wake at full strength would light a structure before the
  // instrument that is supposed to be reading it exists.
  expect(a.fragmentShader).toContain("uScanTint * (scanBand + 0.29 * wake)");
  expect(a.fragmentShader).toContain("* uScanEntry * (1.0 - uScanReveal);");
});

it("opens at the crown, because the ring arrives from above it", () => {
  resetScanBand();
  advanceScanBand(0, STANDING, -1, 1);
  expect(SWEEP_PROGRESS.value).toBe(1);
  expect(SHARED_SCAN.value).toBe(1);
});

// ---------------------------------------------------------------------------
// The colour of the light
// ---------------------------------------------------------------------------

it("shares one colour uniform, and changes it without replacing the object", () => {
  // Every material holds a reference to this object. Assigning a new one would
  // leave 3,478 shaders pointing at the value the mode started with, and the
  // symptom would be a colour that changes on the ring and nowhere else.
  const first = new MeshStandardMaterial(scanBandMaterialProps(true));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true));
  const a = shader();
  const b = shader();
  first.onBeforeCompile(a, {} as WebGLRenderer);
  second.onBeforeCompile(b, {} as WebGLRenderer);
  expect(a.uniforms.uScanTint).toBe(SCAN_TINT);
  expect(b.uniforms.uScanTint).toBe(a.uniforms.uScanTint);

  const held = SCAN_TINT.value;
  setScanTint([1.5, 0.72, 0.14]);
  expect(SCAN_TINT.value).toBe(held);
  expect(SCAN_TINT.value).toEqual([1.5, 0.72, 0.14]);
});

it("tints the band and its wake with the same colour", () => {
  // Two colours would let them drift apart in hue, which is how an early
  // version ended up with a green plane trailing a blue-green body.
  const compiled = shader();
  scanBandOnBeforeCompile(compiled);
  expect(compiled.fragmentShader).toContain("uniform vec3 uScanTint;");
  expect(compiled.fragmentShader).toContain("uScanTint * (scanBand +");
});

// ---------------------------------------------------------------------------
// Colour instead of light
// ---------------------------------------------------------------------------

it("keeps one program even though every structure carries its own colour", () => {
  // The whole mode rests on this. A per-material *value* plays no part in the
  // cache key; a per-material closure would, and 3,478 compiles would freeze
  // the window for seconds on the way in.
  const first = new MeshStandardMaterial(scanBandMaterialProps(true, [0.2, 0.5], [0.9, 0.1, 0.1]));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true, [1.1, 1.4], [0.1, 0.2, 0.9]));
  expect(first.onBeforeCompile).toBe(second.onBeforeCompile);
  expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
});

it("gives each material the colour it was built with", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true, [0.2, 0.5], [0.9, 0.1, 0.1]));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true, [1.1, 1.4], [0.1, 0.2, 0.9]));
  const a = shader();
  const b = shader();
  first.onBeforeCompile(a, {} as WebGLRenderer);
  second.onBeforeCompile(b, {} as WebGLRenderer);
  expect(a.uniforms.uRevealColour?.value).toEqual([0.9, 0.1, 0.1]);
  expect(b.uniforms.uRevealColour?.value).toEqual([0.1, 0.2, 0.9]);
  // The switch itself is shared: one write turns the mode on everywhere.
  expect(a.uniforms.uScanReveal).toBe(SCAN_REVEAL);
  expect(b.uniforms.uScanReveal).toBe(a.uniforms.uScanReveal);
});

it("leaves a material with no colour of its own alone", () => {
  // Every material is in this state for the first render after the mode is
  // switched on. A sentinel that read as a colour would flash the body black.
  const material = new MeshStandardMaterial(scanBandMaterialProps(true, [0.2, 0.5]));
  const compiled = shader();
  material.onBeforeCompile(compiled, {} as WebGLRenderer);
  expect(compiled.uniforms.uRevealColour?.value[0]).toBeLessThan(0);
  expect(compiled.fragmentShader).toContain("uRevealColour.r < 0.0 ? diffuseColor.rgb");
});

it("reveals the colour before the lighting runs, not after", () => {
  // The reason this costs a mix and not a shader of its own: the injection
  // point sits ahead of the lighting model, so a revealed structure is lit
  // like tissue instead of looking pasted on.
  const compiled = shader();
  scanBandOnBeforeCompile(compiled);
  const mix = compiled.fragmentShader.indexOf("diffuseColor.rgb = mix(");
  const lighting = compiled.fragmentShader.indexOf("#include <lights_physical_fragment>");
  expect(mix).toBeGreaterThan(0);
  expect(lighting).toBeGreaterThan(mix);
});

it("stands the glow down while colour is doing the telling", () => {
  // Both at once is worse than either: a hue seen through an additive wash is
  // a paler version of itself.
  const compiled = shader();
  scanBandOnBeforeCompile(compiled);
  expect(compiled.fragmentShader).toContain("* uScanEntry * (1.0 - uScanReveal);");
});

it("switches with one float write, into the object every shader holds", () => {
  const held = SCAN_REVEAL.value;
  setScanReveal(true);
  expect(SCAN_REVEAL.value).toBe(1);
  setScanReveal(false);
  expect(SCAN_REVEAL.value).toBe(0);
  expect(typeof held).toBe("number");
});

it("reads a structure's height from where it is, not from where it is drawn", () => {
  // The eye bug, written down.
  //
  // The eye parts are drawn inside a group that turns them, so their matrices
  // are rebased onto the eye's own centre and sit near the origin. A span taken
  // from one of those is the span of a structure at the height of the feet —
  // while the shader reads each fragment's world position from `modelMatrix`
  // and knows perfectly well the eye is in the head. The eyes lit when the
  // plane reached the ankles and never lit when it crossed the face.
  const inTheHead = scanRangeAlong([-0.03, 1.62, 0.08], [0.03, 1.66, 0.12], STANDING);
  expect(inTheHead.from).toBeCloseTo(1.62);
  expect(inTheHead.to).toBeCloseTo(1.66);

  // The same eye, in the space it is drawn in.
  const asDrawn = scanRangeAlong([-0.03, -0.02, -0.02], [0.03, 0.02, 0.02], STANDING);
  expect(asDrawn.from).toBeCloseTo(-0.02);
  expect(asDrawn.to).toBeCloseTo(0.02);

  // Which is why the span must come from the scene's own measurement: the two
  // answers are a whole body apart, and only one of them is where the light is.
  expect(Math.abs(inTheHead.from - asDrawn.from)).toBeGreaterThan(1.5);
});

// ---------------------------------------------------------------------------
// What has already been read
// ---------------------------------------------------------------------------

it("takes the direction from the movement, not from the clock", () => {
  // The clock version assumes `from` lies below `to`, which is true for one
  // axis and one body position, and it says nothing at all while a reader is
  // dragging the light — the moment the direction is most obviously real.
  resetScanBand();
  advanceScanEntry(SCAN_ENTRY_S);

  advanceScanBand(0, STANDING, -1, 1);
  advanceScanBand(SWEEP_CYCLE_S / 8, STANDING, -1, 1);
  expect(SCAN_DIRECTION.value).toBe(-1); // opens at the crown, travels down

  // In steps the size of a frame, deliberately. The direction is sampled from
  // one position to the next, so a single huge step reports the chord rather
  // than the travel — jump half a cycle and it can say "down" while the sweep
  // is on its way back up. At sixteen milliseconds a frame the two agree.
  for (let i = 0; i < 40; i++) advanceScanBand(0.25, STANDING, -1, 1);
  expect(SCAN_DIRECTION.value).toBe(1); // past the feet and back up
});

it("follows a drag as readily as it follows the sweep", () => {
  holdScanBand(0.2, STANDING, -1, 1);
  holdScanBand(0.8, STANDING, -1, 1);
  expect(SCAN_DIRECTION.value).toBe(1);
  holdScanBand(0.1, STANDING, -1, 1);
  expect(SCAN_DIRECTION.value).toBe(-1);
});

it("holds its last direction when nothing moves", () => {
  // A light standing still still arrived from somewhere, and the body behind
  // it must not un-fade because the reader stopped.
  holdScanBand(0.8, STANDING, -1, 1);
  const settled = SCAN_DIRECTION.value;
  holdScanBand(0.8, STANDING, -1, 1);
  expect(SCAN_DIRECTION.value).toBe(settled);
});

it("plays down what is behind the plane, and lets the reveal win", () => {
  const compiled = shader();
  scanBandOnBeforeCompile(compiled);
  expect(compiled.fragmentShader).toContain("uniform float uScanGhost;");
  expect(compiled.fragmentShader).toContain("(uScanAt - vScanAlong) * uScanDirection");

  // Order is the whole of it: a structure the plane is inside is the one being
  // read right now, and dimming it because most of it lies behind the plane
  // would play down the only thing worth looking at.
  const ghost = compiled.fragmentShader.indexOf("vec3(grey) * 0.32");
  const reveal = compiled.fragmentShader.indexOf("revealTo, wake * uScanReveal");
  expect(ghost).toBeGreaterThan(0);
  expect(reveal).toBeGreaterThan(ghost);
});

it("switches with one float write into the shared object", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true));
  const a = shader();
  first.onBeforeCompile(a, {} as WebGLRenderer);
  expect(a.uniforms.uScanGhost).toBe(SCAN_GHOST);
  expect(a.uniforms.uScanDirection).toBe(SCAN_DIRECTION);

  setScanGhost(true);
  expect(SCAN_GHOST.value).toBe(1);
  setScanGhost(false);
  expect(SCAN_GHOST.value).toBe(0);
});
