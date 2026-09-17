import { describe, expect, it } from "vitest";

import { beatAt, RESTING_BPM, SQUEEZE } from "./heartbeat";
import { RHYTHM_GROUPS, RHYTHMS, RhythmPlayer, rhythm, systoleFor, type RhythmId } from "./rhythms";

/** Play a rhythm for `seconds` at 60 frames a second, and collect what happened. */
function play(id: RhythmId, seconds = 20) {
  const player = new RhythmPlayer(rhythm(id));
  const frames: { t: number; atria: number; ventricles: number }[] = [];
  const lub: { t: number; level: number }[] = [];
  const dub: { t: number; level: number }[] = [];
  let t = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const next = t + 1 / 60;
    const result = player.advance(t, next);
    frames.push({ t: next, atria: result.atria, ventricles: result.ventricles });
    for (const level of result.lub) lub.push({ t: next, level });
    for (const level of result.dub) dub.push({ t: next, level });
    t = next;
  }
  return { frames, lub, dub };
}

/** When each ventricular contraction started, read from the first sounds. */
const starts = (sounds: { t: number }[]) => sounds.map((sound) => sound.t);
const intervals = (times: number[]) => times.slice(1).map((time, i) => time - times[i]!);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

describe("the catalogue", () => {
  it("has a group, a rate and an explanation for every rhythm", () => {
    for (const definition of RHYTHMS) {
      expect(RHYTHM_GROUPS).toContain(definition.group);
      expect(definition.rate.length).toBeGreaterThan(0);
      expect(definition.what.length).toBeGreaterThan(20);
    }
  });

  it("falls back to the normal rhythm for an id it does not know", () => {
    expect(rhythm("nonsense" as RhythmId).id).toBe("normal");
  });
});

describe("the normal rhythm", () => {
  it("is exactly the beat the animation was built and approved on", () => {
    // The whole point of keeping it: choosing a rhythm must not change what
    // the heart already does when nothing is chosen.
    const player = new RhythmPlayer(rhythm("normal"));
    let t = 0;
    for (let frame = 0; frame < 180; frame++) {
      const next = t + 1 / 60;
      const result = player.advance(t, next);
      const expected = beatAt(next);
      expect(result.atria).toBeCloseTo(expected.atria, 9);
      expect(result.ventricles).toBeCloseTo(expected.ventricles, 9);
      t = next;
    }
  });

  it("plays both sounds once a beat", () => {
    const { lub, dub } = play("normal", 10);
    expect(lub).toHaveLength(12);
    expect(dub).toHaveLength(12);
  });
});

describe("sinus rates", () => {
  it("runs faster in tachycardia and slower in bradycardia", () => {
    expect(mean(intervals(starts(play("sinus_tachycardia").lub)))).toBeCloseTo(60 / 130, 1);
    expect(mean(intervals(starts(play("sinus_bradycardia").lub)))).toBeCloseTo(60 / 45, 1);
  });

  it("shortens systole far less than diastole as the rate rises", () => {
    const resting = 60 / RESTING_BPM;
    const fast = 60 / 130;
    const systoleShare = (resting - fast) / resting;
    const systoleShortening = (systoleFor(resting) - systoleFor(fast)) / systoleFor(resting);
    expect(systoleShortening).toBeLessThan(systoleShare);
  });
});

/** Atrial contraction starts: the frames where the atria begin to draw in from rest. */
function atrialStarts(frames: { t: number; atria: number }[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    // The heart is at rest before the first frame, so a beat that starts at
    // zero is found there too rather than skipped.
    const previous = i === 0 ? 0 : frames[i - 1]!.atria;
    if (previous === 0 && frames[i]!.atria > 0) out.push(frames[i]!.t);
  }
  return out;
}

/** For each atrial beat, the first ventricular sound before the next atrial beat, if any. */
function conduction(id: RhythmId) {
  const { frames, lub } = play(id);
  const atria = atrialStarts(frames);
  return atria.slice(0, -1).map((at, i) => {
    const sound = lub.find((s) => s.t > at && s.t < atria[i + 1]!);
    return sound ? sound.t - at : null;
  });
}

