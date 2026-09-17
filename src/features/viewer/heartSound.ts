/**
 * The heart sounds, synthesised rather than shipped — the same decision, for
 * the same reasons, as the scanner's ping: no audio file to license, decode or
 * carry in the installer, and a timbre tuned by editing a number.
 *
 * # What the two sounds are
 *
 * The first sound, *lub*, is the atrioventricular valves closing as the
 * ventricles begin to contract: longer and lower. The second, *dub*, is the
 * aortic and pulmonary valves closing as ejection ends: shorter and a little
 * higher. Each is a thump — a low tone falling in pitch under a fast decay —
 * with a short knock at its start.
 *
 * # Why it is built for a laptop speaker, not for headphones
 *
 * The first version was a pure low thump near fifty hertz behind a filter at
 * 380, and at full volume on a laptop it was almost inaudible: those speakers
 * reproduce next to nothing below about 150 hertz, and the filter was removing
 * the little that could have come through. The ear hears a low sound by its
 * harmonics, so this one carries them on purpose — partials up to about 250
 * hertz and a brief band of noise around 200, the knock that makes a heart
 * sound read as a valve closing rather than as a hum. On headphones the
 * fundamental is still there underneath.
 *
 * # Why a compressor
 *
 * Several partials peaking together at a level loud enough to hear would clip.
 * A compressor at the end holds the peak down, so the sound can be made loud
 * without being distorted.
 *
 * # Priming
 *
 * Audio does not start without a gesture, and the sounds are fired from the
 * render loop. So the context is started on a click — ticking the sound, or
 * switching the heartbeat on with the sound already ticked — and playing is
 * only scheduling after that. See `scanSound` for the same split.
 */

type Ctor = typeof AudioContext;

let context: AudioContext | null = null;
/** The end of the chain every sound goes through, built once with the context. */
let output: AudioNode | null = null;

interface Thump {
  /** Where the fundamental starts and where it falls to, in hertz. */
  from: number;
  to: number;
  /** How long the tone lasts, in seconds. */
  seconds: number;
  /** Peak level of the tone before the compressor. */
  gain: number;
  /** Peak level of the knock at its start. */
  knock: number;
}

export const LUB: Thump = { from: 72, to: 50, seconds: 0.17, gain: 0.9, knock: 0.7 };
export const DUB: Thump = { from: 96, to: 70, seconds: 0.12, gain: 0.8, knock: 0.8 };

/** The tone's partials: waveform, multiple of the fundamental, relative level. */
const PARTIALS: readonly [OscillatorType, number, number][] = [
  ["sine", 1, 1],
  ["triangle", 2, 0.9],
  ["sine", 3, 0.55],
];

/** How long the knock lasts, and where in the spectrum it sits. */
const KNOCK = { seconds: 0.045, centre: 200, q: 1.1 };

/** Safe to call repeatedly, and silent on a machine with no audio device. */
export function primeHeartSound(): void {
  try {
    const Ctx: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctx) return;
    if (!context) {
      context = new Ctx();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.12;
      // Make-up gain after the compressor, so the held-down peak is still loud.
      const makeUp = context.createGain();
      makeUp.gain.value = 1.8;
      compressor.connect(makeUp).connect(context.destination);
      output = compressor;
    }
    if (context.state === "suspended") void context.resume();
  } catch {
    // Audio is a nicety; the heartbeat carries on without it.
  }
}

function thump(sound: Thump): void {
  const ctx = context;
  const out = output;
  if (!ctx || !out || ctx.state !== "running") return;
  try {
    const now = ctx.currentTime;
    const end = now + sound.seconds;

    // Above about a kilohertz a heart sound is only click.
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 1000;
    soften.connect(out);

    const envelope = ctx.createGain();
    // A few milliseconds of attack: a sound starting at full level on its
    // first sample is a click, which is a fault rather than a sound.
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(sound.gain, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(soften);

    for (const [type, multiple, level] of PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(sound.from * multiple, now);
      osc.frequency.exponentialRampToValueAtTime(sound.to * multiple, end);
      const mix = ctx.createGain();
      mix.gain.value = level;
      osc.connect(mix).connect(envelope);
      osc.start(now);
      // Stopped explicitly, or every beat leaves its nodes behind.
      osc.stop(end + 0.02);
    }

    // The knock: a moment of noise, band-limited to where a laptop can play it.
    const samples = Math.ceil(ctx.sampleRate * KNOCK.seconds);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = KNOCK.centre;
    band.Q.value = KNOCK.q;
    const knock = ctx.createGain();
    knock.gain.setValueAtTime(0.0001, now);
    knock.gain.exponentialRampToValueAtTime(sound.knock, now + 0.003);
    knock.gain.exponentialRampToValueAtTime(0.0001, now + KNOCK.seconds);
    noise.connect(band).connect(knock).connect(soften);
    noise.start(now);
    noise.stop(now + KNOCK.seconds + 0.01);
  } catch {
    // A missed beat is not worth an error path.
  }
}

/** The first heart sound. */
export function playLub(): void {
  thump(LUB);
}

/** The second heart sound. */
export function playDub(): void {
  thump(DUB);
}

/** For tests, which must not carry a live audio context between them. */
export function forgetHeartSound(): void {
  context = null;
  output = null;
}
