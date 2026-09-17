import type { HeartRhythmId } from "@/lib/schemas";

import { CYCLE, RESTING_BPM, SQUEEZE } from "./heartbeat";

/**
 * Heart rhythms, as textbook patterns the animation can show and play.
 *
 * # Why rhythms and not diseases
 *
 * What this animation can show honestly is timing: when the atria contract,
 * when the ventricles do, how strongly, and when each heart sound falls. That
 * is exactly what a disorder of rhythm or conduction *is* — the relationship
 * between the atria and the ventricles — so a first-degree block, a Wenckebach
 * sequence or atrial fibrillation can be seen here in a way no still picture
 * shows.
 *
 * Valve disease and a stiff or failing ventricle are about sound more than
 * timing, and they are here as sound: each is a normal sinus beat with the
 * murmur or the extra heart sound the textbook describes, in its place in the
 * cycle — which is what a stethoscope teaches, and what a picture cannot.
 *
 * # What these are not
 *
 * Nobody's heart. Each is a pattern as a textbook describes it, with one
 * representative rate; real rhythms vary from person to person and minute to
 * minute, and are read from an ECG, not from an animation. The panel says so.
 *
 * # How a rhythm is described
 *
 * As a planner that lays down contractions and heart sounds at absolute times,
 * a couple of seconds ahead of the clock, keeping its own clocks between calls.
 * That one shape covers the regular rhythms, the ones that drop beats, and the
 * ones where the atria and ventricles each keep their own time. A rhythm that
 * has no organised contraction at all — fibrillation — quivers instead: a small
 * continuous movement with no events and, in the ventricles, no sounds.
 *
 * # The ECG comes from the same schedule
 *
 * `ecgAt` draws a lead-II-like trace from the very contractions the animation
 * plays: a P wave before each atrial contraction, a QRS before each ventricular
 * one and a T wave inside it. So the PR interval on the trace is the pause the
 * reader watches, a dropped beat is a P with nothing after it, and the trace
 * cannot disagree with the heart. It is a schematic trace for learning the
 * patterns, not a recording, and the panel says so.
 */

/** One of the catalogue's rhythms. The names are the protocol's, so the assistant can ask for one. */
export type RhythmId = HeartRhythmId;

export const RHYTHM_GROUPS = [
  "Sinus",
  "Conduction blocks",
  "Atrial",
  "Ventricular",
  "Murmurs and extra sounds",
] as const;
export type RhythmGroup = (typeof RHYTHM_GROUPS)[number];

/** One contraction: when it starts, peaks and ends, and how strong it is. */
export interface Contraction {
  at: number;
  peak: number;
  end: number;
  /** 1 is a normal beat; less is a weaker one. */
  strength: number;
  /**
   * A ventricular beat that starts in the ventricles rather than coming down
   * the conduction system: slow to spread, so its QRS is wide and its T wave
   * points the other way.
   */
  wide?: boolean;
}

/**
 * What the trace shows between and instead of organised beats.
 *
 * - `p`: a P wave with each atrial contraction.
 * - `flutter`: sawtooth F waves, one with each fast atrial contraction.
 * - `fibrillation`: no P waves, a fine irregular baseline.
 */
export type AtrialTrace = "p" | "flutter" | "fibrillation";

/** One heart sound, and how loud relative to normal. */
export interface HeartSound {
  at: number;
  level: number;
}

/**
 * How a murmur's loudness moves over its length.
 *
 * - `diamond`: rises to the middle and falls — crescendo-decrescendo.
 * - `plateau`: the same loudness throughout — holosystolic.
 * - `decrescendo`: loudest at its start and fading.
 * - `rumble`: low, and louder again at its end, as the atria contract.
 */
export type MurmurShape = "diamond" | "plateau" | "decrescendo" | "rumble";

/** A murmur: turbulent flow heard as filtered noise over part of the cycle. */
export interface Murmur {
  at: number;
  length: number;
  shape: MurmurShape;
  /** Where its pitch sits, in hertz, and how narrow the band is. */
  pitch: number;
  q: number;
  /** Peak loudness relative to a normal first heart sound. */
  level: number;
}

