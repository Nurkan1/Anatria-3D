import { describe, expect, it } from "vitest";

import { DEFAULT_TINT, SCAN_TINTS, scanTint } from "./scanTints";

describe("the colours the scanner's light can be", () => {
  it("gives the default for anything that is not one of them", () => {
    // The id arrives from localStorage, which a previous version wrote and a
    // person can edit. A stale preference file must not leave the scanner
    // lighting nothing.
    expect(scanTint(undefined).id).toBe(DEFAULT_TINT);
    expect(scanTint(null).id).toBe(DEFAULT_TINT);
    expect(scanTint("").id).toBe(DEFAULT_TINT);
    expect(scanTint("chartreuse").id).toBe(DEFAULT_TINT);
  });

  it("has the default in the list it offers", () => {
    expect(SCAN_TINTS.some((tint) => tint.id === DEFAULT_TINT)).toBe(true);
  });

  it("names each colour once", () => {
    const ids = SCAN_TINTS.map((tint) => tint.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries radiance, not a screen colour", () => {
    // The light is added to the tissue's own colour and is not clamped to a
    // displayable one. A tint whose components all sat below 1 would be a
    // colour that never reads as light on a lit surface.
    for (const tint of SCAN_TINTS) {
      expect(Math.max(...tint.light)).toBeGreaterThanOrEqual(1);
      expect(Math.min(...tint.light)).toBeGreaterThan(0);
    }
  });

  it("gives every colour a surface tint the ring and the swatch can use", () => {
    for (const tint of SCAN_TINTS) {
      expect(tint.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(tint.label.length).toBeGreaterThan(0);
    }
  });

  it("points each hex at the same hue as its radiance", () => {
    // Written separately on purpose — one is an intensity, the other a surface
    // colour — but they are the same light, and a ring that glows amber while
    // the body lights green would be two machines.
    for (const tint of SCAN_TINTS) {
      const hex = [1, 3, 5].map((at) => parseInt(tint.hex.slice(at, at + 2), 16) / 255);
      const brightestChannel = tint.light.indexOf(Math.max(...tint.light));
      expect(hex.indexOf(Math.max(...hex))).toBe(brightestChannel);
    }
  });
});
