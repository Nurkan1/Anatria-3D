import type { MemoryKind } from "./memories";
import type { LabPhase } from "./scene/memoryScene";

/**
 * The Memory Lab's sound: a slow pad of soft chords under the room, and small
 * tones for what happens in it — a memory being mapped, pointed at, opened,
 * erased, restored.
 *
 * Synthesised like the heart and the scanner, so there is no file to ship or
 * license. Dynamic rather than looped: the pad walks a four-chord progression
 * on its own, settles on a chord of its own for the kind of memory being read,
 * and the mapping run climbs a scale as the thread is laid.
 *
 * Everything sits low. It plays for as long as the lab is open, and a sound
 * that long has to stay under the room rather than in it. It never throws:
 * a machine without an audio device just gets a silent lab.
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

/** Four voices each, as MIDI notes: open voicings so the pad never gets muddy. */
export const PROGRESSION: readonly (readonly number[])[] = [
  [45, 52, 60, 71], // A minor 9
  [41, 48, 57, 64], // F major 9
  [48, 55, 64, 71], // C major 9
  [40, 47, 55, 66], // E minor 9
];

/** The chord the pad settles on while a memory of each kind is being read. */
export const KIND_CHORD: Record<MemoryKind, readonly number[]> = {
  session: PROGRESSION[2]!,
  case: PROGRESSION[1]!,
  note: PROGRESSION[3]!,
};

/** Seconds on each chord of the progression, and how long the glide between. */
const CHORD_S = 8;
const GLIDE_S = 2.4;
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

  // --- the pad ---------------------------------------------------------------
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 260;
  padFilter.Q.value = 0.6;
  const padGain = ctx.createGain();
  padGain.gain.value = 0;
  padFilter.connect(padGain);
  padGain.connect(master);
  padGain.connect(reverb);
  // A slow breath on the filter, so the chord is never quite still.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 140;
  lfo.connect(lfoDepth).connect(padFilter.frequency);
  lfo.start();

  const voices = PROGRESSION[0]!.map((midi) => {
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    gain.connect(padFilter);
    const pair = [-7, 7].map((cents) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = hz(midi);
      osc.detune.value = cents;
      osc.connect(gain);
      osc.start();
      return osc;
    });
    return { gain, pair };
  });

  const glideTo = (chord: readonly number[]) => {
    const now = ctx.currentTime;
    chord.forEach((midi, v) => {
      for (const osc of voices[v]!.pair) osc.frequency.setTargetAtTime(hz(midi), now, GLIDE_S / 3);
    });
  };
  let step = 0;
  let held: MemoryKind | null = null;
  const walker = window.setInterval(() => {
    if (held) return;
    step = (step + 1) % PROGRESSION.length;
    glideTo(PROGRESSION[step]!);
  }, CHORD_S * 1000);

  /** Open or close the pad's filter towards a cutoff, over some seconds. */
  const openPad = (cutoff: number, seconds: number) => {
    padFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, seconds / 3);
  };

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
        padGain.gain.setTargetAtTime(0.7, now, 1.2);
        openPad(320, 1);
      } else if (phase === "deploy") {
        wash(180, 2600, 2.4, 0.05);
        openPad(560, 2.4);
      } else if (phase === "materialize") {
        PROGRESSION[0]!.forEach((midi, i) => bell(midi + 24, now + i * 0.09, 0.035, 2.4));
        openPad(760, 1.4);
      } else if (phase === "live") {
        openPad(680, 3);
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
      const now = ctx.currentTime;
      held = kind;
      if (kind) {
        const chord = KIND_CHORD[kind];
        glideTo(chord);
        openPad(980, 1.2);
        chord.slice(1).forEach((midi, i) => bell(midi + 12, now + i * 0.07, 0.03, 1.6));
      } else {
        glideTo(PROGRESSION[step]!);
        openPad(680, 1.5);
      }
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
      openPad(360, 0.6);
      window.setTimeout(() => !closed && openPad(held ? 980 : 680, 3), 1600);
    }),
    restore: guard(() => {
      const now = ctx.currentTime;
      [0, 2, 4, 5].forEach((s, i) => bell(scaleNote(s), now + i * 0.08, 0.03, 1.2));
      wash(300, 2200, 0.9, 0.025);
    }),
    close: guard(() => {
      closed = true;
      window.clearInterval(walker);
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