/**
 * A short sound that is not S1 or S2.
 *
 * - `s3`: a low thud in early diastole, as blood rushes into a ventricle.
 * - `s4`: a low thud just before S1, as the atria push into a stiff ventricle.
 * - `snap`: the opening snap of a stiff mitral valve, short and high.
 */
export type ExtraSoundKind = "s3" | "s4" | "snap";

export interface ExtraSound {
  at: number;
  kind: ExtraSoundKind;
}

/** What a planner lays down. */
export interface Planned {
  atria: Contraction[];
  ventricles: Contraction[];
  lub: HeartSound[];
  dub: HeartSound[];
  murmurs: Murmur[];
  extras: ExtraSound[];
}

/**
 * Lays down everything that starts before `to`, using `clocks` to remember
 * where it had got to — each rhythm keeps whatever clocks it needs there.
 */
type Planner = (to: number, clocks: Record<string, number>, random: () => number, out: Planned) => void;

export interface RhythmDefinition {
  id: RhythmId;
  label: string;
  group: RhythmGroup;
  /** The representative rate, as the panel shows it. */
  rate: string;
  /** What the reader is seeing and hearing, in a sentence or two. */
  what: string;
  /** Continuous quiver, as a fraction of a full contraction. Zero for organised rhythms. */
  quiver: { atria: number; ventricles: number };
  /** How the atria show on the ECG. `p` unless said otherwise. */
  atrialTrace?: AtrialTrace;
  plan: Planner;
}

// The normal beat's shape, taken from the cycle the animation was built on, so
// the normal rhythm here is that cycle and not an approximation of it.
const ATRIAL_LENGTH = CYCLE.atria.end - CYCLE.atria.start;
const ATRIAL_PEAK = CYCLE.atria.peak - CYCLE.atria.start;
const NORMAL_PR = CYCLE.ventricles.start - CYCLE.atria.start;
const NORMAL_SYSTOLE = CYCLE.ventricles.end - CYCLE.ventricles.start;
const SYSTOLE_PEAK = (CYCLE.ventricles.peak - CYCLE.ventricles.start) / NORMAL_SYSTOLE;
const S2_WITHIN_SYSTOLE = (CYCLE.s2 - CYCLE.ventricles.start) / NORMAL_SYSTOLE;
const NORMAL_RR = 60 / RESTING_BPM;

/**
 * How long ventricular contraction lasts at a given interval between beats.
 *
 * Systole shortens as the rate rises, but far less than diastole does — the
 * square-root relation the QT interval follows. At the resting interval it is
 * exactly the normal cycle's.
 */
export function systoleFor(interval: number): number {
  return Math.min(0.36, Math.max(0.16, NORMAL_SYSTOLE * Math.sqrt(interval / NORMAL_RR)));
}

function atrium(out: Planned, at: number, strength = 1): void {
  out.atria.push({ at, peak: at + ATRIAL_PEAK, end: at + ATRIAL_LENGTH, strength });
}

function ventricle(
  out: Planned,
  at: number,
  interval: number,
  strength = 1,
  firstSound = 1,
  secondSound = 1,
  wide = false,
): void {
  const length = systoleFor(interval);
  out.ventricles.push({ at, peak: at + length * SYSTOLE_PEAK, end: at + length, strength, wide });
  if (firstSound > 0) out.lub.push({ at, level: firstSound });
  if (secondSound > 0) out.dub.push({ at: at + length * S2_WITHIN_SYSTOLE, level: secondSound });
}

/** A regular sinus rhythm: every atrial beat followed by a ventricular one. */
function sinus(bpm: number, pr: number): Planner {
  const interval = 60 / bpm;
  return (to, clocks, _random, out) => {
    clocks.atria ??= 0;
    while (clocks.atria < to) {
      atrium(out, clocks.atria);
      ventricle(out, clocks.atria + pr, interval);
      clocks.atria += interval;
    }
  };
}

const NO_QUIVER = { atria: 0, ventricles: 0 };

/** Where one normal beat's events fall, for adding a sound to it. */
interface Beat {
  /** Atrial contraction. */
  atrium: number;
  /** Ventricular contraction, and the first heart sound. */
  s1: number;
  /** The second heart sound. */
  s2: number;
  /** The next beat's first heart sound. */
  nextS1: number;
}

