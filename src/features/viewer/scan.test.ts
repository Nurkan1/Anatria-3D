import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { keepsColour, scanColour, SCAN_SATURATION } from "./scan";
import { tissueColour } from "./palette";

const hsl = () => ({ h: 0, s: 0, l: 0 });

const organ = (organ_id: string, system: string) =>
  ({ organ_id, system }) as Parameters<typeof tissueColour>[0];

describe("the scanned body", () => {
  it("keeps a tissue's lightness exactly", () => {
    // This is what stops the mode from deleting the anatomy. Bone has to stay
    // lighter than muscle or the body becomes a silhouette.
    const tissue = new THREE.Color("#c0392b");
    const before = hsl();
    tissue.getHSL(before);

    const after = hsl();
    scanColour(tissue).getHSL(after);

    expect(after.l).toBeCloseTo(before.l, 10);
  });

  it("drops saturation to a trace", () => {
    const tissue = new THREE.Color("#c0392b");
    const before = hsl();
    tissue.getHSL(before);

    const after = hsl();
    scanColour(tissue).getHSL(after);

    expect(after.s).toBeCloseTo(before.s * SCAN_SATURATION, 10);
    expect(after.s).toBeGreaterThan(0);
    expect(after.s).toBeLessThan(0.1);
  });

  it("leaves the tissue it was given alone", () => {
    // The palette caches its colours per structure and hands out the same
    // object every time. Mutating one here would repaint that tissue for the
    // rest of the session, and switching the mode off would not bring it back.
    const tissue = new THREE.Color("#c0392b");
    const hex = tissue.getHexString();

    scanColour(tissue);

    expect(tissue.getHexString()).toBe(hex);
  });

  it("keeps bone lighter than muscle, which is the point", () => {
    const bone = hsl();
    const muscle = hsl();
    scanColour(tissueColour(organ("femur", "skeletal"))).getHSL(bone);
    scanColour(tissueColour(organ("biceps_brachii_muscle", "muscular"))).getHSL(muscle);

    expect(bone.l).toBeGreaterThan(muscle.l);
  });

  it("is idempotent enough that scanning twice changes almost nothing", () => {
    const once = scanColour(new THREE.Color("#c0392b"));
    const twice = scanColour(once);

    const a = hsl();
    const b = hsl();
    once.getHSL(a);
    twice.getHSL(b);

    expect(b.l).toBeCloseTo(a.l, 10);
    expect(b.s).toBeLessThanOrEqual(a.s);
  });
});

describe("what keeps its colour", () => {
  it("is what the assistant lit", () => {
    expect(keepsColour({ lit: true, selected: false, isolated: false })).toBe(true);
  });

  it("is what the reader selected", () => {
    // Losing your own place every time the mode goes on would make it a mode
    // you switch off to get your bearings back.
    expect(keepsColour({ lit: false, selected: true, isolated: false })).toBe(true);
  });

  it("is an isolated region", () => {
    expect(keepsColour({ lit: false, selected: false, isolated: true })).toBe(true);
  });

  it("is nothing else", () => {
    expect(keepsColour({ lit: false, selected: false, isolated: false })).toBe(false);
  });
});
