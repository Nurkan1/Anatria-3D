import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  EXPLODE_STOPS,
  explodeMembers,
  explodeOffsets,
  explodePivot,
  explodeScope,
  MAX_EXPLODE,
  nextExplodeStop,
} from "./explode";

const centres = new Map([
  ["left", new THREE.Vector3(-2, 0, 0)],
  ["right", new THREE.Vector3(2, 0, 0)],
  ["top", new THREE.Vector3(0, 4, 0)],
  ["middle", new THREE.Vector3(0, 2, 0)],
]);

describe("explodePivot", () => {
  it("takes the centre of the box, not the average of the members", () => {
    // Three structures clustered low and one high. A mean pivot sits at y=1.5,
    // inside the cluster, and the explosion comes out lopsided; the box centre
    // is at y=2, which is what "the middle of this group" means to someone
    // looking at it.
    const clustered = new Map([
      ["a", new THREE.Vector3(0, 0, 0)],
      ["b", new THREE.Vector3(0, 0.5, 0)],
      ["c", new THREE.Vector3(0, 1, 0)],
      ["d", new THREE.Vector3(0, 4, 0)],
    ]);
    const pivot = explodePivot(["a", "b", "c", "d"], clustered);
    expect(pivot?.y).toBeCloseTo(2);
  });

  it("ignores members with no measured centre", () => {
    const pivot = explodePivot(["left", "right", "never_loaded"], centres);
    expect(pivot).not.toBeNull();
    expect(pivot!.x).toBeCloseTo(0);
  });

  it("has no answer when nothing was measured", () => {
    expect(explodePivot(["never_loaded"], centres)).toBeNull();
  });
});

describe("explodeOffsets", () => {
  it("moves each part away from the pivot, in proportion to where it stood", () => {
    const offsets = explodeOffsets(["left", "right"], centres, 0.5);
    // Pivot at the origin, so each moves half its own distance outwards.
    expect(offsets.get("left")!.x).toBeCloseTo(-1);
    expect(offsets.get("right")!.x).toBeCloseTo(1);
  });

  it("keeps the arrangement in order at every amount", () => {
    // The property that makes this navigable rather than a shuffle: of two
    // parts on the same side of the centre, whichever was nearer stays nearer,
    // so the reader never loses track of which part is which.
    //
    // The far member is only there to fix the pivot at the origin.
    const stack = new Map([
      ["far", new THREE.Vector3(-3, 0, 0)],
      ["near", new THREE.Vector3(1, 0, 0)],
      ["middle", new THREE.Vector3(2, 0, 0)],
      ["outer", new THREE.Vector3(3, 0, 0)],
    ]);
    const ids = [...stack.keys()];
    const pivot = explodePivot(ids, stack)!;
    expect(pivot.x).toBeCloseTo(0);

    for (const factor of [0.2, 1, MAX_EXPLODE]) {
      const offsets = explodeOffsets(ids, stack, factor);
      const distance = (id: string) =>
        stack.get(id)!.clone().add(offsets.get(id)!).distanceTo(pivot);
      expect(distance("near")).toBeLessThan(distance("middle"));
      expect(distance("middle")).toBeLessThan(distance("outer"));
    }
  });

  it("returns nothing at all when the amount is zero", () => {
    // Not a map of zero vectors: absence is what every consumer reads as "this
    // structure has not moved", and it is what keeps the idle path free.
    expect(explodeOffsets(["left", "right"], centres, 0).size).toBe(0);
  });

  it("refuses a negative or non-finite amount rather than imploding the body", () => {
    expect(explodeOffsets(["left", "right"], centres, -1).size).toBe(0);
    expect(explodeOffsets(["left", "right"], centres, Number.NaN).size).toBe(0);
  });

  it("leaves out a structure sitting on the pivot", () => {
    // It has no direction to travel in, and inventing one would be the first
    // arbitrary decision in a layout that otherwise comes entirely from the
    // anatomy. Concentric structures are what transparency is for.
    const shells = new Map([
      ["outer", new THREE.Vector3(0, 0, 0)],
      ["inner", new THREE.Vector3(0, 0, 0)],
    ]);
    expect(explodeOffsets(["outer", "inner"], shells, 1).size).toBe(0);
  });

  it("skips a member the atlas never measured", () => {
    const offsets = explodeOffsets(["left", "right", "never_loaded"], centres, 1);
    expect(offsets.has("never_loaded")).toBe(false);
    expect(offsets.size).toBe(2);
  });

  it("is exactly reversible: the anatomy is the zero of the scale", () => {
    const factor = 1.3;
    const offsets = explodeOffsets(["left", "right", "top"], centres, factor);
    const pivot = explodePivot(["left", "right", "top"], centres)!;
    for (const [id, offset] of offsets) {
      const moved = centres.get(id)!.clone().add(offset);
      // Undoing the scaling has to land back on the original centre, to the
      // last bit — otherwise sliding up and back would leave the body subtly
      // deformed.
      const back = moved.sub(pivot).divideScalar(1 + factor).add(pivot);
      expect(back.distanceTo(centres.get(id)!)).toBeLessThan(1e-6);
    }
  });
});

describe("explodeScope", () => {
  it("takes the selection when it has more than one member", () => {
    expect(
      explodeScope({ selectedOrganIds: ["a", "b"], isolatedOrganIds: ["c", "d", "e"] }),
    ).toBe("selection");
  });

  it("ignores a single selected structure", () => {
    // One thing has no parts to separate. Exploding it alone would do nothing
    // while looking like the control is broken, so a lone selection falls
    // through to whatever larger group is in play.
    expect(
      explodeScope({ selectedOrganIds: ["a"], isolatedOrganIds: ["c", "d"] }),
    ).toBe("region");
  });

  it("takes the isolated region when nothing is selected", () => {
    expect(explodeScope({ selectedOrganIds: [], isolatedOrganIds: ["c", "d"] })).toBe(
      "region",
    );
  });

  it("falls back to the whole body", () => {
    expect(explodeScope({ selectedOrganIds: [], isolatedOrganIds: null })).toBe(
      "everything",
    );
    // A region of one is no more explodable than a selection of one.
    expect(explodeScope({ selectedOrganIds: [], isolatedOrganIds: ["c"] })).toBe(
      "everything",
    );
  });
});

describe("explodeMembers", () => {
  const loaded = ["a", "b", "c", "d", "e"];

  it("resolves the whole atlas for the whole-body case", () => {
    expect(explodeMembers({ selectedOrganIds: [], isolatedOrganIds: null }, loaded)).toEqual(
      loaded,
    );
  });

  it("resolves the study set", () => {
    expect(
      explodeMembers({ selectedOrganIds: [], isolatedOrganIds: ["c", "d"] }, loaded),
    ).toEqual(["c", "d"]);
  });
});

describe("nextExplodeStop", () => {
  it("steps up through the stops and wraps back to nothing", () => {
    let value = 0;
    const seen = [value];
    for (let step = 0; step < EXPLODE_STOPS.length; step += 1) {
      value = nextExplodeStop(value);
      seen.push(value);
    }
    expect(seen).toEqual([...EXPLODE_STOPS, 0]);
  });

  it("advances from a value the slider left between stops", () => {
    // Without a tolerance, a slider parked a hair above a stop would return
    // that same stop and the key would appear dead.
    expect(nextExplodeStop(0.9000000001)).toBe(1.8);
    expect(nextExplodeStop(0.5)).toBe(0.9);
  });

  it("wraps from anywhere past the last stop, including the slider's maximum", () => {
    expect(nextExplodeStop(MAX_EXPLODE)).toBe(0);
  });
});