/**
 * A normal sinus rhythm at rest with something heard on every beat.
 *
 * `sounds` sets the loudness of S1 and S2 and the ventricle's strength — a
 * stenosed aortic valve softens S2 and the pulse — and `add` lays down the
 * murmur or extra sound in its place in that beat.
 */
function sinusWith(
  sounds: { s1?: number; s2?: number; strength?: number },
  add: (beat: Beat, out: Planned) => void,
): Planner {
  const length = systoleFor(NORMAL_RR);
  return (to, clocks, _random, out) => {
    clocks.atria ??= 0;
    while (clocks.atria < to) {
      const s1 = clocks.atria + NORMAL_PR;
      atrium(out, clocks.atria);
      ventricle(out, s1, NORMAL_RR, sounds.strength ?? 1, sounds.s1 ?? 1, sounds.s2 ?? 1);
      add(
        { atrium: clocks.atria, s1, s2: s1 + length * S2_WITHIN_SYSTOLE, nextS1: s1 + NORMAL_RR },
        out,
      );
      clocks.atria += NORMAL_RR;
    }
  };
}

export const RHYTHMS: readonly RhythmDefinition[] = [
  {
    id: "normal",
    label: "Normal sinus rhythm",
    group: "Sinus",
    rate: `${RESTING_BPM} bpm`,
    what:
      "Each beat starts in the atria; after a short pause at the AV node the ventricles " +
      "contract. The first sound is the AV valves closing, the second the aortic and " +
      "pulmonary valves.",
    quiver: NO_QUIVER,
    plan: sinus(RESTING_BPM, NORMAL_PR),
  },
  {
    id: "sinus_tachycardia",
    label: "Sinus tachycardia",
    group: "Sinus",
    rate: "130 bpm",
    what:
      "The same sequence, faster. Diastole shortens far more than systole, so the " +
      "ventricles have less time to fill between beats.",
    quiver: NO_QUIVER,
    plan: sinus(130, 0.12),
  },
  {
    id: "sinus_bradycardia",
    label: "Sinus bradycardia",
    group: "Sinus",
    rate: "45 bpm",
    what: "The same sequence, slower, with long pauses in diastole.",
    quiver: NO_QUIVER,
    plan: sinus(45, 0.16),
  },
  {
    id: "av_block_1",
    label: "First-degree AV block",
    group: "Conduction blocks",
    rate: `${RESTING_BPM} bpm`,
    what:
      "Every atrial beat reaches the ventricles, but late: the pause between the atria " +
      "and the ventricles is longer than 0.2 seconds.",
    quiver: NO_QUIVER,
    plan: sinus(RESTING_BPM, 0.32),
  },
  {
    id: "mobitz_1",
    label: "Second-degree AV block, Mobitz I",
    group: "Conduction blocks",
    rate: "Atria 72, ventricles 54 bpm",
    what:
      "Wenckebach: the pause after each atrial beat grows longer, until one atrial beat " +
      "is not followed by the ventricles at all. Then the sequence starts again.",
    quiver: NO_QUIVER,
    plan: (to, clocks, _random, out) => {
      const delays = [0.16, 0.24, 0.3];
      clocks.atria ??= 0;
      clocks.beat ??= 0;
      while (clocks.atria < to) {
        atrium(out, clocks.atria);
        const delay = delays[clocks.beat % 4];
        if (delay !== undefined) ventricle(out, clocks.atria + delay, NORMAL_RR);
        clocks.atria += NORMAL_RR;
        clocks.beat += 1;
      }
    },
  },
  {
    id: "mobitz_2",
    label: "Second-degree AV block, Mobitz II",
    group: "Conduction blocks",
    rate: "Atria 72, ventricles 48 bpm",
    what:
      "The pause stays the same, but some atrial beats are not conducted: the atria " +
      "contract and the ventricles do not, without warning.",
    quiver: NO_QUIVER,
    plan: (to, clocks, _random, out) => {
      clocks.atria ??= 0;
      clocks.beat ??= 0;
      while (clocks.atria < to) {
        atrium(out, clocks.atria);
        if (clocks.beat % 3 !== 2) ventricle(out, clocks.atria + 0.16, NORMAL_RR);
        clocks.atria += NORMAL_RR;
        clocks.beat += 1;
      }
    },
  },
  {
    id: "av_block_3",
    label: "Third-degree (complete) AV block",
    group: "Conduction blocks",
    rate: "Atria 72, ventricles 38 bpm",
    what:
      "Nothing is conducted. The atria keep their own rhythm and the ventricles beat " +
      "slowly on theirs, independently — so the first sound changes in loudness.",
    quiver: NO_QUIVER,
    plan: (to, clocks, random, out) => {
      const ventricular = 60 / 38;
      clocks.atria ??= 0;
      clocks.ventricles ??= 0.35;
      while (clocks.atria < to) {
        atrium(out, clocks.atria);
        clocks.atria += NORMAL_RR;
      }
      while (clocks.ventricles < to) {
        // An escape rhythm from the ventricles themselves: wide.
        ventricle(out, clocks.ventricles, ventricular, 1, 0.5 + 0.5 * random(), 1, true);
        clocks.ventricles += ventricular;
      }
    },
  },
  {
    id: "atrial_fibrillation",
    label: "Atrial fibrillation",
    group: "Atrial",
    rate: "About 100 bpm, irregular",
    what:
      "The atria quiver instead of contracting, and the ventricles beat at irregular " +
      "intervals — irregularly irregular. A beat after a short interval has had less time " +
      "to fill, and is weaker and quieter.",
    quiver: { atria: 0.35, ventricles: 0 },
    atrialTrace: "fibrillation",
    plan: (to, clocks, random, out) => {
      clocks.ventricles ??= 0.2;
      clocks.filled ??= 0.7;
      while (clocks.ventricles < to) {
        // How full the ventricles are depends on how long they had since the last beat.
        const strength = 0.55 + 0.45 * Math.min(1, Math.max(0, (clocks.filled - 0.4) / 0.55));
        const interval = 0.4 + 0.55 * random();
        ventricle(out, clocks.ventricles, interval, strength, strength, strength);
        clocks.ventricles += interval;
        clocks.filled = interval;
      }
    },
  },
  {
    id: "atrial_flutter",
    label: "Atrial flutter, 2:1",
    group: "Atrial",
    rate: "Atria 300, ventricles 150 bpm",
    what:
      "The atria contract very fast and regularly, about 300 times a minute. The AV node " +
      "lets every second one through, so the ventricles beat about 150.",
    quiver: NO_QUIVER,
    atrialTrace: "flutter",
    plan: (to, clocks, _random, out) => {
      const atrial = 0.2;
      clocks.atria ??= 0;
      clocks.beat ??= 0;
      while (clocks.atria < to) {
        atrium(out, clocks.atria, 0.45);
        if (clocks.beat % 2 === 0) ventricle(out, clocks.atria + 0.16, atrial * 2, 0.85, 0.85, 0.85);
        clocks.atria += atrial;
        clocks.beat += 1;
      }
    },
  },
  {
    id: "premature_ventricular",
    label: "Premature ventricular beats",
    group: "Ventricular",
    rate: `${RESTING_BPM} bpm, with early beats`,
    what:
      "Now and then the ventricles contract early, with no atrial beat before them. The " +
      "next atrial beat finds them still recovering and is not conducted, so a pause " +
      "follows before the rhythm goes on.",
    quiver: NO_QUIVER,
    plan: (to, clocks, _random, out) => {
      clocks.atria ??= 0;
      clocks.beat ??= 0;
      while (clocks.atria < to) {
        atrium(out, clocks.atria);
        if (clocks.beat % 5 === 3) {
          // Early, from the ventricles themselves, before this cycle's atrial beat.
          // Everything after the previous normal beat adds up to two full cycles:
          // the compensatory pause.
          const previous = clocks.atria - NORMAL_RR + NORMAL_PR;
          ventricle(out, previous + 0.46, NORMAL_RR * 0.6, 0.8, 0.9, 0.7, true);
        } else {
          ventricle(out, clocks.atria + NORMAL_PR, NORMAL_RR);
        }
        clocks.atria += NORMAL_RR;
        clocks.beat += 1;
      }
    },
  },
  {
    id: "ventricular_tachycardia",
    label: "Ventricular tachycardia",
    group: "Ventricular",
    rate: "About 170 bpm",
    what:
      "The ventricles beat very fast on their own, with the atria keeping a separate, " +
      "slower rhythm. With so little time to fill, each beat pumps less.",
    quiver: NO_QUIVER,
    plan: (to, clocks, random, out) => {
      const ventricular = 60 / 170;
      clocks.atria ??= 0.1;
      clocks.ventricles ??= 0;
      while (clocks.atria < to) {
        atrium(out, clocks.atria);
        clocks.atria += NORMAL_RR;
      }
      while (clocks.ventricles < to) {
        ventricle(out, clocks.ventricles, ventricular, 0.65, 0.5 + 0.4 * random(), 0.6, true);
        clocks.ventricles += ventricular;
      }
    },
  },
  {
    id: "ventricular_fibrillation",
    label: "Ventricular fibrillation",
    group: "Ventricular",
    rate: "No organised beat",
    what:
      "No coordinated contraction: the ventricles quiver and pump nothing, so there are " +
      "no heart sounds and no pulse. This is cardiac arrest.",
    quiver: { atria: 0.25, ventricles: 0.5 },
    atrialTrace: "fibrillation",
    plan: () => {},
  },
  {
    id: "asystole",
    label: "Asystole",
    group: "Ventricular",
    rate: "No beat",
    what:
      "No electrical activity, so nothing contracts and nothing is heard: the flat line " +
      "on an ECG. The heart standing still is the rhythm, not the animation stopping.",
    quiver: NO_QUIVER,
    plan: () => {},
  },
  {
    id: "aortic_stenosis",
    label: "Aortic stenosis",
    group: "Murmurs and extra sounds",
    rate: `${RESTING_BPM} bpm`,
    what:
      "A narrowed aortic valve: blood forced through it in systole makes a harsh murmur " +
      "that swells and fades between S1 and S2. The second sound is softer, and the pulse " +
      "weaker.",
    quiver: NO_QUIVER,
    plan: sinusWith({ s2: 0.55, strength: 0.8 }, (beat, out) => {
      const at = beat.s1 + 0.04;
      out.murmurs.push({ at, length: beat.s2 - 0.03 - at, shape: "diamond", pitch: 220, q: 0.9, level: 0.6 });
    }),
  },
  {
    id: "mitral_regurgitation",
    label: "Mitral regurgitation",
    group: "Murmurs and extra sounds",
    rate: `${RESTING_BPM} bpm`,
    what:
      "A mitral valve that does not close: some blood leaks back into the left atrium for " +
      "all of systole, heard as an even, blowing murmur from S1 right up to S2. S1 is soft.",
    quiver: NO_QUIVER,
    plan: sinusWith({ s1: 0.55, strength: 0.85 }, (beat, out) => {
      out.murmurs.push({
        at: beat.s1 + 0.01,
        length: beat.s2 - beat.s1,
        shape: "plateau",
        pitch: 380,
        q: 1.2,
        level: 0.45,
      });
    }),
  },
  {
    id: "aortic_regurgitation",
    label: "Aortic regurgitation",
    group: "Murmurs and extra sounds",
    rate: `${RESTING_BPM} bpm`,
    what:
      "An aortic valve that does not close: blood falls back into the left ventricle in " +
      "diastole, heard as a high, blowing murmur that starts at S2 and fades.",
    quiver: NO_QUIVER,
    plan: sinusWith({}, (beat, out) => {
      out.murmurs.push({ at: beat.s2 + 0.01, length: 0.34, shape: "decrescendo", pitch: 520, q: 1.5, level: 0.4 });
    }),
  },
  {
    id: "mitral_stenosis",
    label: "Mitral stenosis",
    group: "Murmurs and extra sounds",
    rate: `${RESTING_BPM} bpm`,
    what:
      "A narrowed mitral valve: a loud S1, a short opening snap after S2 as the stiff valve " +
      "opens, then a low rumble through diastole that grows as the atria contract.",
    quiver: NO_QUIVER,
    plan: sinusWith({ s1: 1 }, (beat, out) => {
      out.extras.push({ at: beat.s2 + 0.08, kind: "snap" });
      const at = beat.s2 + 0.13;
      out.murmurs.push({ at, length: beat.nextS1 - 0.02 - at, shape: "rumble", pitch: 110, q: 1, level: 0.65 });
    }),
  },
  {
    id: "third_heart_sound",
    label: "Third heart sound (S3)",
    group: "Murmurs and extra sounds",
    rate: `${RESTING_BPM} bpm`,
    what:
      "A low thud just after S2, as blood rushes into a ventricle that is overfilled: " +
      "lub-dub-ta, like the word Kentucky. Normal in children and athletes, a sign of " +
      "heart failure in older adults.",
    quiver: NO_QUIVER,
    plan: sinusWith({}, (beat, out) => {
      out.extras.push({ at: beat.s2 + 0.15, kind: "s3" });
    }),
  },
  {
    id: "fourth_heart_sound",
    label: "Fourth heart sound (S4)",
    group: "Murmurs and extra sounds",
    rate: `${RESTING_BPM} bpm`,
    what:
      "A low thud just before S1, as the atria push blood into a stiff ventricle: " +
      "ta-lub-dub, like the word Tennessee.",
    quiver: NO_QUIVER,
    plan: sinusWith({}, (beat, out) => {
      out.extras.push({ at: beat.s1 - 0.07, kind: "s4" });
    }),
  },
];

