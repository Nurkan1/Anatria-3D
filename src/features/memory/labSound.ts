import type { MemoryKind } from "./memories";
import type { LabPhase } from "./scene/memoryScene";

/**
 * The Memory Lab's sound: tones for what happens, and nothing in between.
 *
 * The opening has its own — a breath as the projection deploys, a chord as the
 * brain materialises, a scale climbing as the memories are mapped — and after
 * that there is only what the reader does: pointing at a memory, opening one,
 * holding to erase, erasing, restoring. Each in the chord of its kind.
 *
 * There was a pad under it all, a slow progression of soft chords for as long
 * as the lab was open. It read as a siren, not a room, and it went: a sound
 * that never stops is one the reader can only endure, whereas a sound that
 * answers them is one they can use.
 *
 * Synthesised like the heart and the scanner, so there is no file to ship or
 * license. It never throws: a machine without an audio device just gets a
 * silent lab.
 */

/** MIDI note to hertz. */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A minor pentatonic, in semitones from A. No note in it can clash with another. */
const PENTATONIC = [0, 3, 5, 7, 10] as const;

/** A note of the pentatonic scale, counted in steps upward from `base`. */
export function scaleNote(step: number, base = 69): number {
  const octave = Math.floor(step / PENTATONIC.length);
  const degree = ((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  return base + octave * 12 + PENTATONIC[degree]!;
}

/** Steps the mapping run climbs over, from the first memory to the last. */
const MAPPING_STEPS = 12;

/** The note for the i-th of `count` memories being mapped: rising with the thread. */
export function mappingNote(i: number, count: number): number {
  const along = count <= 1 ? 0 : i / (count - 1);
  return scaleNote(Math.round(along * MAPPING_STEPS));
}

/** Four voices each, as MIDI notes: open voicings, so a chord of bells never gets muddy. */
export const PROGRESSION: readonly (readonly number[])[] = [
  [45, 52, 60, 71], // A minor 9
  [41, 48, 57, 64], // F major 9
  [48, 55, 64, 71], // C major 9
  [40, 47, 55, 66], // E minor 9
];

/** The chord a memory of each kind opens with. */
export const KIND_CHORD: Record<MemoryKind, readonly number[]> = {
  session: PROGRESSION[2]!,
  case: PROGRESSION[1]!,
  note: PROGRESSION[3]!,
};

/** Overall level with sound on. The compressor after it only catches peaks. */
const MASTER = 0.55;
const SOUND_KEY = "anatria3d.memory.sound.v1";

export function storedLabSound(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function storeLabSound(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // A private window or blocked storage: the choice lasts until the lab closes.
  }
}

export interface LabSound {
  setEnabled(on: boolean): void;
  /** Call under a gesture: a context that started suspended begins here. */
  resume(): void;
  phase(phase: LabPhase): void;
  mapped(i: number, count: number): void;
  hover(kind: MemoryKind): void;
  select(kind: MemoryKind | null): void;
  holdStart(): void;
  holdEnd(): void;
  erase(): void;
  restore(): void;
  /** Fade out and release the audio device. */
  close(): void;
}

const SILENT: LabSound = {
  setEnabled() {},
  resume() {},
  phase() {},
  mapped() {},
  hover() {},
  select() {},
  holdStart() {},
  holdEnd() {},
  erase() {},
  restore() {},
  close() {},
};

type Ctor = typeof AudioContext;

export function createLabSound(enabled: boolean): LabSound {
  let ctx: AudioContext;
  try {
    const Ctx: Ctor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctx) return SILENT;
    ctx = new Ctx();
  } catch {
    return SILENT;
  }
  try {
    return build(ctx, enabled);
  } catch {
    void ctx.close().catch(() => undefined);
    return SILENT;
  }
}

function build(ctx: AudioContext, enabled: boolean): LabSound {
  const master = ctx.createGain();
  master.gain.value = enabled ? MASTER : 0;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.ratio.value = 6;
  master.connect(limiter).connect(ctx.destination);

  // A long, dark room: made from decaying noise rather than loaded.
  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx, 3.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  reverb.connect(wet).connect(master);

  // An echo for the small tones, fed into the room.
  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.31;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.4;
  echo.connect(feedback).connect(echo);
  echo.connect(echoOut);
  echoOut.connect(master);
  echoOut.connect(reverb);

  /** Where every small tone goes: dry, echoed, and into the room. */
  const tones = ctx.createGain();
  tones.connect(master);
  tones.connect(echo);
  tones.connect(reverb);

  // --- small tones -----------------------------------------------------------
  /** A soft bell: a sine with a faint partial just off the octave, dying away. */
  const bell = (midi: number, at: number, level: number, decay = 1.2) => {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    gain.connect(tones);
    for (const [ratio, share] of [[1, 1], [2.01, 0.25], [3.98, 0.06]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz(midi) * ratio;
      const partial = ctx.createGain();
      partial.gain.value = share;
      osc.connect(partial).connect(gain);
      osc.start(at);
      osc.stop(at + decay + 0.05);
    }
  };

  /** Filtered noise sweeping between two cutoffs: a breath, a wash. */
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const wash = (from: number, to: number, seconds: number, level: number) => {
    const at = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 3;
    band.frequency.setValueAtTime(from, at);
    band.frequency.exponentialRampToValueAtTime(to, at + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + seconds * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    source.connect(band).connect(gain);
    gain.connect(master);
    gain.connect(reverb);
    source.start(at);
    source.stop(at + seconds + 0.05);
  };

  let lastBlip = 0;
  let lastHover = 0;
  let charge: { osc: OscillatorNode; gain: GainNode } | null = null;
  let closed = false;

  const guard =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      if (closed) return;
      try {
        fn(...args);
      } catch {
        // Audio is a nicety; a failed tone must never reach the lab.
      }
    };

  return {
    setEnabled: guard((on: boolean) => {
      master.gain.setTargetAtTime(on ? MASTER : 0, ctx.currentTime, 0.15);
      if (on) void ctx.resume();
    }),
    resume: guard(() => {
      if (ctx.state === "suspended") void ctx.resume();
    }),
    phase: guard((phase: LabPhase) => {
      const now = ctx.currentTime;
      if (phase === "boot") {
        // Powering up: one low note, felt more than heard.
        bell(45, now, 0.03, 2.2);
      } else if (phase === "deploy") {
        wash(180, 2600, 2.4, 0.05);
      } else if (phase === "materialize") {
        PROGRESSION[0]!.forEach((midi, i) => bell(midi + 24, now + i * 0.09, 0.035, 2.4));
      }
    }),
    mapped: guard((i: number, count: number) => {
      const now = ctx.currentTime;
      // A run of hundreds would be a buzz; a few a second reads as a melody.
      if (now - lastBlip < 0.085) return;
      lastBlip = now;
      bell(mappingNote(i, count), now, 0.03, 0.5);
    }),
    hover: guard((kind: MemoryKind) => {
      const now = ctx.currentTime;
      if (now - lastHover < 0.09) return;
      lastHover = now;
      const top = KIND_CHORD[kind][3]!;
      bell(top + 12, now, 0.012, 0.25);
    }),
    select: guard((kind: MemoryKind | null) => {
      if (!kind) return;
      const now = ctx.currentTime;
      KIND_CHORD[kind].slice(1).forEach((midi, i) => bell(midi + 12, now + i * 0.07, 0.03, 1.6));
    }),
    holdStart: guard(() => {
      if (charge) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(hz(57), now);
      osc.frequency.exponentialRampToValueAtTime(hz(81), now + 1.4);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.02, now + 1.2);
      osc.connect(gain).connect(tones);
      osc.start(now);
      charge = { osc, gain };
    }),
    holdEnd: guard(() => {
      if (!charge) return;
      const now = ctx.currentTime;
      charge.gain.gain.cancelScheduledValues(now);
      charge.gain.gain.setTargetAtTime(0.0001, now, 0.04);
      charge.osc.stop(now + 0.3);
      charge = null;
    }),
    erase: guard(() => {
      const now = ctx.currentTime;
      wash(2400, 160, 1.5, 0.06);
      [33, 40].forEach((midi) => bell(midi + 12, now, 0.04, 2.6));
    }),
    restore: guard(() => {
      const now = ctx.currentTime;
      [0, 2, 4, 5].forEach((s, i) => bell(scaleNote(s), now + i * 0.08, 0.03, 1.2));
      wash(300, 2200, 0.9, 0.025);
    }),
    close: guard(() => {
      closed = true;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.12);
      window.setTimeout(() => void ctx.close().catch(() => undefined), 700);
    }),
  };
}

/** A stereo impulse of decaying noise: a room with no walls anyone can see. */
function roomImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}
