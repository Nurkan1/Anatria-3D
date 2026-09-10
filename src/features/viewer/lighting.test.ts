import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  aimStudioAt,
  rakingKey,
  SECTION_AMBIENT,
  STUDIO_AMBIENT,
  STUDIO_FILL,
  STUDIO_KEY,
  STUDIO_RIM,
  studioLightDirections,
} from "./lighting";

const UP = new THREE.Vector3(0, 1, 0);
/** Looking down -Z, the default camera direction. */
const AHEAD = new THREE.Vector3(0, 0, -1);

describe("studioLightDirections", () => {
  it("returns three unit directions", () => {
    const rig = studioLightDirections(AHEAD, UP);
    for (const [name, direction] of Object.entries(rig)) {
      expect(direction.length(), name).toBeCloseTo(1);
    }
  });

  it("puts the key on the viewer's side and the rim behind the model", () => {
    // The point of the rig: whatever the camera faces is lit, and the far side
    // gets an edge rather than nothing.
    const rig = studioLightDirections(AHEAD, UP);
    expect(rig.key.dot(AHEAD)).toBeLessThan(0);
    expect(rig.rim.dot(AHEAD)).toBeGreaterThan(0);
  });

  it("puts the fill opposite the key rather than beside it", () => {
    const rig = studioLightDirections(AHEAD, UP);
    // Two lights from the same side would be one brighter light.
    expect(rig.key.dot(rig.fill)).toBeLessThan(0.5);
  });

  it("lifts the key above the camera so surfaces still turn away from it", () => {
    // A light exactly at the eye lights everything head-on and erases the
    // shading that carries form.
    const rig = studioLightDirections(AHEAD, UP);
    expect(rig.key.dot(UP)).toBeGreaterThan(0.3);
  });

  it("follows the camera round the model", () => {
    // The whole reason for the rig: orbiting to the back used to arrive at the
    // shaded side of everything.
    const front = studioLightDirections(AHEAD, UP);
    const behind = studioLightDirections(new THREE.Vector3(0, 0, 1), UP);

    expect(front.key.dot(behind.key)).toBeLessThan(0);
    // …and the key stays on the viewer's side from both.
    expect(behind.key.z).toBeLessThan(0);
    expect(front.key.z).toBeGreaterThan(0);
  });

  it("survives a camera looking straight along its own up axis", () => {
    // From directly overhead the cross product is degenerate. NaN positions
    // would black the scene out entirely.
    const rig = studioLightDirections(new THREE.Vector3(0, -1, 0), UP);
    for (const [name, direction] of Object.entries(rig)) {
      expect(Number.isFinite(direction.x + direction.y + direction.z), name).toBe(true);
      expect(direction.length(), name).toBeCloseTo(1);
    }
  });

  it("writes into the vectors it is given rather than allocating each frame", () => {
    // Called on every rendered frame.
    const reused = studioLightDirections(AHEAD, UP);
    const again = studioLightDirections(new THREE.Vector3(1, 0, 0), UP, reused);
    expect(again).toBe(reused);
    expect(again.key).toBe(reused.key);
  });

  it("accepts an unnormalised forward vector", () => {
    const long = studioLightDirections(new THREE.Vector3(0, 0, -50), UP);
    const unit = studioLightDirections(AHEAD, UP);
    expect(long.key.angleTo(unit.key)).toBeCloseTo(0);
  });
});

/** A scene with the rig in it, named the way `StudioLights` names it. */
function riggedScene() {
  const scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight(0xffffff, 0.34);
  ambient.name = STUDIO_AMBIENT;
  const key = new THREE.DirectionalLight(0xffffff, 1.75);
  key.name = STUDIO_KEY;
  key.position.set(4.2, 4.6, 7.7);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.name = STUDIO_FILL;
  fill.position.set(-8, -2, 6);
  const rim = new THREE.DirectionalLight(0xffffff, 0.75);
  rim.name = STUDIO_RIM;
  rim.position.set(2.5, 5.5, -9);
  scene.add(ambient, key, fill, rim);
  return { scene, ambient, key, fill, rim };
}

