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
 * higher. Both are thumps rather than tones — a low sine falling in pitch under
 * a fast decay.
 *
 * # Why a second, quieter partial an octave up
 *
 * The fundamental sits near fifty hertz, which a laptop speaker does not
 * reproduce at all. The octave above it is what makes the beat audible on the
 * machines students actually have; on headphones the fundamental carries it.
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

interface Thump {
  /** Where the pitch starts and where it falls to, in hertz. */
  from: number;
  to: number;
  /** How long it lasts, in seconds. */
  seconds: number;
  /** Peak gain. Low sounds need more than the scanner's ping to be heard at all. */
  gain: number;
}

export const LUB: Thump = { from: 62, to: 44, seconds: 0.16, gain: 0.45 };
export const DUB: Thump = { from: 84, to: 60, seconds: 0.11, gain: 0.35 };

/** Safe to call repeatedly, and silent on a machine with no audio device. */
export function primeHeartSound(): void {
  try {
    const Ctx: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctx) return;
    context ??= new Ctx();
    if (context.state === "suspended") void context.resume();
  } catch {
    // Audio is a nicety; the heartbeat carries on without it.
  }
}

function thump(sound: Thump): void {
  const ctx = context;
  if (!ctx || ctx.state !== "running") return;
  try {
    const now = ctx.currentTime;
    const end = now + sound.seconds;

    // Everything above a few hundred hertz is click, not heart.
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 380;

    const envelope = ctx.createGain();
    // A few milliseconds of attack: starting at full gain on the first sample
    // is a click, which is the difference between a sound and a fault.
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(sound.gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    soften.connect(envelope).connect(ctx.destination);

    const partials: readonly [OscillatorType, number, number][] = [
      ["sine", 1, 1],
      ["triangle", 2, 0.4],
    ];
    for (const [type, multiple, level] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(sound.from * multiple, now);
      osc.frequency.exponentialRampToValueAtTime(sound.to * multiple, end);
      const mix = ctx.createGain();
      mix.gain.value = level;
      osc.connect(mix).connect(soften);
      osc.start(now);
      // Stopped explicitly, or every beat leaves two nodes behind.
      osc.stop(end + 0.02);
    }
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
}
