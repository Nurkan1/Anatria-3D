import { describe, expect, it } from "vitest";

import { SQUEEZE } from "./heartbeat";
import { LightGuard, SAFE_FLASH_HZ } from "./lightGuard";
import { RHYTHMS, RhythmPlayer, rhythm, type RhythmId } from "./rhythms";

/** Play a rhythm for `seconds` through two guards; return what the light did. */
function light(id: RhythmId, seconds = 12, calm = false) {
  const player = new RhythmPlayer(rhythm(id));
  const guards = { atria: new LightGuard(), ventricles: new LightGuard() };
  const shown = { atria: [] as number[], ventricles: [] as number[] };
  let t = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const next = t + 1 / 60;
    const beat = player.advance(t, next);
    shown.atria.push(guards.atria.next(next, 1 / 60, beat.atria / SQUEEZE.atria, calm));
    shown.ventricles.push(guards.ventricles.next(next, 1 / 60, beat.ventricles / SQUEEZE.ventricles, calm));
    t = next;
  }
  return { shown, steady: { atria: guards.atria.steady, ventricles: guards.ventricles.steady } };
}

/**
 * The most times the shown light brightened and faded in any one second,
 * counted as rises of more than a tenth of full brightness.
 */
function worstFlashesPerSecond(levels: number[]): number {
  const rises: number[] = [];
  let low = levels[0] ?? 0;
  let rising = false;
  levels.forEach((level, i) => {
    if (!rising && level - low > 0.1) {
      rises.push(i / 60);
      rising = true;
    }
    if (rising && level < low + 0.05) rising = false;
    if (!rising) low = Math.min(low, level);
    else low = Math.min(level, low + 0.02);
  });
  let worst = 0;
  for (const at of rises) {
    worst = Math.max(worst, rises.filter((other) => other >= at && other < at + 1).length);
  }
  return worst;
}

describe("LightGuard", () => {
  it("lets the light follow a beat that is slow enough", () => {
    for (const id of ["normal", "sinus_tachycardia", "sinus_bradycardia", "mobitz_1"] as const) {
      expect(light(id).steady).toEqual({ atria: false, ventricles: false });
    }
  });

  it("holds the light steady for atria that flutter or fibrillate", () => {
    expect(light("atrial_flutter").steady.atria).toBe(true);
    expect(light("atrial_fibrillation").steady.atria).toBe(true);
  });

  it("holds the light steady for ventricles that race or quiver", () => {
    expect(light("ventricular_tachycardia").steady.ventricles).toBe(true);
    expect(light("ventricular_fibrillation").steady.ventricles).toBe(true);
  });

  it("never flashes more than three times in any second, from the first frame", () => {
    // WCAG 2.3.1: no more than three flashes in any one-second period.
    for (const definition of RHYTHMS) {
      const { shown } = light(definition.id);
      // From the very first frame: the guard must not need a burst to notice.
      for (const levels of [shown.atria, shown.ventricles]) {
        expect(worstFlashesPerSecond(levels), definition.id).toBeLessThanOrEqual(3);
      }
    }
  });

  it("holds every light steady when the reader asks for less motion", () => {
    expect(light("normal", 4, true).steady).toEqual({ atria: true, ventricles: true });
  });

  it("is safely below the limit it guards", () => {
    expect(SAFE_FLASH_HZ).toBeLessThan(3);
  });
});
