/**
 * How much the hologram asks of the machine, and how that is decided.
 *
 * The look is the same at every level — the brain, the lines, the glow, the
 * figure, the thread. What changes is what nobody reads as design: how many
 * pixels are drawn, the resolution the glow is computed at, and how many of the
 * drifting particles are shown. A laptop on integrated graphics gets the same
 * lab, drawn lighter; a machine rendering in software gets the lightest.
 *
 * Two decisions, kept apart so each can be tested:
 * - where to start, from what the graphics adapter says it is;
 * - when to step down (or back up), from the time frames actually take.
 */

export interface Level {
  /** Most device pixels per CSS pixel. */
  pixelRatio: number;
  /** The glow's resolution, as a share of the screen's. */
  bloom: number;
  /** Share of the drifting particles drawn. */
  particles: number;
}

/** Lightest first. Index 3 is the full lab. */
export const LEVELS: readonly Level[] = [
  { pixelRatio: 0.75, bloom: 0.4, particles: 0.35 },
  { pixelRatio: 1, bloom: 0.5, particles: 0.6 },
  { pixelRatio: 1.25, bloom: 0.75, particles: 0.85 },
  { pixelRatio: 1.75, bloom: 1, particles: 1 },
];
export const FULL = LEVELS.length - 1;

export type Adapter = "software" | "integrated" | "dedicated" | "unknown";

/** What kind of graphics this is, from the renderer string WebGL reports. */
export function classifyAdapter(renderer: string | null): Adapter {
  if (!renderer) return "unknown";
  if (/swiftshader|basic render|llvmpipe|softpipe|software|warp/i.test(renderer)) return "software";
  if (/nvidia|geforce|quadro|rtx|gtx|radeon\s*(rx|pro)|arc\s*a\d|\bamd\b.*\brx\b/i.test(renderer)) return "dedicated";
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega|adreno|mali|apple/i.test(renderer)) return "integrated";
  return "unknown";
}

/** Where to begin: generous where the hardware is known to cope, careful where it is not. */
export function startingLevel(adapter: Adapter): number {
  if (adapter === "software") return 0;
  if (adapter === "integrated") return 2;
  return FULL;
}

/** Frames per judgement: about two seconds at 60 Hz. */
const WINDOW = 120;
/** A gap this long is a load or a hidden window, not the hologram being slow. */
const IGNORE_MS = 250;
/** Slower than this (under 40 fps) for a whole window steps down. */
const SLOW_MS = 25;
/** Back up only after this many windows at display rate: some twenty seconds. */
const STEADY_WINDOWS = 10;
const STEADY_MS = 18;

/**
 * Watches frame times and says when to change level.
 *
 * Steps down quickly — two slow seconds are already a bad experience — and back
 * up slowly, never above where it started: a frame at display rate cannot say
 * how much room is left, so climbing past the starting level would only find
 * the limit by stuttering into it.
 */
export class FrameGovernor {
  private samples: number[] = [];
  private steady = 0;
  level: number;

  constructor(
    private readonly ceiling: number,
    start = ceiling,
  ) {
    this.level = Math.min(start, ceiling);
  }

  /** One frame's duration. Returns the new level when it changes, otherwise null. */
  sample(ms: number): number | null {
    if (!(ms > 0) || ms > IGNORE_MS) return null;
    this.samples.push(ms);
    if (this.samples.length < WINDOW) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    this.samples = [];
    if (median > SLOW_MS && this.level > 0) {
      this.steady = 0;
      this.level -= 1;
      return this.level;
    }
    this.steady = median <= STEADY_MS ? this.steady + 1 : 0;
    if (this.steady >= STEADY_WINDOWS && this.level < this.ceiling) {
      this.steady = 0;
      this.level += 1;
      return this.level;
    }
    return null;
  }
}
