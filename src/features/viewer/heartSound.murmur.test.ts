import { describe, expect, it } from "vitest";

import { murmurEnvelope } from "./heartSound";

describe("murmurEnvelope", () => {
  it("starts and ends silent for every shape, so no murmur clicks", () => {
    for (const shape of ["diamond", "plateau", "decrescendo", "rumble"] as const) {
      const curve = murmurEnvelope(shape);
      expect(curve[0]).toBeLessThan(0.01);
      expect(curve[curve.length - 1]).toBeLessThan(0.01);
      expect(Array.from(curve).every((v) => v > 0)).toBe(true);
    }
  });

  it("peaks in the middle for a diamond and early for a decrescendo", () => {
    const diamond = Array.from(murmurEnvelope("diamond", 33));
    expect(diamond.indexOf(Math.max(...diamond))).toBe(16);
    const fading = Array.from(murmurEnvelope("decrescendo", 33));
    expect(fading.indexOf(Math.max(...fading))).toBeLessThan(6);
  });

  it("grows at its end for the rumble", () => {
    const rumble = murmurEnvelope("rumble", 33);
    expect(rumble[28]!).toBeGreaterThan(rumble[12]!);
  });
});
