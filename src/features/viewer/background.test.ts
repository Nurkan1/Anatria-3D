import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BACKGROUNDS, backgroundTheme } from "./background";
import { SYSTEM_COLOURS } from "./palette";

const lightnessOf = (hex: string) => {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  return hsl.l;
};

describe("backgroundTheme", () => {
  it("offers a dark setting and a light one", () => {
    expect(lightnessOf(BACKGROUNDS.dark.canvas)).toBeLessThan(0.2);
    expect(lightnessOf(BACKGROUNDS.light.canvas)).toBeGreaterThan(0.7);
  });

  it("keeps the light setting off white", () => {
    // Pure white puts the brightest pixel in the image behind the subject
    // rather than on it, and leaves nothing for a highlight to be brighter
    // than.
    expect(lightnessOf(BACKGROUNDS.light.canvas)).toBeLessThan(0.85);
  });

  it("separates from bone by temperature rather than by lightness", () => {
    // Bone is warm ivory and sits close to the background in brightness. What
    // keeps it legible is that the two are opposite in temperature — warm
    // subject on cool ground, which is how a printed plate does it. Matching
    // the background's hue to the bone's would lose the skeleton whatever the
    // lightness.
    const ground = new THREE.Color(BACKGROUNDS.light.canvas);
    const bone = new THREE.Color(SYSTEM_COLOURS.skeletal);

    expect(ground.b - ground.r).toBeGreaterThan(0.02);
    expect(bone.r - bone.b).toBeGreaterThan(0.02);
  });

  it("gives the light setting a blue cast rather than a neutral grey", () => {
    const colour = new THREE.Color(BACKGROUNDS.light.canvas);
    expect(colour.b).toBeGreaterThan(colour.r);
    expect(colour.b).toBeGreaterThan(colour.g);
  });

  it("lifts the ambient on the light setting", () => {
    // A model lit for a dark room reads as murky against paper: the eye adapts
    // to the brightest thing on screen and the shadows look like dirt.
    expect(BACKGROUNDS.light.ambient).toBeGreaterThan(BACKGROUNDS.dark.ambient);
  });

  it("gives each setting label ink that its background can carry", () => {
    expect(lightnessOf(BACKGROUNDS.dark.ink)).toBeGreaterThan(
      lightnessOf(BACKGROUNDS.dark.canvas),
    );
    expect(lightnessOf(BACKGROUNDS.light.ink)).toBeLessThan(
      lightnessOf(BACKGROUNDS.light.canvas),
    );
  });

  it("falls back to the dark setting for a mode it does not know", () => {
    // A preferences file from a build that had a third one must not leave the
    // viewport with no clear colour at all.
    expect(backgroundTheme("sepia" as never)).toBe(BACKGROUNDS.dark);
  });
});
