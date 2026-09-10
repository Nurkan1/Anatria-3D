import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  cutPlanes,
  forgetSlice,
  paintSlice,
  pastNativeSize,
  wheelSteps,
  restoreSlice,
  SLAB_HALF_THICKNESS,
  SLICE_UP,
  sliceFraming,
  slabPlanes,
} from "./axialSlice";

/**
 * Enough of a 2D context for the painter: the flip, and the mark drawn over it.
 *
 * `getImageData` hands back whatever was last put, which is what the real one
 * would do and what lets the "keep the last section" test mean something.
 */
function canvasStub() {
  let written: ImageData | null = null;
  const context = {
    fillStyle: "",
    font: "",
    textBaseline: "",
    textAlign: "",
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: (image: ImageData) => {
      written = image;
    },
    getImageData: () => written,
    fillRect: () => {},
    fillText: () => {},
  };
  return {
    canvas: { getContext: () => context } as unknown as HTMLCanvasElement,
    read: () => written,
  };
}

describe("the slab", () => {
  it("keeps what is inside it and nothing else", () => {
    // three keeps a fragment where `normal · p + constant > 0`. Getting the
    // sign wrong renders nothing at all, which is a mercifully loud failure —
    // but it is worth failing here instead of on screen.
    const [top, bottom] = slabPlanes(1.2, 0.01);
    const inside = new THREE.Vector3(0, 1.2, 0);
    const above = new THREE.Vector3(0, 1.3, 0);
    const below = new THREE.Vector3(0, 1.1, 0);

    expect(top!.distanceToPoint(inside)).toBeGreaterThan(0);
    expect(bottom!.distanceToPoint(inside)).toBeGreaterThan(0);
    expect(top!.distanceToPoint(above)).toBeLessThan(0);
    expect(bottom!.distanceToPoint(below)).toBeLessThan(0);
  });

  it("is a slab and not a plane, because a plane draws nothing", () => {
    // A surface exactly edge-on covers no pixels. What reads as a section is
    // everything between two cuts a few millimetres apart.
    expect(SLAB_HALF_THICKNESS).toBeGreaterThan(0);
    const [top, bottom] = slabPlanes(0, SLAB_HALF_THICKNESS);
    expect(top!.constant + bottom!.constant).toBeCloseTo(2 * SLAB_HALF_THICKNESS);
  });

  it("follows the plane up the body", () => {
    const low = slabPlanes(0.4, 0.01);
    const high = slabPlanes(1.4, 0.01);
    expect(high[0]!.constant - low[0]!.constant).toBeCloseTo(1);
  });
});

describe("the framing", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(-0.4, 0, -0.2),
    new THREE.Vector3(0.4, 1.8, 0.2),
  );

  it("looks straight down at the height being cut", () => {
    const framing = sliceFraming(bounds, 1.2);
    expect(framing.target.y).toBeCloseTo(1.2);
    expect(framing.position.y).toBeGreaterThan(framing.target.y);
    expect(framing.position.x).toBeCloseTo(framing.target.x);
    expect(framing.position.z).toBeCloseTo(framing.target.z);
  });

  it("frames the same square at every height", () => {
    // A slice that rescaled itself as the plane travelled would be unreadable
    // as a sequence: the reader could not tell a growing structure from a
    // shrinking frame.
    const ankle = sliceFraming(bounds, 0.1);
    const chest = sliceFraming(bounds, 1.3);
    expect(ankle.halfWidth).toBeCloseTo(chest.halfWidth);
    expect(ankle.halfWidth).toBeCloseTo(ankle.halfDepth);
  });

  it("takes its square from the wider of the two extents", () => {
    // Sized from the depth alone, an outstretched arm would be cropped off.
    const framing = sliceFraming(bounds, 1, 1);
    expect(framing.halfWidth).toBeCloseTo(0.4);
  });

  it("puts the front of the body at the top of the image", () => {
    // Anterior-up is the convention every axial image a reader has seen uses,
    // and −Z is anterior on this atlas — the same fact the anterior viewpoint
    // relies on.
    expect(SLICE_UP.z).toBeLessThan(0);
    expect(SLICE_UP.y).toBe(0);
  });
});

