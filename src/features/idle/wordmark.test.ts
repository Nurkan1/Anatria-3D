import { describe, expect, it } from "vitest";

import { LOOK, waveState, wordmarkAt } from "./IdleScreen";

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

/**
 * The procession of waves. Pure arithmetic, so the rhythm can be checked
 * without a GPU — and the rhythm is the whole of whether it reads as thoughts
 * or as a scanner.
 */
describe("the waves", () => {
  it("never has them all in flight at once", () => {
    // Three fronts starting together is a flash, not a procession. The
    // staggering is what keeps it looking like separate events.
    for (let t = 0; t < 120; t += 0.1) {
      const alive = Array.from({ length: LOOK.waves }, (_, i) => waveState(i, t))
        .filter((wave) => wave.active).length;
      expect(alive).toBeLessThan(LOOK.waves);
    }
  });

  it("keeps one in flight almost all of the time", () => {
    // The other side of the same balance: too much rest and the brain sits
    // dark long enough to look broken rather than calm.
    let quiet = 0;
    let samples = 0;
    for (let t = 10; t < 120; t += 0.1) {
      samples += 1;
      const alive = Array.from({ length: LOOK.waves }, (_, i) => waveState(i, t))
        .filter((wave) => wave.active).length;
      if (alive === 0) quiet += 1;
    }

    expect(quiet / samples).toBeLessThan(0.2);
  });

  it("counts a new emission each time round, so a new origin is chosen", () => {
    // The frame loop reseeds on this number changing. If it did not advance,
    // every wave would leave from the same point for ever.
    const period = LOOK.waveLife + LOOK.waveRest;

    expect(waveState(0, 0.1).emission).toBe(0);
    expect(waveState(0, period + 0.1).emission).toBe(1);
    expect(waveState(0, period * 4 + 0.1).emission).toBe(4);
  });

  it("holds one origin for the whole of one wave", () => {
    // Reseeding mid-flight would move the front's centre while it travelled,
    // which reads as a glitch rather than as motion.
    const early = waveState(0, 0.2).emission;
    const late = waveState(0, LOOK.waveLife - 0.2).emission;

    expect(late).toBe(early);
  });

  it("stays quiet before its turn has come", () => {
    // Wave 2 is offset into the period, and must not be born at t=0 with a
    // negative age the shader would read as a front already crossing.
    expect(waveState(LOOK.waves - 1, 0).active).toBe(false);
    expect(waveState(LOOK.waves - 1, 0).age).toBeGreaterThanOrEqual(0);
  });

  it("ages from zero to its life and no further", () => {
    for (let t = 0; t < 200; t += 0.07) {
      const wave = waveState(0, t);
      expect(wave.age).toBeGreaterThanOrEqual(0);
      if (wave.active) expect(wave.age).toBeLessThanOrEqual(LOOK.waveLife);
    }
  });
});
