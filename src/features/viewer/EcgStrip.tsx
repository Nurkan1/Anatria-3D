import { useEffect, useRef } from "react";

import type { RhythmPlayer } from "./rhythms";

/** How many frames of the two clocks are kept: about two seconds' worth. */
const CLOCK_SAMPLES = 128;

/**
 * Real time against the heart's own time, for the last couple of seconds.
 *
 * The heart's clock runs faster or slower than real time while the breath
 * swings its rate (`sinusArrhythmia.ts`). The strip has to sweep in real
 * seconds, as a monitor does — swept in the heart's seconds, every interval
 * between beats would come out the same and the arrhythmia would be invisible
 * on the very trace that shows it. Each frame the driver records both clocks;
 * between two frames the heart's ran at one speed, so a straight line between
 * them is exact.
 */
export class ClockTrace {
  private readonly real = new Float64Array(CLOCK_SAMPLES);
  private readonly heart = new Float64Array(CLOCK_SAMPLES);
  private count = 0;
  private head = 0;

  push(real: number, heart: number): void {
    this.real[this.head] = real;
    this.heart[this.head] = heart;
    this.head = (this.head + 1) % CLOCK_SAMPLES;
    this.count = Math.min(CLOCK_SAMPLES, this.count + 1);
  }

  /** The heart's time at real time `real`; outside what is kept, at real speed. */
  heartAt(real: number): number {
    if (this.count === 0) return real;
    const at = (back: number) => (this.head - 1 - back + CLOCK_SAMPLES) % CLOCK_SAMPLES;
    let later = at(0);
    if (real >= this.real[later]!) return this.heart[later]! + (real - this.real[later]!);
    for (let back = 1; back < this.count; back++) {
      const earlier = at(back);
      const from = this.real[earlier]!;
      if (real >= from) {
        const span = this.real[later]! - from;
        const along = span > 0 ? (real - from) / span : 1;
        return this.heart[earlier]! + along * (this.heart[later]! - this.heart[earlier]!);
      }
      later = earlier;
    }
    return this.heart[later]! - (this.real[later]! - real);
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
  }
}

/**
 * What the ECG strip reads: the rhythm being played, real time, and how the
 * heart's own clock maps onto it.
 *
 * Written by `HeartbeatDriver` every frame and read by the strip's own loop, so
 * the trace and the heart come from one player on one clock and cannot drift
 * apart — and the viewer does not re-render sixty times a second to carry it.
 */
export const HEART_TRACE: { player: RhythmPlayer | null; now: number; clock: ClockTrace } = {
  player: null,
  now: 0,
  clock: new ClockTrace(),
};

/** Seconds across the strip, like a monitor sweeping at 25 mm/s over 10 cm. */
export const SWEEP_S = 4;
const WIDTH = 188;
const HEIGHT = 40;
/** The blank bar ahead of the pen, in pixels, where the old sweep is erased. */
const GAP = 8;
/** Where zero sits, and how many pixels a full R wave is. */
const BASELINE = HEIGHT * 0.62;
const R_HEIGHT = HEIGHT * 0.5;

/** The pixel column for a time, as the pen sweeps and wraps. */
export function sweepColumn(t: number, width = WIDTH): number {
  const phase = ((t % SWEEP_S) + SWEEP_S) % SWEEP_S;
  return Math.floor((phase / SWEEP_S) * width);
}

/** The pixel row for a trace value, clamped inside the strip. */
export function traceRow(value: number): number {
  return Math.min(HEIGHT - 1, Math.max(1, BASELINE - value * R_HEIGHT));
}

/**
 * A monitor-style ECG under the heartbeat's panel.
 *
 * The pen sweeps left to right and overwrites the previous sweep, as a bedside
 * monitor does, rather than scrolling: a scrolling trace moves every pixel
 * every frame, which is harder to read and exactly the kind of motion the
 * reduced-motion setting exists to spare people.
 */
export function EcgStrip() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = WIDTH * ratio;
    element.height = HEIGHT * ratio;
    context.scale(ratio, ratio);

    let frame = 0;
    let lastPlayer: RhythmPlayer | null = null;
    let lastColumn = -1;
    let lastRow = BASELINE;

    const clearColumns = (from: number, to: number) => {
      for (let x = from; x < to; x++) {
        const column = ((x % WIDTH) + WIDTH) % WIDTH;
        context.clearRect(column, 0, 1, HEIGHT);
        // The faint grid a monitor draws, one line every half second.
        if (column % Math.round(WIDTH / (SWEEP_S * 2)) === 0) {
          context.fillStyle = "rgba(74, 222, 128, 0.12)";
          context.fillRect(column, 0, 1, HEIGHT);
        }
      }
    };

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const { player, now, clock } = HEART_TRACE;
      if (player !== lastPlayer) {
        // A new rhythm starts a clean strip.
        lastPlayer = player;
        clearColumns(0, WIDTH);
        lastColumn = -1;
      }
      if (!player) return;

      const column = sweepColumn(now);
      if (lastColumn < 0) {
        lastColumn = column;
        lastRow = traceRow(player.ecgAt(clock.heartAt(now)));
        return;
      }
      // How many columns the pen moved, through a wrap if there was one.
      const moved = (column - lastColumn + WIDTH) % WIDTH;
      if (moved === 0) return;
      // A stall of more than a sweep cannot be drawn honestly; start again.
      const steps = Math.min(moved, WIDTH);

      context.strokeStyle = "#4ade80";
      context.lineWidth = 1.2;
      context.lineJoin = "round";
      for (let i = 1; i <= steps; i++) {
        const x = (lastColumn + i) % WIDTH;
        const t = now - ((steps - i) / WIDTH) * SWEEP_S;
        clearColumns(x + 1, x + 1 + GAP);
        clearColumns(x, x + 1);
        const row = traceRow(player.ecgAt(clock.heartAt(t)));
        context.beginPath();
        // Across a wrap the segment starts at the left edge, not from the right.
        context.moveTo(x === 0 ? 0 : x - 1, lastRow);
        context.lineTo(x, row);
        context.stroke();
        lastRow = row;
      }
      lastColumn = column;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mt-1">
      <canvas
        ref={canvas}
        role="img"
        aria-label="Schematic ECG trace of the chosen rhythm, drawn in time with the heart"
        style={{ width: WIDTH, height: HEIGHT }}
        className="block rounded bg-slate-950"
      />
      <p className="mt-0.5 text-[8px] text-slate-500">Schematic ECG, lead II style · not a recording</p>
    </div>
  );
}
