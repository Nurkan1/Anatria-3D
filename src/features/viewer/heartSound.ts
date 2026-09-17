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
 * higher. Each is a thump — a low tone falling in pitch under a decay — with a
 * soft knock at its start.
 *
 * # Why it is built for a laptop speaker
 *
 * The first version was a pure thump near fifty hertz behind a filter at 380,
 * and at full volume on a laptop it was almost inaudible: those speakers
 * reproduce next to nothing below about a hundred hertz. The ear hears a low
 * sound through its harmonics, so this one carries them — partials an octave
 * and a twelfth above the fundamental, and a lift around 110 hertz where a
 * laptop still has some body. On headphones the fundamental is there beneath.
 *
 * # Why it no longer sounds like tapping plastic
 *
 * The second version was loud enough and sounded like a knuckle on a plastic
 * case. That was brightness: a triangle wave's odd harmonics, a noise knock
 * centred at 200 hertz with a three-millisecond attack, and a filter that let
 * a kilohertz through. A heart sound is dull. So every partial is a sine, the
 * knock sits lower and arrives more slowly, the filter closes at 600 hertz,
 * and the tail is longer — which is what gives a thump its weight.
 *
 * # Why a compressor
 *
 * Several partials peaking together at a level loud enough to hear would clip.
 * A compressor at the end holds the peak down, so the sound can be loud
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
/** The start of the chain every sound goes into, built once with the context. */
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

export const LUB: Thump = { from: 58, to: 40, seconds: 0.22, gain: 0.95, knock: 0.35 };
export const DUB: Thump = { from: 76, to: 54, seconds: 0.15, gain: 0.85, knock: 0.4 };

/** The tone's partials: multiple of the fundamental, and relative level. All sines. */
const PARTIALS: readonly [number, number][] = [
  [1, 1],
  [2, 0.75],
  [3, 0.25],
];

/** The knock: how long it lasts, where in the spectrum it sits, how it is shaped. */
const KNOCK = { seconds: 0.06, centre: 120, q: 0.8, attack: 0.008 };

/** Safe to call repeatedly, and silent on a machine with no audio device. */
export function primeHeartSound(): void {
  try {
    const Ctx: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctx) return;
    if (!context) {
      context = new Ctx();

      // Body where a laptop can still play it, then everything bright removed.
      const body = context.createBiquadFilter();
      body.type = "peaking";
      body.frequency.value = 110;
      body.Q.value = 0.9;
      body.gain.value = 6;
      const dull = context.createBiquadFilter();
      dull.type = "lowpass";
      dull.frequency.value = 600;

      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.15;
      // Make-up gain after the compressor, so the held-down peak is still loud.
      const makeUp = context.createGain();
      makeUp.gain.value = 1.8;

      body.connect(dull).connect(compressor).connect(makeUp).connect(context.destination);
      output = body;
    }
    if (context.state === "suspended") void context.resume();
  } catch {
    // Audio is a nicety; the heartbeat carries on without it.
  }
}

function thump(sound: Thump, level: number): void {
  const ctx = context;
  const out = output;
  // A rhythm can make a sound quieter than normal, never louder; zero is silence.
  const scale = Math.min(1, level);
  if (!ctx || !out || ctx.state !== "running" || !(scale > 0)) return;
  try {
    const now = ctx.currentTime;
    const end = now + sound.seconds;

    const envelope = ctx.createGain();
    // Ten milliseconds of attack: a thump that starts at full level on its first
    // sample is a click, and a click is the plastic.
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(sound.gain * scale, now + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(out);

    for (const [multiple, level] of PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(sound.from * multiple, now);
      osc.frequency.exponentialRampToValueAtTime(sound.to * multiple, end);
      const mix = ctx.createGain();
      mix.gain.value = level;
      osc.connect(mix).connect(envelope);
      osc.start(now);
      // Stopped explicitly, or every beat leaves its nodes behind.
      osc.stop(end + 0.02);
    }

    // The knock: a moment of noise, kept low and soft.
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
    knock.gain.exponentialRampToValueAtTime(sound.knock * scale, now + KNOCK.attack);
    knock.gain.exponentialRampToValueAtTime(0.0001, now + KNOCK.seconds);
    noise.connect(band).connect(knock).connect(out);
    noise.start(now);
    noise.stop(now + KNOCK.seconds + 0.01);
  } catch {
    // A missed beat is not worth an error path.
  }
}

/** The first heart sound, at a loudness relative to normal. */
export function playLub(level = 1): void {
  thump(LUB, level);
}

/** The second heart sound, at a loudness relative to normal. */
export function playDub(level = 1): void {
  thump(DUB, level);
}

/** For tests, which must not carry a live audio context between them. */
export function forgetHeartSound(): void {
  context = null;
  output = null;
}
