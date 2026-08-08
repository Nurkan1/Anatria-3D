import { describe, expect, it } from "vitest";

import {
  busiestTouches,
  coverageColour,
  coverageDepth,
  coverageLegend,
} from "./coverage";

describe("coverageDepth", () => {
  it("is zero for a structure never touched", () => {
    // The gap is the point of the map, and it has to be one flat colour rather
    // than the dim end of a ramp — otherwise "barely studied" and "never seen"
    // look the same.
    expect(coverageDepth(0, 10)).toBe(0);
  });

  it("is full for the busiest structure in the journal", () => {
    expect(coverageDepth(10, 10)).toBe(1);
  });

  it("gives the first visit most of the distance", () => {
    // The note that changes whether you have been somewhere at all matters
    // more than the twelfth. Linear, one heavily-worked region would flatten
    // everything else into the dark.
    expect(coverageDepth(1, 16)).toBeGreaterThan(1 / 16);
    expect(coverageDepth(4, 16)).toBeCloseTo(0.5);
  });

  it("never exceeds the top of the ramp", () => {
    // A count above the maximum should not happen, but a colour outside the
    // scale would be unreadable rather than merely wrong.
    expect(coverageDepth(50, 10)).toBe(1);
  });

  it("has no answer for an empty journal", () => {
    expect(coverageDepth(3, 0)).toBe(0);
  });
});

describe("coverageColour", () => {
  it("separates never-touched from touched once", () => {
    // The distinction the whole map rests on. If a single note is
    // indistinguishable from silence, the shape of your revision is invisible.
    const untouched = coverageColour(0, 20).getHexString();
    const visited = coverageColour(1, 20).getHexString();
    expect(untouched).not.toBe(visited);
  });

  it("climbs towards the brightest end as the work adds up", () => {
    const light = (touches: number) => {
      const { r, g, b } = coverageColour(touches, 25);
      return r + g + b;
    };
    expect(light(1)).toBeLessThan(light(9));
    expect(light(9)).toBeLessThan(light(25));
  });
});

describe("busiestTouches", () => {
  it("finds the top of the scale", () => {
    expect(busiestTouches({ heart: 3, aorta: 11, lung: 7 })).toBe(11);
  });

  it("is zero for a journal with nothing filed against a structure", () => {
    expect(busiestTouches({})).toBe(0);
  });
});

describe("coverageLegend", () => {
  it("says what the brightest end actually means", () => {
    // The scale is relative to this journal, so the reader has to be told what
    // its top is. Without that the map is a mood.
    const legend = coverageLegend(14);
    expect(legend.map((entry) => entry.label)).toEqual([
      "not yet",
      "been here",
      "most (14)",
    ]);
  });

  it("has nothing to explain when nothing has been studied", () => {
    expect(coverageLegend(0)).toEqual([]);
  });
});
