/**
 * Keeps the heart's light from flashing faster than is safe to watch.
 *
 * # Why
 *
 * Light that brightens and fades more than three times a second can trigger a
 * seizure in someone with photosensitive epilepsy, and saturated red is the
 * worst case — WCAG 2.3.1 draws the line there. The heartbeat's light follows
 * the chosen rhythm, and some rhythms are exactly that fast: atrial flutter
 * contracts the atria five times a second, ventricular tachycardia beats nearly
 * three, and fibrillation quivers faster still.
 *
 * # What it does
 *
 * Watches how closely the light's rises through the middle of its recent range
 * follow each other, over the last two seconds. Below `SAFE_FLASH_HZ` the light
 * follows the beat exactly. At or above it — or whenever the reader's system asks for reduced
 * motion — the light holds a steady level instead: the average it would have
 * had, followed slowly. The heart still moves at the full rate; only the light
 * stops pulsing.
 *
 * Below three on purpose: sinus tachycardia at 130 (2.2 per second) still
 * pulses, ventricular tachycardia at 170 (2.8) already does not.
 */

/** The fastest the light may pulse, per second. WCAG's limit is three. */
export const SAFE_FLASH_HZ = 2.5;
/** How far back the pulses are counted, in seconds. */
const WINDOW_S = 2;
/** How slowly the steady level follows the average, in seconds. */
const STEADY_SETTLE_S = 0.8;

export class LightGuard {
  private rises: number[] = [];
  private above = false;
  private low = 0;
  private high = 0;
  private mean = 0;
  /** Whether the light is being held steady right now. */
  steady = false;

  /**
   * The light level to show at `now` for a raw level in 0–1, `step` seconds
   * after the last call. `calm` holds it steady whatever the rate.
   */
  next(now: number, step: number, raw: number, calm = false): number {
    // A slowly relaxing range, so the middle follows a rhythm that grows weaker.
    const relax = Math.min(1, step / WINDOW_S);
    this.high = Math.max(raw, this.high + (raw - this.high) * relax);
    this.low = Math.min(raw, this.low + (raw - this.low) * relax);
    const middle = (this.high + this.low) / 2;
    const range = this.high - this.low;

    const nowAbove = range > 0.05 && raw > middle;
    if (nowAbove && !this.above) this.rises.push(now);
    this.above = nowAbove;
    while (this.rises.length > 0 && now - this.rises[0]! > WINDOW_S) this.rises.shift();

    this.mean += (raw - this.mean) * Math.min(1, step / STEADY_SETTLE_S);
    // The rate from the spacing of the rises seen, not their count over the
    // whole window: two rises are enough to know, so a rhythm that is too fast
    // is caught at its second flash rather than after two seconds of them.
    const seen = this.rises.length;
    const span = seen >= 2 ? this.rises[seen - 1]! - this.rises[0]! : 0;
    this.steady = calm || (span > 0 && (seen - 1) / span >= SAFE_FLASH_HZ);
    return this.steady ? this.mean : raw;
  }

  reset(): void {
    this.rises = [];
    this.above = false;
    this.low = 0;
    this.high = 0;
    this.mean = 0;
    this.steady = false;
  }
}

/** Whether the reader's system asks for less motion. Read, not subscribed. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
