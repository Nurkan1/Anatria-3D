import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { paintSlice } from "./axialSlice";
import {
  frontalCutPlanes,
  frontalDepths,
  frontalPaintFlags,
  frontalSlabPlanes,
} from "./frontalSlice";

describe("frontalDepths", () => {
  it("measures front, middle and back, in that order", () => {
    // Anterior is +Z: the first depth is the one nearest the front.
    const [front, middle, back] = frontalDepths(-0.15, 0.15);
    expect(front).toBeCloseTo(0.05, 12);
    expect(middle).toBeCloseTo(0, 12);
    expect(back).toBeCloseTo(-0.05, 12);
  });

  it("measures nothing in a body with no depth", () => {
    expect(frontalDepths(0, 0)).toEqual([]);
  });
});

describe("the frontal cuts", () => {
  it("keeps only the slab around the plane", () => {
    const planes = frontalSlabPlanes(0.02, 0.004);
    const kept = (z: number) =>
      planes.every((plane) => plane.distanceToPoint(new THREE.Vector3(0, 1, z)) > 0);
    expect(kept(0.02)).toBe(true);
    expect(kept(0.03)).toBe(false);
    expect(kept(0.01)).toBe(false);
  });

  it("opens the body and keeps what lies behind the plane", () => {
    // The camera stands in front, so what it must see is posterior to the plane.
    const [plane] = frontalCutPlanes(0.02);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1, -0.1))).toBeGreaterThan(0);
    expect(plane!.distanceToPoint(new THREE.Vector3(0, 1, 0.1))).toBeLessThan(0);
  });
});

describe("painting a frontal picture", () => {
  /** Enough 2D context for the painter. */
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
      canvas: { getContext: () => context, width: 0, height: 0 } as unknown as HTMLCanvasElement,
      read: () => written,
    };
  }

  it("puts the head at the top", () => {
    // This camera's framebuffer has superior at its top, and WebGL hands the rows
    // over bottom first: the first row is the inferior edge. It must end up at the
    // bottom of the picture.
    const px = new Uint8Array(2 * 2 * 4);
    px.set([255, 0, 0, 255], 0); // inferior, as WebGL numbers it
    px.set([255, 0, 0, 255], 4);
    px.set([0, 0, 255, 255], 8); // superior
    px.set([0, 0, 255, 255], 12);
    const { canvas, read } = canvasStub();
    paintSlice(canvas, px, 2, frontalPaintFlags(1));

    const out = read()!;
    expect(Array.from(out.data.slice(0, 4))).toEqual([0, 0, 255, 255]);
    expect(Array.from(out.data.slice(8, 12))).toEqual([255, 0, 0, 255]);
  });

  it("puts the patient's left on the right, on either atlas", () => {
    // The camera's +x is world +X, which is the patient's left only where
    // lateralSign says so; elsewhere the picture is mirrored.
    expect(frontalPaintFlags(1).right).toBe(1);
    expect(frontalPaintFlags(-1).right).toBe(-1);
  });
});