export function rhythm(id: RhythmId): RhythmDefinition {
  return RHYTHMS.find((candidate) => candidate.id === id) ?? RHYTHMS[0]!;
}

/** A small, seeded random source, so a rhythm can be tested and replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth bump of height `a` centred on `c`, `w` seconds wide. */
function wave(t: number, c: number, w: number, a: number): number {
  const x = (t - c) / w;
  return x * x > 16 ? 0 : a * Math.exp(-x * x);
}

/** How far back contractions are kept, so the trace can still draw their T waves. */
const TRACE_MEMORY_S = 0.8;

function bump(t: number, contraction: Contraction): number {
  if (t <= contraction.at || t >= contraction.end) return 0;
  const rise = contraction.peak - contraction.at;
  const fall = contraction.end - contraction.peak;
  const x = t < contraction.peak ? (t - contraction.at) / rise : 1 - (t - contraction.peak) / fall;
  const clamped = Math.min(1, Math.max(0, x));
  return contraction.strength * clamped * clamped * (3 - 2 * clamped);
}

/** What one frame of a rhythm comes to. */
export interface RhythmFrame {
  /** How far the atria and ventricles are drawn in, as the shader reads it. */
  atria: number;
  ventricles: number;
  /** The heart sounds that fell in this frame, each by its loudness. */
  lub: number[];
  dub: number[];
  /** Murmurs and extra sounds that start in this frame. */
  murmurs: Murmur[];
  extras: ExtraSoundKind[];
}

