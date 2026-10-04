import { describe, expect, it } from "vitest";

import { BREATH_PATTERNS } from "./breathing";
import { ClockTrace } from "./EcgStrip";
import { breathNote } from "./HeartControls";
import { RESTING_BPM } from "./heartbeat";
import { rhythm, RhythmPlayer, RHYTHMS, type RhythmId } from "./rhythms";
import { BreathPacer, sinusPace } from "./sinusArrhythmia";

/**
 * Play a rhythm for `seconds` of real time at a steady swing, as the driver
 * does frame by frame, and say when in real time each first and second heart
 * sound fell.
 */
function play(id: RhythmId, swing: number, seconds = 40, frame = 1 / 120) {
  const player = new RhythmPlayer(rhythm(id));
  const pacer = new BreathPacer();
  const lub: number[] = [];
  const dub: number[] = [];
  let heart = 0;
  let real = 0;
  let resting = true;
  while (real < seconds) {
    const before = heart;
    heart += pacer.advance(frame, swing, resting);
    real += frame;
    const beat = player.advance(before, heart);
    resting = beat.atria === 0 && beat.ventricles === 0;
    for (let i = 0; i < beat.lub.length; i++) lub.push(real);
    for (let i = 0; i < beat.dub.length; i++) dub.push(real);
  }
  return { lub, dub };
}

/** The mean interval between beats after the first few, while the pacer settles. */
function meanInterval(times: number[]): number {
  const settled = times.slice(5);
  return (settled[settled.length - 1]! - settled[0]!) / (settled.length - 1);
}

const NORMAL_RR = 60 / RESTING_BPM;

describe("where the heart is in the breath", () => {
  for (const [id, pattern] of Object.entries(BREATH_PATTERNS)) {
    it(`${id}: slowest as a breath begins, rising through the breath in, fastest just after it`, () => {
      expect(sinusPace(0, pattern)).toBeCloseTo(-1);
      expect(sinusPace(pattern.period / 2, pattern)).toBeCloseTo(1);
      const endOfIn = pattern.period * pattern.inhale;
      expect(sinusPace(endOfIn * 0.5, pattern)).toBeLessThan(sinusPace(endOfIn, pattern));
      // The peak comes after the breath in has ended: the heart follows a little late.
      expect(pattern.period / 2).toBeGreaterThan(endOfIn);
    });

    it(`${id}: averages out over a breath, so the rhythm keeps its own rate`, () => {
      let sum = 0;
      const n = 1000;
      for (let i = 0; i < n; i++) sum += sinusPace((i / n) * pattern.period, pattern);
      expect(Math.abs(sum / n)).toBeLessThan(1e-6);
    });
  }

  it("swings most with slow deep breaths, by what a healthy young heart does", () => {
    const { quiet, deep } = BREATH_PATTERNS;
    expect(deep.sinusSwing).toBeGreaterThan(quiet.sinusSwing);
    // The deep-breathing test: commonly more than 15 a minute, fastest to slowest.
    expect(RESTING_BPM * 2 * deep.sinusSwing).toBeGreaterThanOrEqual(15);
    // And at rest a few beats a minute, not a racing heart.
    expect(RESTING_BPM * 2 * quiet.sinusSwing).toBeLessThan(10);
  });
});

describe("the heart's clock against real time", () => {
  it("passes time through untouched with no swing, or while anything contracts", () => {
    const pacer = new BreathPacer();
    expect(pacer.advance(0.016, 0, true)).toBe(0.016);
    expect(pacer.advance(0.016, 0.1, false)).toBe(0.016);
  });

  it("plays the rhythm exactly as before when the breath does not pull", () => {
    const { lub } = play("normal", 0);
    expect(meanInterval(lub)).toBeCloseTo(NORMAL_RR, 2);
  });

  it("moves the whole interval between beats by the swing asked for", () => {
    for (const swing of [0.05, -0.05, 0.11, -0.11]) {
      const interval = meanInterval(play("normal", swing).lub);
      expect(Math.abs(interval / (NORMAL_RR / (1 + swing)) - 1)).toBeLessThan(0.02);
    }
  });

  it("shortens the rest between beats and leaves the contraction its length", () => {
    const systole = (times: { lub: number[]; dub: number[] }) => {
      const lengths = times.lub.slice(5, 20).map((at) => times.dub.find((d) => d > at)! - at);
      return lengths.reduce((a, b) => a + b, 0) / lengths.length;
    };
    const atRest = systole(play("normal", 0));
    expect(systole(play("normal", 0.11))).toBeCloseTo(atRest, 2);
    expect(systole(play("normal", -0.11))).toBeCloseTo(atRest, 2);
  });
});

describe("which rhythms follow the breath", () => {
  it("lets it reach a heart the sinus node paces", () => {
    for (const id of ["normal", "sinus_bradycardia", "av_block_1", "aortic_stenosis"] as const) {
      expect(rhythm(id).followsBreath).toBe(1);
    }
    // A fast sinus rate has little vagal pull left to lose.
    expect(rhythm("sinus_tachycardia").followsBreath).toBeLessThan(1);
    expect(rhythm("sinus_tachycardia").followsBreath).toBeGreaterThan(0);
  });

  it("keeps it from ventricles something else is pacing", () => {
    for (const id of [
      "atrial_fibrillation",
      "atrial_flutter",
      "av_block_3",
      "ventricular_tachycardia",
      "ventricular_fibrillation",
      "asystole",
    ] as const) {
      expect(rhythm(id).followsBreath ?? 0).toBe(0);
    }
  });

  it("never asks for more than the whole swing", () => {
    for (const definition of RHYTHMS) {
      expect(definition.followsBreath ?? 0).toBeGreaterThanOrEqual(0);
      expect(definition.followsBreath ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("says so in the heartbeat's panel, of the rhythm on screen", () => {
    expect(breathNote(1)).toMatch(/rises as the breath comes in/);
    expect(breathNote(0.3)).toMatch(/small/);
    expect(breathNote(0)).toMatch(/does not follow/);
  });
});

describe("the strip's two clocks", () => {
  it("is real time before anything is recorded", () => {
    expect(new ClockTrace().heartAt(3.2)).toBe(3.2);
  });

  it("reads the heart's time between frames on a straight line", () => {
    const trace = new ClockTrace();
    trace.push(1, 1);
    trace.push(2, 2.2);
    trace.push(3, 3.1);
    expect(trace.heartAt(1.5)).toBeCloseTo(1.6);
    expect(trace.heartAt(2.5)).toBeCloseTo(2.65);
    // Outside what was recorded, at real speed.
    expect(trace.heartAt(3.5)).toBeCloseTo(3.6);
    expect(trace.heartAt(0.5)).toBeCloseTo(0.5);
  });

  it("forgets the oldest frames and keeps the newest", () => {
    const trace = new ClockTrace();
    for (let i = 0; i < 500; i++) trace.push(i * 0.01, i * 0.02);
    expect(trace.heartAt(4.985)).toBeCloseTo(9.97);
  });
});
