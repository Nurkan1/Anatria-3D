import { describe, expect, it } from "vitest";

import { LOOK, wordmarkAt } from "./IdleScreen";

/**
 * The timing of the wordmark, which is the whole of whether it feels like an
 * ornament or an advertisement. Pure arithmetic, so it can be checked without
 * a canvas, a GPU or a stopwatch.
 */
describe("when the light writes the name", () => {
  it("shows nothing for most of a cycle", () => {
    // Rare is the point. Seen every few seconds it is a logo animation; seen
    // roughly twice a minute it reads as something the light happened to trace.
    const midGap = LOOK.wordVisible + (LOOK.wordEvery - LOOK.wordVisible) / 2;

    expect(wordmarkAt(midGap).strength).toBe(0);
  });

  it("comes and goes without an edge at either end", () => {
    // A raised cosine: zero at both ends, brightest in the middle. A linear
    // ramp switches on visibly, which is exactly what this must not do.
    expect(wordmarkAt(0).strength).toBeCloseTo(0, 5);
    expect(wordmarkAt(LOOK.wordVisible).strength).toBeCloseTo(0, 5);
    expect(wordmarkAt(LOOK.wordVisible / 2).strength).toBeCloseTo(LOOK.wordStrength, 5);
  });

  it("never exceeds the strength it was given", () => {
    // It is added to the rim and the pulses before driving alpha, and this is
    // an additive shell forty layers deep — an overshoot here is a white blob.
    for (let t = 0; t < LOOK.wordEvery * 4; t += 0.05) {
      expect(wordmarkAt(t).strength).toBeLessThanOrEqual(LOOK.wordStrength + 1e-9);
      expect(wordmarkAt(t).strength).toBeGreaterThanOrEqual(0);
    }
  });

  it("holds one angle for a whole appearance", () => {
    // Derived from the cycle index rather than drawn fresh each frame. Random
    // per frame would smear it through every angle at once, sixty times a
    // second, and read as noise rather than as writing.
    const early = wordmarkAt(0.2).angle;
    const late = wordmarkAt(LOOK.wordVisible - 0.2).angle;

    expect(late).toBe(early);
  });

  it("arrives at a different angle next time", () => {
    // "Different angles" was the request, and consecutive cycles are where a
    // weak hash would give itself away.
    const angles = new Set<number>();
    for (let cycle = 0; cycle < 12; cycle += 1) {
      angles.add(wordmarkAt(cycle * LOOK.wordEvery + 1).angle);
    }

    expect(angles.size).toBeGreaterThanOrEqual(10);
  });

  it("keeps every angle inside one turn", () => {
    // The shader feeds this straight to sin/cos, so a stray sign or magnitude
    // would not fail loudly — it would just point the plane somewhere odd.
    for (let cycle = 0; cycle < 40; cycle += 1) {
      const { angle } = wordmarkAt(cycle * LOOK.wordEvery + 1);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThanOrEqual(Math.PI * 2);
    }
  });
});
