import { describe, expect, it } from "vitest";

import { STANDING } from "./scanBand";
import { crossingAt, sameCrossing, type Extent } from "./scanCrossing";

/** A box named by its extents, so each test reads as the anatomy it stands for. */
function box(
  min: [number, number, number],
  max: [number, number, number],
): Extent {
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
  };
}

const ATLAS = new Map<string, Extent>([
  // A large organ in the middle of the chest.
  ["lung", box([-0.15, 1.0, -0.1], [-0.02, 1.4, 0.1])],
  // Larger still, and lower.
  ["liver", box([-0.15, 0.85, -0.12], [0.15, 1.05, 0.12])],
  // A rib: real, thin, and not what anyone is trying to learn.
  ["rib", box([-0.16, 1.2, -0.11], [0.16, 1.22, 0.11])],
  // Nowhere near either.
  ["foot", box([-0.1, 0.0, -0.1], [0.1, 0.1, 0.1])],
]);

describe("crossingAt", () => {
  it("finds what the plane passes through and nothing else", () => {
    // 1.21 is inside the rib's 1.20-1.22 as well as the lung's 1.0-1.4.
    const crossing = crossingAt(ATLAS, 1.21, STANDING, 10);
    expect(crossing.organIds).toContain("lung");
    expect(crossing.organIds).toContain("rib");
    expect(crossing.organIds).not.toContain("liver");
    expect(crossing.organIds).not.toContain("foot");
  });

  it("puts the biggest first, because that is what somebody is learning", () => {
    // A plane through both: the liver is the bigger volume and leads.
    const crossing = crossingAt(ATLAS, 1.0, STANDING, 10);
    expect(crossing.organIds[0]).toBe("liver");
  });

  it("shortens the list but still says how many there were", () => {
    // The shortlist must never read as the whole truth — a plane through a
    // chest crosses two hundred structures and naming six of them silently
    // would be a claim about anatomy that is not true.
    const crossing = crossingAt(ATLAS, 1.21, STANDING, 1);
    expect(crossing.organIds).toHaveLength(1);
    expect(crossing.total).toBe(2);
  });

  it("counts a box the plane exactly touches", () => {
    // The top of the liver. Excluding a grazing hit would make structures
    // flicker out one frame before the sweep visibly left them.
    expect(crossingAt(ATLAS, 1.05, STANDING, 10).organIds).toContain("liver");
  });

  it("crosses nothing above the whole atlas", () => {
    expect(crossingAt(ATLAS, 99, STANDING, 10)).toEqual({ organIds: [], total: 0 });
  });

  it("measures along the axis it is given, not along Y", () => {
    // Swept front to back, the foot and the lung are both crossed at z = 0,
    // which sweeping Y would never report together.
    const crossing = crossingAt(ATLAS, 0, [0, 0, 1], 10);
    expect(crossing.organIds).toContain("foot");
    expect(crossing.organIds).toContain("lung");
  });
});

describe("sameCrossing", () => {
  it("is true for a sweep that has moved without reaching anything new", () => {
    const a = crossingAt(ATLAS, 1.30, STANDING, 6);
    const b = crossingAt(ATLAS, 1.31, STANDING, 6);
    expect(sameCrossing(a, b)).toBe(true);
  });

  it("is false the moment the plane leaves something", () => {
    const inside = crossingAt(ATLAS, 1.21, STANDING, 6);
    const past = crossingAt(ATLAS, 1.3, STANDING, 6);
    expect(sameCrossing(inside, past)).toBe(false);
  });

  it("notices a change in the unlisted count alone", () => {
    // Same shortlist, more behind it. Reporting "6 structures" when it is now
    // sixty would be the readout quietly going stale.
    expect(
      sameCrossing({ organIds: ["a"], total: 6 }, { organIds: ["a"], total: 60 }),
    ).toBe(false);
  });
});