const LOOKING_DOWN = new THREE.Vector3(0, -1, 0);
/** Anterior at the top of the picture. Same vector the section's camera uses. */
const SLICE_UP = new THREE.Vector3(0, 0, -1);

describe("aimStudioAt", () => {
  it("puts the key light above the section rather than in front of it", () => {
    const { scene, key } = riggedScene();
    // Before: a light aimed at a camera looking horizontally, so a surface
    // facing straight up catches it at a glance.
    const before = key.position.clone().normalize().y;
    aimStudioAt(scene, LOOKING_DOWN, SLICE_UP);
    const after = key.position.clone().normalize().y;
    expect(after).toBeGreaterThan(before);
    // And it is genuinely overhead, not merely better than it was.
    expect(after).toBeGreaterThan(0.7);
  });

  it("opens the walls of the cut without erasing the shading", () => {
    const { scene, ambient } = riggedScene();
    aimStudioAt(scene, LOOKING_DOWN, SLICE_UP);
    expect(ambient.intensity).toBe(SECTION_AMBIENT);
  });

  it("never dims a scene that was already brighter", () => {
    const { scene, ambient } = riggedScene();
    ambient.intensity = 0.9;
    aimStudioAt(scene, LOOKING_DOWN, SLICE_UP);
    expect(ambient.intensity).toBe(0.9);
  });

  it("gives the rig back exactly as it found it", () => {
    // The next frame belongs to the reader, and a body left lit from above
    // after one section would be a far worse bug than a dark section.
    const { scene, ambient, key, fill, rim } = riggedScene();
    const was = [key, fill, rim].map((light) => light.position.clone());
    const restore = aimStudioAt(scene, LOOKING_DOWN, SLICE_UP);
    restore();
    [key, fill, rim].forEach((light, i) => {
      expect(light.position.x).toBeCloseTo(was[i]!.x, 12);
      expect(light.position.y).toBeCloseTo(was[i]!.y, 12);
      expect(light.position.z).toBeCloseTo(was[i]!.z, 12);
    });
    expect(ambient.intensity).toBe(0.34);
  });

  it("does nothing rather than throwing when the rig is not there", () => {
    // A scene assembled differently — a test harness, a future viewport — must
    // get a dark section, not a crash in the middle of a borrowed render.
    const scene = new THREE.Scene();
    expect(() => aimStudioAt(scene, LOOKING_DOWN, SLICE_UP)()).not.toThrow();
  });
});

describe("rakingKey", () => {
  it("puts the light near the plane, where a slab's walls can catch it", () => {
    const key = rakingKey(LOOKING_DOWN, SLICE_UP);
    // Twenty degrees above the horizon: sin(20 deg) is about 0.342.
    expect(key.y).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 6);
    expect(key.length()).toBeCloseTo(1, 12);
  });

  it("keeps the studio's own side, so both pictures agree where the light is", () => {
    const overhead = studioLightDirections(LOOKING_DOWN, SLICE_UP).key;
    const raking = rakingKey(LOOKING_DOWN, SLICE_UP);
    // Same azimuth, different elevation: the horizontal parts point the same
    // way even though one light is overhead and the other is nearly level.
    const flatten = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z).normalize();
    expect(flatten(raking).dot(flatten(overhead))).toBeCloseTo(1, 6);
  });

  it("turns the fill and rim down when a light is being aimed by hand", () => {
    const { scene, fill, rim, key } = riggedScene();
    const restore = aimStudioAt(scene, LOOKING_DOWN, SLICE_UP, { support: 0.35 });
    expect(fill.intensity).toBeCloseTo(0.5 * 0.35, 12);
    expect(rim.intensity).toBeCloseTo(0.75 * 0.35, 12);
    // The one being aimed is not turned down with them.
    expect(key.intensity).toBe(1.75);
    restore();
    expect(fill.intensity).toBe(0.5);
    expect(rim.intensity).toBe(0.75);
  });

  it("stands the key where it is told to", () => {
    const { scene, key } = riggedScene();
    const aimed = new THREE.Vector3(0, 1, 0);
    aimStudioAt(scene, LOOKING_DOWN, SLICE_UP, { key: aimed });
    expect(key.position.clone().normalize().y).toBeCloseTo(1, 12);
  });
});
