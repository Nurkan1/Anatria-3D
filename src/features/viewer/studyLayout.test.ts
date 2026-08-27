import { describe, expect, it } from "vitest";

import { domRect, MAIN, mainRect, panelLayout, type AuxiliaryView } from "./studyLayout";

const ALL: AuxiliaryView[] = ["anterior", "left", "superior"];

describe("panelLayout", () => {
  it("gives the whole canvas to the reader's own view when nothing else is on", () => {
    expect(panelLayout([])).toEqual([{ id: MAIN, x: 0, y: 0, width: 1, height: 1 }]);
  });

  it("splits down the middle for one auxiliary, at full height", () => {
    // Not two quarters with half the canvas empty: the reason to switch views
    // off is to give what is left more room.
    const [main, aux] = panelLayout(["anterior"]);
    expect(main).toEqual({ id: MAIN, x: 0, y: 0, width: 0.5, height: 1 });
    expect(aux).toEqual({ id: "anterior", x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it("stacks two auxiliaries beside a full-height main view", () => {
    const rects = panelLayout(["anterior", "superior"]);
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ id: MAIN, x: 0, y: 0, width: 0.5, height: 1 });
    // WebGL measures from the bottom, so the upper of the two is the one at 0.5.
    expect(rects[1]).toMatchObject({ id: "anterior", y: 0.5 });
    expect(rects[2]).toMatchObject({ id: "superior", y: 0 });
  });

  it("falls back to the quartered grid with all three on", () => {
    const rects = panelLayout(ALL);
    expect(rects).toHaveLength(4);
    expect(rects[0]).toEqual({ id: MAIN, x: 0, y: 0.5, width: 0.5, height: 0.5 });
    expect(rects.every((r) => r.width === 0.5 && r.height === 0.5)).toBe(true);
  });

  it("keeps the main panel in the top-left corner whenever it shares the canvas", () => {
    // The reader's bearings: switching a different view off must not move the
    // one they are driving.
    for (const active of [["anterior"], ["anterior", "left"], ALL] as AuxiliaryView[][]) {
      const main = mainRect(active);
      expect(domRect(main)).toMatchObject({ left: 0, top: 0 });
    }
  });

  it("covers the canvas exactly, with no overlap and no gap", () => {
    for (const active of [[], ["left"], ["left", "superior"], ALL] as AuxiliaryView[][]) {
      const area = panelLayout(active).reduce((sum, r) => sum + r.width * r.height, 0);
      expect(area).toBeCloseTo(1, 10);
    }
  });

  it("never returns a panel outside the canvas", () => {
    for (const active of [[], ["superior"], ["anterior", "superior"], ALL] as AuxiliaryView[][]) {
      for (const rect of panelLayout(active)) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(1);
        expect(rect.y + rect.height).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lays panels out in the order they were switched on", () => {
    // So that turning `anterior` off and on again does not shuffle the two that
    // stayed put.
    const rects = panelLayout(["superior", "left"]);
    expect(rects.map((r) => r.id)).toEqual([MAIN, "superior", "left"]);
  });
});

describe("domRect", () => {
  it("flips the origin from WebGL's bottom left to the DOM's top left", () => {
    expect(domRect({ id: MAIN, x: 0, y: 0.5, width: 0.5, height: 0.5 })).toEqual({
      left: 0,
      top: 0,
      width: 0.5,
      height: 0.5,
    });
    expect(domRect({ id: "left", x: 0, y: 0, width: 0.5, height: 0.5 })).toEqual({
      left: 0,
      top: 0.5,
      width: 0.5,
      height: 0.5,
    });
  });
});