describe("conduction blocks", () => {
  it("delays every beat past 0.2 s in first-degree block", () => {
    for (const delay of conduction("av_block_1")) {
      expect(delay).not.toBeNull();
      expect(delay!).toBeGreaterThan(0.2);
    }
  });

  it("lengthens the delay until a beat drops, in Mobitz I", () => {
    const delays = conduction("mobitz_1").slice(0, 8);
    // Three conducted beats, each later than the last, then one that is not.
    expect(delays[0]!).toBeLessThan(delays[1]!);
    expect(delays[1]!).toBeLessThan(delays[2]!);
    expect(delays[3]).toBeNull();
    expect(delays[4]!).toBeLessThan(delays[6]!);
    expect(delays[7]).toBeNull();
  });

  it("drops beats without the delay changing, in Mobitz II", () => {
    const delays = conduction("mobitz_2").slice(0, 9);
    const conducted = delays.filter((delay): delay is number => delay !== null);
    expect(delays.filter((delay) => delay === null).length).toBe(3);
    expect(Math.max(...conducted) - Math.min(...conducted)).toBeLessThan(1 / 30);
  });

  it("lets the atria and ventricles keep separate times in complete block", () => {
    const { frames, lub } = play("av_block_3");
    expect(mean(intervals(atrialStarts(frames)))).toBeCloseTo(60 / RESTING_BPM, 1);
    expect(mean(intervals(starts(lub)))).toBeCloseTo(60 / 38, 1);
    // Independent: the delay from atrium to ventricle is not constant.
    const delays = conduction("av_block_3").filter((d): d is number => d !== null);
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(0.2);
  });
});

describe("atrial rhythms", () => {
  it("quivers the atria and beats the ventricles irregularly in fibrillation", () => {
    const { frames, lub } = play("atrial_fibrillation");
    // No organised atrial beat, but never still.
    const quiet = frames.filter((frame) => frame.atria === 0).length;
    expect(quiet).toBe(0);
    expect(Math.max(...frames.map((frame) => frame.atria))).toBeLessThan(SQUEEZE.atria * 0.4);
    // Irregularly irregular.
    const gaps = intervals(starts(lub));
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread).toBeGreaterThan(0.25);
    // A beat after a short interval is quieter.
    expect(Math.min(...lub.map((s) => s.level))).toBeLessThan(Math.max(...lub.map((s) => s.level)));
  });

  it("conducts every second flutter wave", () => {
    const { frames, lub } = play("atrial_flutter");
    expect(mean(intervals(atrialStarts(frames)))).toBeCloseTo(0.2, 1);
    expect(mean(intervals(starts(lub)))).toBeCloseTo(0.4, 1);
  });
});

describe("ventricular rhythms", () => {
  it("adds early beats followed by a compensatory pause", () => {
    const beats = starts(play("premature_ventricular").lub);
    const gaps = intervals(beats);
    const normal = 60 / RESTING_BPM;
    const early = gaps.findIndex((gap) => gap < normal * 0.7);
    expect(early).toBeGreaterThan(-1);
    // The early interval and the pause after it add up to two normal cycles.
    expect(gaps[early]! + gaps[early + 1]!).toBeCloseTo(2 * normal, 1);
  });

  it("beats the ventricles very fast in ventricular tachycardia", () => {
    expect(mean(intervals(starts(play("ventricular_tachycardia").lub)))).toBeCloseTo(60 / 170, 1);
  });

  it("makes no sound and no organised beat in ventricular fibrillation", () => {
    const { frames, lub, dub } = play("ventricular_fibrillation");
    expect(lub).toHaveLength(0);
    expect(dub).toHaveLength(0);
    // Quivering, never still, never a full contraction.
    expect(frames.every((frame) => frame.ventricles > 0)).toBe(true);
    expect(Math.max(...frames.map((frame) => frame.ventricles))).toBeLessThan(SQUEEZE.ventricles * 0.55);
  });

  it("does nothing at all in asystole", () => {
    const { frames, lub, dub } = play("asystole", 5);
    expect(lub).toHaveLength(0);
    expect(dub).toHaveLength(0);
    expect(frames.every((frame) => frame.atria === 0 && frame.ventricles === 0)).toBe(true);
  });
});

describe("replaying a rhythm", () => {
  it("is the same every time it is chosen", () => {
    const first = play("atrial_fibrillation", 5).lub.map((s) => s.t);
    const second = play("atrial_fibrillation", 5).lub.map((s) => s.t);
    expect(second).toEqual(first);
  });
});
