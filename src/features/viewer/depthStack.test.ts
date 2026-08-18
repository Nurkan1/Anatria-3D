import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeClickReport,
  consumeDepthStackReport,
  MAX_STACK,
  illuminationGlow,
  LIT_DIMMEST,
  probeGlow,
  PROBE_REACH,
  reportClick,
  reportDepthStack,
  sameStack,
  stackFromCrossings,
} from "./depthStack";

/** What a three.js intersection looks like to this module, and no more. */
const crossing = (organId?: unknown) => ({ object: { userData: { organId } } });

describe("stackFromCrossings", () => {
  it("keeps the order the ray met them in", () => {
    // The order is the whole answer: it is what "what do I go through to reach
    // the carotid" means.
    expect(
      stackFromCrossings([
        crossing("skin_of_neck"),
        crossing("platysma"),
        crossing("common_carotid_artery"),
      ]),
    ).toEqual(["skin_of_neck", "platysma", "common_carotid_artery"]);
  });

  it("names a structure once however many times the ray crossed it", () => {
    // A ray entering and leaving a ventricle hits the same mesh twice. Listed
    // twice with something else between them, that reads as an anatomical
    // claim rather than as an artefact of a concave shape.
    expect(
      stackFromCrossings([
        crossing("left_ventricle"),
        crossing("mitral_valve"),
        crossing("left_ventricle"),
      ]),
    ).toEqual(["left_ventricle", "mitral_valve"]);
  });

  it("ignores anything in the scene that is not a structure", () => {
    // The pathway marker and the eye groups are in the scene too, and they
    // carry no organ id.
    expect(
      stackFromCrossings([crossing(undefined), crossing("aorta"), crossing(42)]),
    ).toEqual(["aorta"]);
  });

  it("stops at a readable depth", () => {
    const deep = Array.from({ length: MAX_STACK + 8 }, (_, index) =>
      crossing(`structure_${index}`),
    );
    expect(stackFromCrossings(deep)).toHaveLength(MAX_STACK);
  });

  it("survives an object with no userData at all", () => {
    expect(stackFromCrossings([{ object: {} }, crossing("aorta")])).toEqual(["aorta"]);
  });
});

describe("sameStack", () => {
  it("recognises an unchanged reading", () => {
    // The pointer emits far more moves than the reading changes, and every
    // write re-renders the scene graph.
    expect(sameStack(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("sees a reordering as a change", () => {
    // Same structures, different depths: the reader moved to somewhere the
    // layers stack up the other way round, which is exactly the interesting
    // case.
    expect(sameStack(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("sees a different depth as a change", () => {
    expect(sameStack(["a"], ["a", "b"])).toBe(false);
  });
});

describe("probeGlow", () => {
  it("is brightest at the surface", () => {
    expect(probeGlow(0)).toBe(1);
  });

  it("dims with every layer, in even steps", () => {
    // The point is to read *order* — which of these is nearer the surface — and
    // an exponential curve collapses everything past the second layer into the
    // same dimness.
    const steps = [0, 1, 2, 3].map(probeGlow);
    const gaps = steps.slice(1).map((value, index) => steps[index]! - value);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!);
  });

  it("goes dark past the light's reach", () => {
    // A dozen structures lit at once is a lit column, not a lit organ.
    expect(probeGlow(PROBE_REACH)).toBe(0);
    expect(probeGlow(PROBE_REACH + 5)).toBe(0);
  });

  it("refuses a depth that cannot be one", () => {
    expect(probeGlow(-1)).toBe(0);
    expect(probeGlow(Number.NaN)).toBe(0);
  });
});

describe("the report flag", () => {
  beforeEach(() => {
    consumeDepthStackReport();
  });

  it("is consumed exactly once", () => {
    reportDepthStack();
    expect(consumeDepthStackReport()).toBe(true);
    expect(consumeDepthStackReport()).toBe(false);
  });

  it("is false when the pointer crossed nothing", () => {
    // Which is how the panel learns to clear: over the background no structure
    // runs a handler at all, so nothing answers for that move.
    expect(consumeDepthStackReport()).toBe(false);
  });
});

/**
 * The click flag, and the gap it closes.
 *
 * A structure faded past `GHOST_CLICK_THROUGH` declines clicks so the event can
 * carry on to the first thing solid enough to take it. Ghost the whole body and
 * there is no such thing: every handler along the ray declines, and a single
 * click did nothing at all — while double-click, which never carried that
 * guard, went on isolating. The viewport now answers the unclaimed click from
 * the reading it is already taking, and this is how it learns nobody else did.
 */
describe("the click flag", () => {
  beforeEach(() => {
    consumeClickReport();
  });

  it("is consumed exactly once", () => {
    // Two clicks answered by one report would let the viewport select twice
    // for a single press.
    reportClick();
    expect(consumeClickReport()).toBe(true);
    expect(consumeClickReport()).toBe(false);
  });

  it("starts false, so an unclaimed click is answered", () => {
    expect(consumeClickReport()).toBe(false);
  });

  it("is independent of the depth-stack flag", () => {
    // They ride on different events — one on every pointer move, one on a
    // press — and a shared flag would have each consuming the other's answer.
    reportDepthStack();

    expect(consumeClickReport()).toBe(false);
    expect(consumeDepthStackReport()).toBe(true);
  });
});

describe("illuminationGlow", () => {
  it("lights everything the assistant named, however many that is", () => {
    // The bug this replaced. The assistant may light 24 structures, and this
    // borrowed `probeGlow`, whose falloff is calibrated for a six-deep cursor
    // column and returns 0 past it — so from the seventh onwards nothing lit,
    // while the answer still carried a numbered pin pointing at it.
    const count = 24;
    for (let index = 0; index < count; index += 1) {
      expect(illuminationGlow(index, count), `named ${index} of ${count}`).toBeGreaterThan(0);
    }
  });

  it("is brightest on the first named and dimmest on the last", () => {
    expect(illuminationGlow(0, 5)).toBe(1);
    expect(illuminationGlow(4, 5)).toBeCloseTo(LIT_DIMMEST);
  });

  it("never dims past the floor, so nothing lit reads as unlit", () => {
    for (const count of [2, 6, 12, 24]) {
      for (let index = 0; index < count; index += 1) {
        expect(illuminationGlow(index, count)).toBeGreaterThanOrEqual(LIT_DIMMEST);
      }
    }
  });

  it("gives a lone structure the full light rather than the floor", () => {
    expect(illuminationGlow(0, 1)).toBe(1);
  });

  it("refuses an index that cannot be one", () => {
    expect(illuminationGlow(-1, 5)).toBe(0);
    expect(illuminationGlow(5, 5)).toBe(0);
    expect(illuminationGlow(Number.NaN, 5)).toBe(0);
  });
});
