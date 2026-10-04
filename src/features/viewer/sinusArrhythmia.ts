import type { BreathPattern } from "./breathing";

/**
 * Respiratory sinus arrhythmia: the heart keeping time with the breath.
 *
 * # What it is
 *
 * In a healthy heart the rate is not constant. As a breath comes in the vagus
 * nerve lets go of the sinus node a little and the heart speeds up; as it goes
 * out the vagus takes hold again and the heart slows. It is normal — largest in
 * the young and the fit, smaller with age — and it is largest when breathing is
 * slow and deep, about six breaths a minute, which is why the bedside
 * deep-breathing test asks for exactly that. In a healthy young adult the rate
 * then commonly swings by more than fifteen beats a minute.
 *
 * Only a heart paced by its sinus node shows it. Where something else sets the
 * ventricles' pace — fibrillating or fluttering atria, an escape rhythm under a
 * complete block, a ventricular focus — the breath does not reach them, and
 * each rhythm says how much of the swing it lets through
 * (`RhythmDefinition.followsBreath`).
 *
 * # How it is shown
 *
 * The rhythm's planner lays down beats at fixed intervals on the heart's own
 * clock, and the breath changes how fast that clock runs against real time.
 * But only while the heart is at rest between beats: a real heart that speeds
 * up shortens diastole and leaves its contraction nearly as long, so the
 * clock runs at its true speed through every contraction. It runs faster or
 * slower in what is left, by enough to move the whole interval between beats
 * by the swing asked for — which is why the swing is divided by the share of
 * time the heart spends at rest.
 *
 * Illustrative, as everything the heartbeat shows: the right direction, about
 * the right size and the right timing, on one representative heart.
 */

/**
 * Where the sinus node's pace is in the breath, -1 to 1.
 *
 * Lowest as a breath begins — the end of the breath out before it — rising
 * through the breath in and highest just after it, when the breath out has
 * begun: the heart follows the breath a little late, as it does in life.
 */
export function sinusPace(seconds: number, pattern: Pick<BreathPattern, "period">): number {
  const period = pattern.period;
  const phase = (((seconds % period) + period) % period) / period;
  return -Math.cos(2 * Math.PI * phase);
}

/** How slowly the measured share of time at rest follows the rhythm, in seconds. */
const SHARE_SETTLE_S = 3;
/** The least share of time at rest the pacer divides by, so a fast rhythm cannot run away. */
const MIN_SHARE = 0.2;
/** The slowest and fastest the heart's clock may run between beats, against real time. */
const SLOWEST = 0.5;
const FASTEST = 2;

/**
 * Turns real seconds into the heart's seconds, frame by frame.
 *
 * `swing` is the fraction the heart rate should be above (positive) or below
 * (negative) its rhythm's own right now; `resting` whether the heart was at
 * rest between contractions in the last frame. A swing of zero, or a frame in
 * which anything is contracting, passes time through unchanged.
 */
export class BreathPacer {
  /** The share of real time the heart has spent at rest lately, 0 to 1. */
  private share = 0.5;

  advance(step: number, swing: number, resting: boolean): number {
    this.share += ((resting ? 1 : 0) - this.share) * Math.min(1, step / SHARE_SETTLE_S);
    if (!resting || swing === 0) return step;
    const speed = 1 + swing / Math.max(MIN_SHARE, this.share);
    return step * Math.min(FASTEST, Math.max(SLOWEST, speed));
  }

  reset(): void {
    this.share = 0.5;
  }
}
