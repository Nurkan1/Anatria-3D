import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  collectInPath,
  extendPath,
  isLassoMeaningful,
  MIN_DRAG,
  PATH_RESOLUTION,
  pathBounds,
  pointInPath,
  shouldSuppressClick,
  suppressNextClick,
} from "./areaSelect";

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("pointInPath", () => {
  it("knows inside from outside", () => {
    expect(pointInPath(50, 50, square)).toBe(true);
    expect(pointInPath(150, 50, square)).toBe(false);
    expect(pointInPath(50, -10, square)).toBe(false);
  });

  it("handles a concave shape, which is most hand-drawn ones", () => {
    // A loop round a skull comes back in under the jaw. A convex-hull test
    // would swallow the neck it deliberately went around.
    const horseshoe = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 60, y: 100 },
      { x: 60, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPath(20, 80, horseshoe)).toBe(true);
    expect(pointInPath(50, 80, horseshoe)).toBe(false);
  });

  it("gives a point on a shared edge to exactly one of the two shapes", () => {
    // Which side of a boundary a point falls on is arbitrary; what is not is
    // that it falls on *one*. The classic ray-casting bug counts a horizontal
    // edge once per endpoint, and the answer inverts — so a point on the line
    // ends up in both shapes, or in neither.
    const above = square;
    const below = [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    const claims = [above, below].filter((shape) => pointInPath(50, 100, shape));
    expect(claims).toHaveLength(1);
  });

  it("never returns anything but a boolean, whatever the edge", () => {
    // A horizontal edge is the one that would divide by zero.
    for (const y of [0, 50, 100]) {
      expect(typeof pointInPath(50, y, square)).toBe("boolean");
    }
  });

  it("treats the loop as closed even when the hand did not close it", () => {
    // Nobody draws an exactly closed curve, and refusing an open one would make
    // the gesture fail nearly every time.
    const open = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 95 },
    ];
    expect(pointInPath(50, 50, open)).toBe(true);
  });
});

describe("extendPath", () => {
  it("ignores a pointer that has barely moved", () => {
    // A pointer emits far more moves than a shape needs, and every extra vertex
    // is another edge test for every structure in the atlas.
    const path = [{ x: 0, y: 0 }];
    expect(extendPath(path, { x: 1, y: 1 })).toBe(path);
  });

  it("records a move worth recording", () => {
    const path = [{ x: 0, y: 0 }];
    const next = extendPath(path, { x: PATH_RESOLUTION + 1, y: 0 });
    expect(next).not.toBe(path);
    expect(next).toHaveLength(2);
  });

  it("starts a path from nothing", () => {
    expect(extendPath([], { x: 5, y: 5 })).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("isLassoMeaningful", () => {
  it("refuses a click that wobbled", () => {
    // Without a floor every Ctrl+click would also commit an empty loop.
    expect(isLassoMeaningful([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }])).toBe(false);
  });

  it("accepts a shape someone meant to draw", () => {
    expect(isLassoMeaningful(square)).toBe(true);
  });

  it("accepts a long thin sweep", () => {
    // Drawing along a vessel is a legitimate shape even with no height.
    const sweep = [
      { x: 0, y: 0 },
      { x: MIN_DRAG * 4, y: 0 },
      { x: MIN_DRAG * 4, y: 1 },
    ];
    expect(isLassoMeaningful(sweep)).toBe(true);
  });

  it("refuses a path too short to be a shape", () => {
    expect(isLassoMeaningful([{ x: 0, y: 0 }, { x: 100, y: 100 }])).toBe(false);
  });
});

describe("pathBounds", () => {
  it("wraps the drawn shape", () => {
    expect(pathBounds(square)).toEqual({ left: 0, top: 0, right: 100, bottom: 100 });
  });
});

describe("collectInPath", () => {
  /** A camera looking down -Z at the origin, so screen space is predictable. */
  function scene() {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return camera;
  }

  const centres = new Map([
    ["middle", new THREE.Vector3(0, 0, 0)],
    ["far_left", new THREE.Vector3(-3, 0, 0)],
    ["behind", new THREE.Vector3(0, 0, 20)],
  ]);
  const candidates = [
    { organ_id: "middle" },
    { organ_id: "far_left" },
    { organ_id: "behind" },
    { organ_id: "unmeasured" },
  ];

  const middleOfScreen = [
    { x: 400, y: 400 },
    { x: 600, y: 400 },
    { x: 600, y: 600 },
    { x: 400, y: 600 },
  ];

  it("catches what the loop was drawn round", () => {
    const found = collectInPath(candidates, centres, scene(), 1000, 1000, middleOfScreen);
    expect(found).toEqual(["middle"]);
  });

  it("leaves out a structure behind the camera", () => {
    // Its projection lands mirrored into the view in front, so a loop over
    // empty space would catch something standing behind the reader.
    const found = collectInPath(candidates, centres, scene(), 1000, 1000, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    expect(found).toContain("middle");
    expect(found).not.toContain("behind");
  });

  it("ignores a structure with no measured centre", () => {
    const found = collectInPath(candidates, centres, scene(), 1000, 1000, middleOfScreen);
    expect(found).not.toContain("unmeasured");
  });

  it("returns nothing for a loop too small to mean anything", () => {
    const found = collectInPath(candidates, centres, scene(), 1000, 1000, [
      { x: 500, y: 500 },
      { x: 501, y: 501 },
      { x: 502, y: 500 },
    ]);
    expect(found).toEqual([]);
  });
});

describe("click suppression", () => {
  it("swallows exactly one click after a loop", () => {
    // R3F raises `click` on pointer-up however far the pointer travelled, so a
    // loop ending over a rib would finish by selecting that rib.
    suppressNextClick();
    expect(shouldSuppressClick()).toBe(true);
    expect(shouldSuppressClick()).toBe(false);
  });

  it("does not swallow a click when no loop was drawn", () => {
    expect(shouldSuppressClick()).toBe(false);
  });
});