/** How far ahead of the clock contractions are laid down, in seconds. */
const LOOKAHEAD_S = 2;

/**
 * Plays a rhythm: call `advance` with the interval each frame covers.
 *
 * Deterministic for a seed, so a test can hold a rhythm to its pattern, and the
 * same rhythm looks the same each time it is chosen.
 */
export class RhythmPlayer {
  private readonly planned: Planned = { atria: [], ventricles: [], lub: [], dub: [], murmurs: [], extras: [] };
  private readonly clocks: Record<string, number> = {};
  private readonly random: () => number;
  private readonly phases: number[];
  private horizon = 0;

  constructor(
    readonly definition: RhythmDefinition,
    seed = 20260917,
  ) {
    this.random = seeded(seed);
    this.phases = [0, 1, 2, 3, 4, 5].map(() => this.random() * Math.PI * 2);
  }

  advance(before: number, after: number): RhythmFrame {
    if (after + LOOKAHEAD_S > this.horizon) {
      this.horizon = after + LOOKAHEAD_S;
      this.definition.plan(this.horizon, this.clocks, this.random, this.planned);
      // What has finished is no longer needed.
      const keep = before - TRACE_MEMORY_S;
      this.planned.atria = this.planned.atria.filter((c) => c.end >= keep);
      this.planned.ventricles = this.planned.ventricles.filter((c) => c.end >= keep);
      this.planned.lub = this.planned.lub.filter((s) => s.at >= keep);
      this.planned.dub = this.planned.dub.filter((s) => s.at >= keep);
      this.planned.murmurs = this.planned.murmurs.filter((m) => m.at >= keep);
      this.planned.extras = this.planned.extras.filter((e) => e.at >= keep);
    }

    let atria = this.quiver(after, this.definition.quiver.atria, 0);
    for (const contraction of this.planned.atria) atria = Math.max(atria, bump(after, contraction));
    let ventricles = this.quiver(after, this.definition.quiver.ventricles, 3);
    for (const contraction of this.planned.ventricles) {
      ventricles = Math.max(ventricles, bump(after, contraction));
    }

    const within = (sound: { at: number }) => sound.at > before && sound.at <= after;
    return {
      atria: SQUEEZE.atria * atria,
      ventricles: SQUEEZE.ventricles * ventricles,
      lub: this.planned.lub.filter(within).map((sound) => sound.level),
      dub: this.planned.dub.filter(within).map((sound) => sound.level),
      murmurs: this.planned.murmurs.filter(within),
      extras: this.planned.extras.filter(within).map((extra) => extra.kind),
    };
  }

