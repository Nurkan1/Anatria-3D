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

/** Play a rhythm and sample its ECG every 4 ms, as the strip would. */
function trace(id: RhythmId, seconds = 10) {
  const player = new RhythmPlayer(rhythm(id));
  const samples: { t: number; v: number }[] = [];
  let t = 0;
  for (let step = 0; step < seconds * 250; step++) {
    const next = t + 0.004;
    player.advance(t, next);
    samples.push({ t: next, v: player.ecgAt(next) });
    t = next;
  }
  return samples;
}

/** The times of R peaks: local maxima above `threshold`. */
function rPeaks(samples: { t: number; v: number }[], threshold = 0.7): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const { v } = samples[i]!;
    if (v > threshold && v >= samples[i - 1]!.v && v > samples[i + 1]!.v) peaks.push(samples[i]!.t);
  }
  return peaks;
}

/** How long the trace stays above half of the peak around `at`, in seconds. */
function widthAround(samples: { t: number; v: number }[], at: number): number {
  const peak = samples.find((s) => s.t === at)!.v;
  return samples.filter((s) => Math.abs(s.t - at) < 0.1 && s.v > peak / 2).length * 0.004;
}

describe("the ECG", () => {
  it("draws one QRS for every ventricular beat of a normal rhythm", () => {
    expect(rPeaks(trace("normal"))).toHaveLength(12);
  });

  it("is flat in asystole", () => {
    expect(Math.max(...trace("asystole", 3).map((s) => Math.abs(s.v)))).toBeLessThan(0.01);
  });

  it("shows the long PR interval of first-degree block", () => {
    const samples = trace("av_block_1", 3);
    const r = rPeaks(samples)[0]!;
    // The P wave's peak: the highest point in the half second before the QRS, away from it.
    const p = samples
      .filter((s) => s.t > r - 0.5 && s.t < r - 0.1)
      .reduce((best, s) => (s.v > best.v ? s : best));
    expect(r - p.t).toBeGreaterThan(0.25);
  });

  it("widens the QRS of beats that start in the ventricles", () => {
    const normal = trace("normal", 3);
    const vt = trace("ventricular_tachycardia", 3);
    expect(widthAround(vt, rPeaks(vt)[1]!)).toBeGreaterThan(2 * widthAround(normal, rPeaks(normal)[1]!));
  });

  it("has no complexes in ventricular fibrillation, and never goes flat", () => {
    const samples = trace("ventricular_fibrillation", 5);
    expect(rPeaks(samples)).toHaveLength(0);
    const window = samples.slice(0, 125).map((s) => s.v);
    expect(Math.max(...window) - Math.min(...window)).toBeGreaterThan(0.3);
  });

  it("puts R waves at irregular intervals in atrial fibrillation", () => {
    const gaps = intervals(rPeaks(trace("atrial_fibrillation")));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.25);
  });
});

/** Play a rhythm and collect when each sound, murmur and extra sound started. */
function heard(id: RhythmId, seconds = 4) {
  const player = new RhythmPlayer(rhythm(id));
  const events = { lub: [] as number[], dub: [] as number[], murmurs: [] as { t: number; end: number; shape: string }[], extras: [] as { t: number; kind: string }[] };
  let t = 0;
  for (let frame = 0; frame < seconds * 240; frame++) {
    const next = t + 1 / 240;
    const frameEvents = player.advance(t, next);
    if (frameEvents.lub.length) events.lub.push(next);
    if (frameEvents.dub.length) events.dub.push(next);
    for (const m of frameEvents.murmurs) events.murmurs.push({ t: m.at, end: m.at + m.length, shape: m.shape });
    for (const kind of frameEvents.extras) events.extras.push({ t: next, kind });
    t = next;
  }
  return events;
}

/** The last event at or before `t`. */
const lastBefore = (times: number[], t: number) => Math.max(...times.filter((x) => x <= t + 1e-6));

describe("murmurs and extra sounds", () => {
  it("puts a diamond-shaped murmur between S1 and S2 in aortic stenosis", () => {
    const { lub, dub, murmurs } = heard("aortic_stenosis");
    expect(murmurs.length).toBeGreaterThan(2);
    for (const m of murmurs.slice(0, 3)) {
      expect(m.shape).toBe("diamond");
      const s1 = lastBefore(lub, m.t);
      const s2 = dub.find((x) => x > s1)!;
      expect(m.t).toBeGreaterThan(s1);
      expect(m.end).toBeLessThan(s2);
    }
  });

  it("fills all of systole in mitral regurgitation", () => {
    const { lub, dub, murmurs } = heard("mitral_regurgitation");
    const m = murmurs[0]!;
    const s1 = lastBefore(lub, m.t);
    const s2 = dub.find((x) => x > s1)!;
    expect(m.shape).toBe("plateau");
    expect(m.t - s1).toBeLessThan(0.03);
    expect(Math.abs(m.end - s2)).toBeLessThan(0.03);
  });

  it("starts at S2 and fades in aortic regurgitation", () => {
    const { lub, dub, murmurs } = heard("aortic_regurgitation");
    const m = murmurs[0]!;
    expect(m.shape).toBe("decrescendo");
    expect(m.t - lastBefore(dub, m.t)).toBeLessThan(0.03);
    expect(m.end).toBeLessThan(lub.find((x) => x > m.t)!);
  });

  it("snaps after S2, then rumbles until the next S1, in mitral stenosis", () => {
    const { lub, dub, murmurs, extras } = heard("mitral_stenosis");
    const snap = extras.find((e) => e.kind === "snap")!;
    expect(snap.t - lastBefore(dub, snap.t)).toBeGreaterThan(0.05);
    const rumble = murmurs.find((m) => m.t > snap.t)!;
    expect(rumble.shape).toBe("rumble");
    const nextS1 = lub.find((x) => x > rumble.t)!;
    expect(nextS1 - rumble.end).toBeLessThan(0.04);
    expect(nextS1 - rumble.end).toBeGreaterThan(0);
  });

  it("adds S3 after S2 and S4 before S1", () => {
    const three = heard("third_heart_sound");
    const s3 = three.extras.find((e) => e.kind === "s3")!;
    expect(s3.t - lastBefore(three.dub, s3.t)).toBeGreaterThan(0.1);

    const four = heard("fourth_heart_sound");
    const s4 = four.extras.find((e) => e.kind === "s4")!;
    const nextS1 = four.lub.find((x) => x > s4.t)!;
    expect(nextS1 - s4.t).toBeGreaterThan(0.04);
    expect(nextS1 - s4.t).toBeLessThan(0.1);
  });
});
