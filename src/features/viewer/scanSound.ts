/**
 * The scanner's ping, synthesised rather than shipped.
 *
 * # Why there is no audio file
 *
 * A short instrument tone is a handful of oscillator parameters. Shipping one
 * as a sample means bytes in the installer, a decode on first use, and an asset
 * whose licence somebody has to account for — for something describable in
 * thirty lines. Synthesised, it costs nothing on disk and the timbre can be
 * tuned by editing a number rather than by finding another recording.
 *
 * # Why priming is separate from playing
 *
 * Audio does not start without a gesture: a context created outside one begins
 * suspended, and `resume()` from a frame callback is refused. But the pulse is
 * fired from the render loop, one frame after the pointer went up — close
 * enough in time to feel immediate and far enough from the gesture for the
 * browser to say no.
 *
 * So the two halves are split. `primeScanSound` runs on the pointer going
 * *down*, which is unambiguously a gesture, and gets the context running. By
 * the time the reader lets go, playing is just scheduling.
 *
 * # Why one context for the session
 *
 * Contexts are a limited resource — a handful per page — and one per ping would
 * exhaust them in a minute of use. This one is created once, kept, and never
 * closed: an idle `AudioContext` costs nothing measurable and closing it would
 * mean the next ping needing another gesture.
 */

type Ctor = typeof AudioContext;

let context: AudioContext | null = null;

/** The tone, in numbers. Tuned to read as an instrument, not as a notification. */
const PING = {
  /** Where it starts, in hertz. High enough to cut through, low enough not to pierce. */
  from: 920,
  /** And where it falls to. A glide downwards reads as something settling. */
  to: 560,
  /** Seconds. Matched to the light's own decay so the two are one event. */
  seconds: 0.4,
  /**
   * Peak gain, and it is deliberately small.
   *
   * This fires whenever a reader lets go of the slider, which in a session is
   * often. A sound at that rate has to sit under the room rather than in it —
   * loud enough to notice once, quiet enough never to be the reason somebody
   * turns the feature off.
   */
  gain: 0.06,
};

/**
 * Get the audio context going while a gesture is in progress.
 *
 * Safe to call repeatedly. Returns nothing and throws nothing: audio is a
 * nicety, and a machine with no audio device must not take the scanner down
 * with it.
 */
export function primeScanSound(): void {
  try {
    const Ctx: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctx) return;
    context ??= new Ctx();
    if (context.state === "suspended") void context.resume();
  } catch {
    // No audio device, or a policy that refuses one. Nothing to do about it.
  }
}

/**
 * A single ping, at the moment the light is let go.
 *
 * Silent unless `primeScanSound` has already run under a gesture, which is the
 * correct behaviour rather than a limitation: a sound nobody asked for, playing
 * because a timer fired, is what the gesture requirement exists to prevent.
 */
export function playScanPing(): void {
  const ctx = context;
  if (!ctx || ctx.state !== "running") return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Triangle rather than sine: a sine at this length reads as a phone
    // notification, and the odd harmonics of a triangle read as a device.
    osc.type = "triangle";
    osc.frequency.setValueAtTime(PING.from, now);
    osc.frequency.exponentialRampToValueAtTime(PING.to, now + PING.seconds);

    // A short attack rather than none. Starting at full gain on the first
    // sample is a click, which is the difference between a tone and a fault.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(PING.gain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + PING.seconds);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    // Stopped explicitly: an oscillator left running is a node that never gets
    // collected, and one per release adds up over a session.
    osc.stop(now + PING.seconds + 0.02);
  } catch {
    // Same reasoning as above. A failed ping is not worth an error path.
  }
}

/** For tests, which must not carry a live audio context between them. */
export function forgetScanSound(): void {
  context = null;
}
