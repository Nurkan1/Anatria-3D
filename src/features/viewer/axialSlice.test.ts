import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  cutPlanes,
  forgetSlice,
  paintSlice,
  formatDistance,
  measureCm,
  MIN_SECTION_HALF_M,
  panWindow,
  pointInSection,
  pointOnScreen,
  sectionFileName,
  SLICE_PIXELS_HIGH,
  SLICE_PIXELS_NORMAL,
  sliceSize,
  torchDirection,
  wheelPixels,
  wheelSteps,
  zoomWindow,
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
    const light = torchDirection(0, 0);
    expect(light.y).toBeCloseTo(1, 12);
  });

  it("comes from the side the pointer is on, not the other one", () => {
    // The half of this that has to be right: a light that receded as the
    // cursor approached would read as broken without ever being nameable.
    expect(torchDirection(1, 0).x).toBeGreaterThan(0);
    expect(torchDirection(-1, 0).x).toBeLessThan(0);
    // Screen coordinates run downwards, and so does world +z here.
    expect(torchDirection(0, 1).z).toBeGreaterThan(0);
    expect(torchDirection(0, -1).z).toBeLessThan(0);
  });

  it("lowers the light as the pointer leaves the middle", () => {
    const near = torchDirection(0.3, 0);
    const far = torchDirection(1, 0);
    expect(far.y).toBeLessThan(near.y);
    expect(near.y).toBeLessThan(1);
  });

  it("never lies flat in the plane, however far out the pointer goes", () => {
    // A light exactly level with the section lights the walls facing it and
    // nothing else: the reader sees a picture that has gone out.
    const corner = torchDirection(3, 3);
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
const BASE = { x: 0, z: 0, half: 0.54 };

describe("zoomWindow", () => {
  it("halves the width for twice the magnification", () => {
    const shown = zoomWindow(BASE, BASE, 2);
    expect(shown?.half).toBeCloseTo(0.27, 12);
    expect(shown?.x).toBeCloseTo(0, 12);
  });

  it("goes back to automatic when the reader zooms all the way out", () => {
    // Null rather than a window that happens to be body-wide: the automatic
    // frame follows the level, and zoomed out is a request to keep doing that.
    expect(zoomWindow(BASE, BASE, 1)).toBeNull();
    expect(zoomWindow({ x: 0, z: 0, half: 0.27 }, BASE, 0.5)).toBeNull();
  });

  it("keeps what is under the pointer under the pointer", () => {
    // The whole reason zooming is anchored: a reader magnifying the aorta must
    // still be looking at the aorta afterwards.
    const frame = { x: 0, z: 0, half: 0.4 };
    const u = 0.5;
    const anchor = frame.x + u * frame.half;
    const shown = zoomWindow(frame, BASE, 2, u, 0);
    expect(shown!.x + u * shown!.half).toBeCloseTo(anchor, 12);
  });

  it("stops where there is nothing left to magnify", () => {
    expect(zoomWindow(BASE, BASE, 500)!.half).toBe(MIN_SECTION_HALF_M);
  });

  it("keeps the window inside the section", () => {
    // Anchored hard against one edge, the window still may not leave the body.
    const shown = zoomWindow(BASE, BASE, 2, 1, 1)!;
    expect(Math.abs(shown.x)).toBeLessThanOrEqual(BASE.half - shown.half + 1e-12);
    expect(Math.abs(shown.z)).toBeLessThanOrEqual(BASE.half - shown.half + 1e-12);
  });
});

describe("panWindow", () => {
  it("travels the opposite way to the hand", () => {
    // Dragging the picture to the right shows what was off to the left.
    const frame = { x: 0, z: 0, half: 0.27 };
    expect(panWindow(frame, BASE, 100, 0, 900)!.x).toBeLessThan(0);
  });

  it("moves by the distance the drag actually covered", () => {
    // A 54 cm window drawn 900 pixels wide: a quarter of the picture is 13.5 cm.
    const frame = { x: 0, z: 0, half: 0.27 };
    expect(panWindow(frame, BASE, 225, 0, 900)!.x).toBeCloseTo(-0.135, 12);
  });

  it("does not change the width", () => {
    const frame = { x: 0, z: 0, half: 0.27 };
    expect(panWindow(frame, BASE, 40, -80, 900)!.half).toBe(0.27);
  });

  it("stops at the edge rather than drifting into the black", () => {
    const frame = { x: 0, z: 0, half: 0.27 };
    const shown = panWindow(frame, BASE, 99999, 0, 900)!;
    expect(shown.x).toBeCloseTo(-(BASE.half - frame.half), 12);
  });
});

describe("the caliper", () => {
  const WINDOW = { x: 0.1, z: -0.2, half: 0.27 };

  it("puts the middle of the picture at the middle of the window", () => {
    const at = pointInSection(WINDOW, 450, 450, 900);
    expect(at.x).toBeCloseTo(WINDOW.x, 12);
    expect(at.z).toBeCloseTo(WINDOW.z, 12);
  });

  it("puts the corners where the window ends", () => {
    const at = pointInSection(WINDOW, 0, 900, 900);
    expect(at.x).toBeCloseTo(WINDOW.x - WINDOW.half, 12);
    // Canvas rows run downwards and so does world +z.
    expect(at.z).toBeCloseTo(WINDOW.z + WINDOW.half, 12);
  });

  it("comes back to the same pixel it came from", () => {
    // The round trip is what keeps a line drawn at one magnification lying on
    // the same anatomy at the next one.
    const back = pointOnScreen(WINDOW, ...(() => {
      const at = pointInSection(WINDOW, 137, 612, 900);
      return [at.x, at.z] as const;
    })(), 900);
    expect(back.x).toBeCloseTo(137, 9);
    expect(back.y).toBeCloseTo(612, 9);
  });

  it("measures across the window, not across the screen", () => {
    // A 54 cm window drawn 900 pixels wide: half the picture is 27 cm.
    const a = pointInSection(WINDOW, 225, 450, 900);
    const b = pointInSection(WINDOW, 675, 450, 900);
    expect(measureCm({ ax: a.x, az: a.z, bx: b.x, bz: b.z })).toBeCloseTo(27, 9);
  });

  it("survives the picture being magnified under it", () => {
    // The point of holding the ends in metres. A line drawn across the whole
    // body, then read through a window a fifth as wide: it has to land on the
    // same anatomy and report the same length, or a measurement is worth
    // nothing the moment somebody looks closer.
    const whole = { x: 0, z: 0, half: 0.27 };
    const a = pointInSection(whole, 400, 430, 900);
    const b = pointInSection(whole, 470, 500, 900);
    const line = { ax: a.x, az: a.z, bx: b.x, bz: b.z };

    const close = { x: a.x, z: a.z, half: 0.054 };
    const onScreen = pointOnScreen(close, line.ax, line.az, 900);
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
    expect(sectionFileName("T8", 13, true)).toBe("anatria3d-axial-T8-13cm-cut.png");
    expect(sectionFileName("T8", 108, false)).toBe("anatria3d-axial-T8-108cm-slab.png");
  });

  it("keeps a disc level readable without its en dash", () => {
    // A file name is not the place to find out how a file system feels about
    // punctuation the interface uses freely.
    expect(sectionFileName("L4–L5", 9, false)).toBe("anatria3d-axial-L4-L5-9cm-slab.png");
  });

  it("says nothing about a level where there is none", () => {
    expect(sectionFileName(null, 40, true)).toBe("anatria3d-axial-40cm-cut.png");
  });

  it("leaves the width out rather than writing a nonsense one", () => {
    // Before the first section has been taken there is no width to report.
    expect(sectionFileName("T8", -1, true)).toBe("anatria3d-axial-T8-cut.png");
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
