import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  AXIAL_PLANE,
  cameraForwardOf,
  cameraUpOf,
  cutPlanes,
  depthLabel,
  forgetSlice,
  formatDistance,
  FRONT_PLANE,
  measureCm,
  MIN_SECTION_HALF_M,
  onLevel,
  paintSlice,
  panWindow,
  planePoint,
  pointInSection,
  pointOnScreen,
  restoreSlice,
  sectionFileName,
  SLAB_HALF_THICKNESS,
  slabPlanes,
  sliceBasis,
  SLICE_MIN_HALF,
  SLICE_PIXELS_HIGH,
  SLICE_PIXELS_NORMAL,
  sliceSize,
  SLICE_UP,
  sliceWindowOf,
  torchDirection,
  wheelPixels,
  wheelSteps,
  zoomWindow,
} from "./axialSlice";

/** The male atlas's orientation: its left is +X, as `lateralSign` measures it. */
const MALE = sliceBasis(1);

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

describe("the planes", () => {
  it("puts a point where the plane says, on both", () => {
    // Axial: across is X, up the picture is Z, and the plane stands at a height.
    const axial = planePoint(AXIAL_PLANE, 0.1, 0.2, 1.3);
    expect([axial.x, axial.y, axial.z]).toEqual([0.1, 1.3, 0.2]);
    // Frontal: across is X, up the picture is Y, and the plane stands at a depth.
    const front = planePoint(FRONT_PLANE, 0.1, 1.2, 0.05);
    expect([front.x, front.y, front.z]).toEqual([0.1, 1.2, 0.05]);
  });

  it("looks down on an axial section and into the front of a frontal one", () => {
    expect(cameraForwardOf(AXIAL_PLANE).y).toBe(-1);
    expect(cameraForwardOf(FRONT_PLANE).z).toBe(-1);
  });

  it("renders the axial pass with posterior at the top of the framebuffer", () => {
    // The camera is not what changed when the orientation was fixed: it still
    // looks down with posterior at the top. The painter turns the picture.
    expect(SLICE_UP.z).toBeLessThan(0);
    expect(cameraUpOf(AXIAL_PLANE).z).toBeLessThan(0);
  });

  it("renders the frontal pass with the head at the top of the framebuffer", () => {
    expect(cameraUpOf(FRONT_PLANE).y).toBeGreaterThan(0);
  });
});

describe("the slab", () => {
  it("keeps what is inside it and nothing else", () => {
    // three keeps a fragment where `normal · p + constant > 0`. Getting the
    // sign wrong renders nothing at all, which is a mercifully loud failure —
    // but it is worth failing here instead of on screen.
    const [far, near] = slabPlanes(AXIAL_PLANE, 1.2, 0.01);
    const inside = new THREE.Vector3(0, 1.2, 0);
    const above = new THREE.Vector3(0, 1.3, 0);
    const below = new THREE.Vector3(0, 1.1, 0);

    expect(far!.distanceToPoint(inside)).toBeGreaterThan(0);
    expect(near!.distanceToPoint(inside)).toBeGreaterThan(0);
    expect(far!.distanceToPoint(above)).toBeLessThan(0);
    expect(near!.distanceToPoint(below)).toBeLessThan(0);
  });

  it("is a slab and not a plane, because a plane draws nothing", () => {
    // A surface exactly edge-on covers no pixels. What reads as a section is
    // everything between two cuts a few millimetres apart.
    expect(SLAB_HALF_THICKNESS).toBeGreaterThan(0);
    const [far, near] = slabPlanes(AXIAL_PLANE, 0, SLAB_HALF_THICKNESS);
    expect(far!.constant + near!.constant).toBeCloseTo(2 * SLAB_HALF_THICKNESS);
  });

  it("follows the plane up the body", () => {
    const low = slabPlanes(AXIAL_PLANE, 0.4, 0.01);
    const high = slabPlanes(AXIAL_PLANE, 1.4, 0.01);
    expect(high[0]!.constant - low[0]!.constant).toBeCloseTo(1);
  });

  it("cuts a frontal slab across the depth of the body", () => {
    const planes = slabPlanes(FRONT_PLANE, 0.02, 0.004);
    const kept = (z: number) =>
      planes.every((plane) => plane.distanceToPoint(new THREE.Vector3(0, 1, z)) > 0);
    expect(kept(0.02)).toBe(true);
    expect(kept(0.03)).toBe(false);
    expect(kept(0.01)).toBe(false);
  });
});