describe("painting what came back from the GPU", () => {
  /** A 2x2 image whose rows differ, so an unflipped copy cannot pass. */
  function twoByTwo(): Uint8Array {
    const px = new Uint8Array(2 * 2 * 4);
    // Bottom row as WebGL numbers them: red, red.
    px.set([255, 0, 0, 255], 0);
    px.set([255, 0, 0, 255], 4);
    // Top row: blue, blue.
    px.set([0, 0, 255, 255], 8);
    px.set([0, 0, 255, 255], 12);
    return px;
  }

  it("turns the picture the right way up", () => {
    // WebGL numbers rows from the bottom and a canvas from the top. A straight
    // copy is a body lying the wrong way round — and on an axial slice that is
    // a *silent* error, because anterior and posterior both look plausible.
    const { canvas, read } = canvasStub();
    paintSlice(canvas, twoByTwo(), 2);

    const out = read();
    expect(out).not.toBeNull();
    // The blue row was the top in GPU order, so it must land in row 0.
    expect(Array.from(out!.data.slice(0, 4))).toEqual([0, 0, 255, 255]);
    expect(Array.from(out!.data.slice(8, 12))).toEqual([255, 0, 0, 255]);
  });

  it("does nothing rather than throwing where there is no 2D context", () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => paintSlice(canvas, twoByTwo(), 2)).not.toThrow();
  });
});

describe("keeping the last section", () => {
  it("puts the last one back on a canvas that has just appeared", () => {
    // Enlarging the panel mounts a different element. A section that blanked
    // at the moment somebody asked to see it properly would be answering the
    // wrong question.
    forgetSlice();
    const first = canvasStub();
    const pixels = new Uint8Array(2 * 2 * 4).fill(200);
    paintSlice(first.canvas, pixels, 2);

    const enlarged = canvasStub();
    restoreSlice(enlarged.canvas);
    expect(enlarged.read()).not.toBeNull();
    expect(enlarged.read()).toBe(first.read());
  });

  it("does nothing when there is nothing to remember", () => {
    forgetSlice();
    const fresh = canvasStub();
    restoreSlice(fresh.canvas);
    expect(fresh.read()).toBeNull();
  });
});

describe("the dissection cut", () => {
  it("keeps everything below the plane and nothing above it", () => {
    // The whole difference from the slab: seen from above, what is left has
    // top surfaces, and top surfaces read as solid volumes where a thin slab
    // gives open rings.
    const [plane] = cutPlanes(1.2);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1.1, 0))).toBeGreaterThan(0);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 0.2, 0))).toBeGreaterThan(0);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1.3, 0))).toBeLessThan(0);
  });

  it("costs one plane where the slab costs two", () => {
    expect(cutPlanes(1).length).toBe(1);
    expect(slabPlanes(1).length).toBe(2);
  });
});

describe("pastNativeSize", () => {
  it("smooths while the source still has pixels to spare", () => {
    // 2048 pixels of section drawn into a 586-pixel window: even at three
    // times, the browser is still shrinking the picture.
    expect(pastNativeSize(1, 586, 2048)).toBe(false);
    expect(pastNativeSize(3, 586, 2048)).toBe(false);
  });

  it("gives up at the point the source runs out", () => {
    // 586 * 3.5 is 2051, which is the first magnification past 2048.
    expect(pastNativeSize(3.5, 586, 2048)).toBe(true);
    expect(pastNativeSize(6, 586, 2048)).toBe(true);
  });

  it("moves with the window rather than assuming one", () => {
    // The same magnification, a smaller window: still inside the source.
    expect(pastNativeSize(3.5, 400, 2048)).toBe(false);
  });

  it("smooths when the window has not been measured yet", () => {
    // First paint, before the observer has reported: a section that flashed
    // blocky and then resolved would read as a rendering fault.
    expect(pastNativeSize(4, 0, 2048)).toBe(false);
  });
});

describe("wheelSteps", () => {
  it("turns one notch of a mouse wheel into exactly one step", () => {
    expect(wheelSteps(0, 100)).toEqual({ steps: 1, carry: 0 });
    expect(wheelSteps(0, -100)).toEqual({ steps: -1, carry: 0 });
  });

  it("saves up a trackpad rather than flying through the body", () => {
    // Three small pushes that together are one notch.
    let carry = 0;
    let total = 0;
    for (const delta of [40, 40, 40]) {
      const moved = wheelSteps(carry, delta);
      carry = moved.carry;
      total += moved.steps;
    }
    expect(total).toBe(1);
    expect(carry).toBe(20);
  });

  it("throws the carry away when the reader changes their mind", () => {
    // Eighty units towards the head, then a notch back: the plane must move
    // back immediately rather than spending the leftover intent first.
    const back = wheelSteps(80, -100);
    expect(back.steps).toBe(-1);
    expect(back.carry).toBe(0);
  });

  it("keeps counting in the same direction across events", () => {
    expect(wheelSteps(80, 100)).toEqual({ steps: 1, carry: 80 });
  });
});