  /**
   * The ECG at time `t`, in units where a normal R wave is 1.
   *
   * Read for a time the player has already reached: the schedule behind it is
   * only kept for `TRACE_MEMORY_S`.
   */
  ecgAt(t: number): number {
    let v = 0;
    const trace = this.definition.atrialTrace ?? "p";
    for (const a of this.planned.atria) {
      if (t < a.at - 0.2 || t > a.end + 0.2) continue;
      if (trace === "p") v += wave(t, a.at - 0.03, 0.03, 0.14);
      else if (trace === "flutter") v += wave(t, a.at + 0.03, 0.05, -0.18) + wave(t, a.at + 0.13, 0.025, 0.07);
    }
    if (trace === "fibrillation") {
      v +=
        0.035 * Math.sin(2 * Math.PI * 6.1 * t + this.phases[0]!) +
        0.02 * Math.sin(2 * Math.PI * 8.7 * t + this.phases[1]!) +
        0.015 * Math.sin(2 * Math.PI * 4.3 * t + this.phases[2]!);
    }
    for (const c of this.planned.ventricles) {
      if (t < c.at - 0.2 || t > c.end + 0.3) continue;
      const length = c.end - c.at;
      // Electrical activity leads the contraction it causes.
      const q = c.at - 0.04;
      if (c.wide) {
        v += wave(t, q + 0.01, 0.03, 0.85) + wave(t, q + 0.07, 0.03, -0.45);
        v += wave(t, c.at + 0.62 * length, 0.06, -0.35);
      } else {
        v += wave(t, q - 0.025, 0.008, -0.12) + wave(t, q, 0.011, 1) + wave(t, q + 0.022, 0.01, -0.28);
        v += wave(t, c.at + 0.62 * length, 0.045, 0.28);
      }
    }
    if (this.definition.quiver.ventricles > 0) {
      // Fibrillating ventricles: large, chaotic, no complexes at all.
      const swell = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.4 * t + this.phases[5]!);
      v +=
        0.45 * swell * Math.sin(2 * Math.PI * 5.1 * t + this.phases[3]!) +
        0.18 * Math.sin(2 * Math.PI * 7.3 * t + this.phases[4]!);
    }
    return v;
  }

  /** A small, fast, irregular movement: three waves that never line up. */
  private quiver(t: number, amount: number, offset: number): number {
    if (amount <= 0) return 0;
    const wave =
      0.5 * Math.sin(2 * Math.PI * 5.3 * t + this.phases[offset]!) +
      0.3 * Math.sin(2 * Math.PI * 7.9 * t + this.phases[offset + 1]!) +
      0.2 * Math.sin(2 * Math.PI * 11.7 * t + this.phases[offset + 2]!);
    return amount * 0.5 * (1 + wave);
  }
}