describe("the framing", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(-0.4, 0, -0.2),
    new THREE.Vector3(0.4, 1.8, 0.2),
  );

  it("takes an axial square from the wider of width and depth", () => {
    // Sized from the depth alone, an outstretched arm would be cropped off.
    const window = sliceWindowOf(bounds, AXIAL_PLANE, 1);
    expect(window.half).toBeCloseTo(0.4);
    expect(window.h).toBeCloseTo(0);
    expect(window.v).toBeCloseTo(0);
  });

  it("takes a frontal square from the wider of width and height", () => {
    // A standing body is far taller than it is wide, so the height decides.
    const window = sliceWindowOf(bounds, FRONT_PLANE, 1);
    expect(window.half).toBeCloseTo(0.9);
    expect(window.v).toBeCloseTo(0.9);
  });

  it("never frames a sliver", () => {
    const tiny = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, 0.01, 0.01));
    expect(sliceWindowOf(tiny, AXIAL_PLANE).half).toBe(SLICE_MIN_HALF);
  });

  it("puts the front of the body at the top, and the patient's left on the right", () => {
    // This once asserted that the camera's up was anterior — which enshrined
    // the bug that drew every 0.2.8 section upside down. It states the anatomy
    // itself, on both possible atlases.
    const window = { h: 0, v: 0, half: 0.2 };
    for (const leftSign of [1, -1] as const) {
      const basis = sliceBasis(leftSign);
      const front = pointOnScreen(window, 0, 0.1, 400, basis);
      const back = pointOnScreen(window, 0, -0.1, 400, basis);
      expect(front.y).toBeLessThan(back.y);

      const patientsLeft = pointOnScreen(window, leftSign * 0.1, 0, 400, basis);
      const patientsRight = pointOnScreen(window, -leftSign * 0.1, 0, 400, basis);
      expect(patientsLeft.x).toBeGreaterThan(patientsRight.x);
    }
  });

  it("puts the head at the top of a frontal picture", () => {
    // On a frontal plane `v` is height: superior must land above inferior.
    const window = { h: 0, v: 1, half: 0.5 };
    const head = pointOnScreen(window, 0, 1.4, 400, MALE);
    const feet = pointOnScreen(window, 0, 0.6, 400, MALE);
    expect(head.y).toBeLessThan(feet.y);
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

  it("puts the anterior edge at the top of an axial picture", () => {
    // The axial framebuffer's top is posterior, and WebGL hands its rows over
    // bottom first — so the red row, first in GPU order, is the anterior edge
    // and must land in row 0. This test once asserted the opposite, and every
    // section was upside down under it.
    const { canvas, read } = canvasStub();
    paintSlice(canvas, twoByTwo(), 2, MALE, AXIAL_PLANE);

    const out = read();
    expect(out).not.toBeNull();
    expect(Array.from(out!.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out!.data.slice(8, 12))).toEqual([0, 0, 255, 255]);
  });

  it("puts the head at the top of a frontal picture", () => {
    // The frontal framebuffer's top is superior, so here the rows do turn: the
    // blue row, last in GPU order, is the head and must land in row 0.
    const { canvas, read } = canvasStub();
    paintSlice(canvas, twoByTwo(), 2, MALE, FRONT_PLANE);

    const out = read()!;
    expect(Array.from(out.data.slice(0, 4))).toEqual([0, 0, 255, 255]);
    expect(Array.from(out.data.slice(8, 12))).toEqual([255, 0, 0, 255]);
  });

  it("mirrors left and right where the atlas's left is -X", () => {
    // The patient's left goes on the viewer's right. The framebuffer's +x is
    // world +X, so an atlas whose left lies at -X has to be mirrored.
    const px = new Uint8Array(2 * 1 * 4 * 2);
    // Row 0, as WebGL numbers it: green then white.
    px.set([0, 255, 0, 255], 0);
    px.set([255, 255, 255, 255], 4);
    const { canvas, read } = canvasStub();
    paintSlice(canvas, px, 2, sliceBasis(-1), AXIAL_PLANE);

    const out = read()!;
    expect(Array.from(out.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(out.data.slice(4, 8))).toEqual([0, 255, 0, 255]);
  });

  it("does nothing rather than throwing where there is no 2D context", () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => paintSlice(canvas, twoByTwo(), 2, MALE, AXIAL_PLANE)).not.toThrow();
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
    paintSlice(first.canvas, pixels, 2, MALE, AXIAL_PLANE);

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
  it("keeps everything below an axial plane and nothing above it", () => {
    // The whole difference from the slab: seen from above, what is left has
    // top surfaces, and top surfaces read as solid volumes where a thin slab
    // gives open rings.
    const [plane] = cutPlanes(AXIAL_PLANE, 1.2);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1.1, 0))).toBeGreaterThan(0);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 0.2, 0))).toBeGreaterThan(0);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1.3, 0))).toBeLessThan(0);
  });

  it("keeps everything behind a frontal plane, where the camera looks", () => {
    const [plane] = cutPlanes(FRONT_PLANE, 0.02);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1, -0.1))).toBeGreaterThan(0);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1, 0.1))).toBeLessThan(0);
  });

  it("costs one plane where the slab costs two", () => {
    expect(cutPlanes(AXIAL_PLANE, 1).length).toBe(1);
    expect(slabPlanes(AXIAL_PLANE, 1).length).toBe(2);
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

describe("torchDirection", () => {
  it("stands overhead in the middle", () => {
    const light = torchDirection(0, 0, MALE, AXIAL_PLANE);
    expect(light.y).toBeCloseTo(1, 12);
  });

  it("comes from the side the pointer is on, not the other one", () => {
    // The half of this that has to be right: a light that receded as the
    // cursor approached would read as broken without ever being nameable.
    expect(torchDirection(1, 0, MALE, AXIAL_PLANE).x).toBeGreaterThan(0);
    expect(torchDirection(-1, 0, MALE, AXIAL_PLANE).x).toBeLessThan(0);
    // Down the picture is posterior, towards -Z; up it is anterior.
    expect(torchDirection(0, 1, MALE, AXIAL_PLANE).z).toBeLessThan(0);
    expect(torchDirection(0, -1, MALE, AXIAL_PLANE).z).toBeGreaterThan(0);
  });

  it("stands in front of a frontal section, and lowers towards the feet", () => {
    // "Overhead" is the camera's side, which for a frontal section is in front.
    expect(torchDirection(0, 0, MALE, FRONT_PLANE).z).toBeCloseTo(1, 12);
    // Down the picture is inferior.
    expect(torchDirection(0, 1, MALE, FRONT_PLANE).y).toBeLessThan(0);
    expect(torchDirection(1, 0, MALE, FRONT_PLANE).x).toBeGreaterThan(0);
  });

  it("lowers the light as the pointer leaves the middle", () => {
    const near = torchDirection(0.3, 0, MALE, AXIAL_PLANE);
    const far = torchDirection(1, 0, MALE, AXIAL_PLANE);
    expect(far.y).toBeLessThan(near.y);
    expect(near.y).toBeLessThan(1);
  });

  it("never lies flat in the plane, however far out the pointer goes", () => {
    // A light exactly level with the section lights the walls facing it and
    // nothing else: the reader sees a picture that has gone out.
    const corner = torchDirection(3, 3, MALE, AXIAL_PLANE);
    expect(corner.y).toBeGreaterThan(0.1);
    expect(corner.length()).toBeCloseTo(1, 12);
  });
});

describe("sliceSize", () => {
  it("gives the reader the size they asked for", () => {
    expect(sliceSize(false, 16384)).toBe(SLICE_PIXELS_NORMAL);
    expect(sliceSize(true, 16384)).toBe(SLICE_PIXELS_HIGH);
  });

  it("never asks a card for more than it has", () => {
    // WebGL2 only guarantees 2048. An over-sized target does not fail politely
    // — the framebuffer comes back incomplete and the picture comes back black.
    expect(sliceSize(true, 2048)).toBe(2048);
    expect(sliceSize(true, 4096)).toBe(SLICE_PIXELS_HIGH);
  });

  it("falls back rather than trusting a renderer that reports nothing", () => {
    expect(sliceSize(true, 0)).toBe(SLICE_PIXELS_NORMAL);
  });
});

/** A 108 cm frame centred on the origin, as the chest gives. */
const BASE = { h: 0, v: 0, half: 0.54 };

describe("zoomWindow", () => {
  it("halves the width for twice the magnification", () => {
    const shown = zoomWindow(BASE, BASE, 2, MALE);
    expect(shown?.half).toBeCloseTo(0.27, 12);
    expect(shown?.h).toBeCloseTo(0, 12);
  });

  it("goes back to automatic when the reader zooms all the way out", () => {
    // Null rather than a window that happens to be body-wide: the automatic
    // frame follows the level, and zoomed out is a request to keep doing that.
    expect(zoomWindow(BASE, BASE, 1, MALE)).toBeNull();
    expect(zoomWindow({ h: 0, v: 0, half: 0.27 }, BASE, 0.5, MALE)).toBeNull();
  });

  it("keeps what is under the pointer under the pointer", () => {
    // The whole reason zooming is anchored: a reader magnifying the aorta must
    // still be looking at the aorta afterwards.
    const frame = { h: 0, v: 0, half: 0.4 };
    const u = 0.5;
    const anchor = frame.h + u * frame.half;
    const shown = zoomWindow(frame, BASE, 2, MALE, u, 0);
    expect(shown!.h + u * shown!.half).toBeCloseTo(anchor, 12);
  });

  it("stops where there is nothing left to magnify", () => {
    expect(zoomWindow(BASE, BASE, 500, MALE)!.half).toBe(MIN_SECTION_HALF_M);
  });

  it("keeps the window inside the section", () => {
    // Anchored hard against one edge, the window still may not leave the body.
    const shown = zoomWindow(BASE, BASE, 2, MALE, 1, 1)!;
    expect(Math.abs(shown.h)).toBeLessThanOrEqual(BASE.half - shown.half + 1e-12);
    expect(Math.abs(shown.v)).toBeLessThanOrEqual(BASE.half - shown.half + 1e-12);
  });
});

describe("panWindow", () => {
  it("travels the opposite way to the hand", () => {
    // Dragging the picture to the right shows what was off to the left.
    const frame = { h: 0, v: 0, half: 0.27 };
    expect(panWindow(frame, BASE, 100, 0, 900, MALE)!.h).toBeLessThan(0);
  });

  it("moves by the distance the drag actually covered", () => {
    // A 54 cm window drawn 900 pixels wide: a quarter of the picture is 13.5 cm.
    const frame = { h: 0, v: 0, half: 0.27 };
    expect(panWindow(frame, BASE, 225, 0, 900, MALE)!.h).toBeCloseTo(-0.135, 12);
  });

  it("brings the top of the picture into view when it is dragged down", () => {
    // Dragging down shows what was above: anterior on an axial picture, the
    // head on a frontal one — the positive end of the plane's vertical either way.
    const frame = { h: 0, v: 0, half: 0.27 };
    expect(panWindow(frame, BASE, 0, 100, 900, MALE)!.v).toBeGreaterThan(0);
  });

  it("does not change the width", () => {
    const frame = { h: 0, v: 0, half: 0.27 };
    expect(panWindow(frame, BASE, 40, -80, 900, MALE)!.half).toBe(0.27);
  });

  it("stops at the edge rather than drifting into the black", () => {
    const frame = { h: 0, v: 0, half: 0.27 };
    const shown = panWindow(frame, BASE, 99999, 0, 900, MALE)!;
    expect(shown.h).toBeCloseTo(-(BASE.half - frame.half), 12);
  });
});

describe("the caliper", () => {
  const WINDOW = { h: 0.1, v: -0.2, half: 0.27 };

  it("puts the middle of the picture at the middle of the window", () => {
    const at = pointInSection(WINDOW, 450, 450, 900, MALE);
    expect(at.h).toBeCloseTo(WINDOW.h, 12);
    expect(at.v).toBeCloseTo(WINDOW.v, 12);
  });

  it("puts the corners where the window ends", () => {
    const at = pointInSection(WINDOW, 0, 900, 900, MALE);
    expect(at.h).toBeCloseTo(WINDOW.h - WINDOW.half, 12);
    // The bottom of the picture is the negative end of the plane's vertical.
    expect(at.v).toBeCloseTo(WINDOW.v - WINDOW.half, 12);
  });

  it("comes back to the same pixel it came from", () => {
    // The round trip is what keeps a line drawn at one magnification lying on
    // the same anatomy at the next one.
    const at = pointInSection(WINDOW, 137, 612, 900, MALE);
    const back = pointOnScreen(WINDOW, at.h, at.v, 900, MALE);
    expect(back.x).toBeCloseTo(137, 9);
    expect(back.y).toBeCloseTo(612, 9);
  });

  it("measures across the window, not across the screen", () => {
    // A 54 cm window drawn 900 pixels wide: half the picture is 27 cm.
    const a = pointInSection(WINDOW, 225, 450, 900, MALE);
    const b = pointInSection(WINDOW, 675, 450, 900, MALE);
    expect(measureCm({ ah: a.h, av: a.v, bh: b.h, bv: b.v })).toBeCloseTo(27, 9);
  });

  it("survives the picture being magnified under it", () => {
    // The point of holding the ends in metres. A line drawn across the whole
    // body, then read through a window a fifth as wide: it has to land on the
    // same anatomy and report the same length, or a measurement is worth
    // nothing the moment somebody looks closer.
    const whole = { h: 0, v: 0, half: 0.27 };
    const a = pointInSection(whole, 400, 430, 900, MALE);
    const b = pointInSection(whole, 470, 500, 900, MALE);
    const line = { ah: a.h, av: a.v, bh: b.h, bv: b.v };

    const close = { h: a.h, v: a.v, half: 0.054 };
    const onScreen = pointOnScreen(close, line.ah, line.av, 900, MALE);
    // The near end is the centre of the magnified window, so it draws there.
    expect(onScreen.x).toBeCloseTo(450, 9);
    expect(onScreen.y).toBeCloseTo(450, 9);
    // And the length is a property of the body, not of the window.
    expect(measureCm(line)).toBeCloseTo(Math.hypot(0.042, 0.042) * 100, 9);
  });

  it("says millimetres below a centimetre and never a third decimal", () => {
    expect(formatDistance(0.72)).toBe("7 mm");
    expect(formatDistance(3.44)).toBe("3.4 cm");
    expect(formatDistance(12.06)).toBe("12.1 cm");
    expect(formatDistance(0)).toBe("");
  });
});

describe("sectionFileName", () => {
  it("names the file after what the picture is", () => {
    expect(sectionFileName("axial", "T8", 13, true)).toBe("anatria3d-axial-T8-13cm-cut.png");
    expect(sectionFileName("axial", "T8", 108, false)).toBe(
      "anatria3d-axial-T8-108cm-slab.png",
    );
  });

  it("names a frontal one after its depth", () => {
    expect(sectionFileName("front", depthLabel(0.12), 60, true)).toBe(
      "anatria3d-front-12-cm-deep-60cm-cut.png",
    );
  });

  it("keeps a disc level readable without its en dash", () => {
    // A file name is not the place to find out how a file system feels about
    // punctuation the interface uses freely.
    expect(sectionFileName("axial", "L4–L5", 9, false)).toBe(
      "anatria3d-axial-L4-L5-9cm-slab.png",
    );
  });

  it("says nothing about a level where there is none", () => {
    expect(sectionFileName("axial", null, 40, true)).toBe("anatria3d-axial-40cm-cut.png");
  });

  it("leaves the width out rather than writing a nonsense one", () => {
    // Before the first section has been taken there is no width to report.
    expect(sectionFileName("axial", "T8", -1, true)).toBe("anatria3d-axial-T8-cut.png");
  });
});

describe("wheelPixels", () => {
  it("leaves pixels alone, which is what WebView2 sends", () => {
    expect(wheelPixels(100, 0)).toBe(100);
    expect(wheelPixels(-37.5, 0)).toBe(-37.5);
  });

  it("turns a notch reported in lines into one step", () => {
    // Three lines is a notch. Compared as if it were three pixels, it would
    // take thirty-four notches to move a centimetre.
    expect(wheelSteps(0, wheelPixels(3, 1))).toEqual({ steps: 1, carry: 0 });
    expect(wheelSteps(0, wheelPixels(-3, 1))).toEqual({ steps: -1, carry: 0 });
  });

  it("does the same for a page", () => {
    expect(wheelPixels(1, 2)).toBe(100);
  });

  it("does nothing with an event that did not move", () => {
    expect(wheelPixels(0, 1)).toBe(0);
  });
});

describe("onLevel", () => {
  const line = { at: 1.2, plane: "axial" as const };

  it("shows a measurement on the level it was drawn on", () => {
    expect(onLevel(line, 1.2, "axial")).toBe(true);
  });

  it("hides it one step away, above or below", () => {
    // Carried to the next level it would sit over different anatomy and
    // measure nothing — the first caliper's mistake.
    expect(onLevel(line, 1.21, "axial")).toBe(false);
    expect(onLevel(line, 1.19, "axial")).toBe(false);
  });

  it("finds it again after stepping away and back", () => {
    // Coming back is the sum of a run of fractions of the travel, and lands a
    // hair's breadth from where it left.
    expect(onLevel(line, 1.2 + 3e-9, "axial")).toBe(true);
  });

  it("never shows a line from one plane on the other", () => {
    // A depth and a height can be the same number and mean nothing alike.
    expect(onLevel(line, 1.2, "front")).toBe(false);
  });
});

describe("depthLabel", () => {
  it("says how far in from the front, in whole centimetres", () => {
    expect(depthLabel(0.123)).toBe("12 cm deep");
  });

  it("never says a negative depth", () => {
    // The plane at the very front of the body is at no depth, not at minus one.
    expect(depthLabel(-0.004)).toBe("0 cm deep");
  });
});
