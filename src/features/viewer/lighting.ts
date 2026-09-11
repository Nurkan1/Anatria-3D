import * as THREE from "three";

/**
 * A three-point rig that travels with the camera.
 *
 * # Why the lights are not fixed in the world
 *
 * They were, and it meant the back of the body was lit from the front: orbit
 * round and you arrive at the shaded side of every surface, with the key light
 * behind the model doing nothing for you. An atlas is looked at from all sides
 * by definition, so a rig anchored to the world lights half of it badly.
 *
 * Camera-relative fixes that without flattening anything. A single light *at*
 * the camera — the usual quick answer — would: with the light and the eye in
 * the same place, nothing turns away from it, every surface is lit head-on, and
 * the shading that carries form disappears. Offsetting the key up and to one
 * side, with a weaker fill opposite and a rim behind, keeps the gradients that
 * separate one muscle belly from the next.
 */

export interface StudioDirections {
  /** Where the key light sits, as a unit vector from the model. */
  key: THREE.Vector3;
  fill: THREE.Vector3;
  rim: THREE.Vector3;
}

/** Up-and-right of the camera: the classic key position. */
const KEY = { side: 0.55, up: 0.6 };
/** Opposite side and a little below, to open the shadows without erasing them. */
const FILL = { side: -0.8, up: -0.2 };
/** Behind the model, high, so silhouettes separate from what is behind them. */
const RIM = { side: 0.25, up: 0.55 };

/**
 * Positions for the three lights, given where the camera is looking.
 *
 * `forward` is the direction the camera faces; `up` is its own up vector. Both
 * are read from the camera each frame, so the rig follows an orbit exactly.
 */
export function studioLightDirections(
  forward: THREE.Vector3,
  up: THREE.Vector3,
  target?: StudioDirections,
): StudioDirections {
  const out = target ?? {
    key: new THREE.Vector3(),
    fill: new THREE.Vector3(),
    rim: new THREE.Vector3(),
  };

  const ahead = forward.clone().normalize();
  const right = new THREE.Vector3().crossVectors(ahead, up);
  if (right.lengthSq() < 1e-8) {
    // The camera is looking straight along its own up axis — from directly
    // overhead, say. Every "right" is equally valid there and the cross product
    // is degenerate, so pick one rather than emit NaN and black out the scene.
    right.set(1, 0, 0).cross(ahead);
    if (right.lengthSq() < 1e-8) right.set(0, 0, 1).cross(ahead);
  }
  right.normalize();
  const above = new THREE.Vector3().crossVectors(right, ahead).normalize();

  // `-ahead` points from the model back towards the camera, so each light
  // starts on the viewer's side and is then swung by its own offsets.
  const behindCamera = ahead.clone().negate();

  out.key
    .copy(behindCamera)
    .addScaledVector(right, KEY.side)
    .addScaledVector(above, KEY.up)
    .normalize();

  out.fill
    .copy(behindCamera)
    .addScaledVector(right, FILL.side)
    .addScaledVector(above, FILL.up)
    .normalize();

  // The only one on the far side of the model.
  out.rim
    .copy(ahead)
    .addScaledVector(right, RIM.side)
    .addScaledVector(above, RIM.up)
    .normalize();

  return out;
}

/**
 * The names the section's pass finds the rig by.
 *
 * Named rather than picked out by intensity or by index: a light identified as
 * "the bright one" stops being the bright one the first time somebody balances
 * the rig, and it fails silently by lighting the wrong thing.
 */
export const STUDIO_KEY = "studio-key";
export const STUDIO_FILL = "studio-fill";
export const STUDIO_RIM = "studio-rim";
export const STUDIO_AMBIENT = "studio-ambient";

/** Placed out past everything; a directional light only carries a direction. */
const REACH = 10;

/**
 * The least ambient a section is drawn with.
 *
 * The viewport keeps ambient low on purpose, because on anatomy the shading is
 * the information. A cut is the one view where that argument weakens: the walls
 * of the cut face sideways, nothing in the rig is aimed sideways, and shadow
 * there hides structures rather than shaping them.
 */
export const SECTION_AMBIENT = 0.45;

/**
 * Point the studio rig at another camera for one pass, and give it back.
 *
 * # Why the rig is borrowed rather than a light being added
 *
 * **Adding one would recompile every material.** The number of lights is baked
 * into the program — `NUM_DIR_LIGHTS` is a `#define` — so a light switched on
 * for the section and off afterwards is two full recompiles per picture, which
 * costs more than the picture. Moving a light that already exists changes a
 * uniform and nothing else. Same reasoning as forcing the materials opaque in
 * `AxialProbe`, and the same discipline: everything is put back.
 *
 * # Why it was dark
 *
 * The rig follows the camera, which is what stops the far side of an orbited
 * body being lit from the front. The section has a camera of its own, looking
 * straight down, and it was the one camera the rig never followed — so the
 * surfaces a reader is looking at were being lit almost edge-on by lamps aimed
 * at the front of the body.
 */
export interface SectionLighting {
  /** The least ambient the pass is drawn with. */
  ambientFloor?: number;
  /**
   * Where the key light stands instead of the studio's own position.
   *
   * A unit direction, from the model towards the light. Used both by the slab,
   * which needs a raking light rather than an overhead one, and by the torch.
   */
  key?: THREE.Vector3 | undefined;
  /**
   * How much of the fill and the rim to keep, from 0 to 1.
   *
   * Turned down when a single light is being aimed deliberately: a fill exists
   * to open shadows, which is exactly what a reader raking a light across a
   * surface is trying not to do.
   */
  support?: number;
}

export function aimStudioAt(
  scene: THREE.Object3D,
  forward: THREE.Vector3,
  up: THREE.Vector3,
  lighting: SectionLighting = {},
): () => void {
  const { ambientFloor = SECTION_AMBIENT, key: keyOverride, support = 1 } = lighting;
  const aimed = studioLightDirections(forward, up);
  const moved: {
    light: THREE.Light;
    position: THREE.Vector3;
    intensity: number;
  }[] = [];

  const place = (name: string, direction: THREE.Vector3, keep: number) => {
    const light = scene.getObjectByName(name) as THREE.Light | undefined;
    if (!light) return;
    moved.push({ light, position: light.position.clone(), intensity: light.intensity });
    light.position.copy(direction).multiplyScalar(REACH);
    light.intensity *= keep;
  };
  place(STUDIO_KEY, keyOverride ?? aimed.key, 1);
  place(STUDIO_FILL, aimed.fill, support);
  place(STUDIO_RIM, aimed.rim, support);

  const ambient = scene.getObjectByName(STUDIO_AMBIENT) as THREE.AmbientLight | undefined;
  const wasAmbient = ambient?.intensity ?? 0;
  if (ambient) ambient.intensity = Math.max(wasAmbient, ambientFloor);

  return () => {
    for (const was of moved) {
      was.light.position.copy(was.position);
      was.light.intensity = was.intensity;
    }
    if (ambient) ambient.intensity = wasAmbient;
  };
}

/**
 * How high above the horizon a raking light stands, in radians.
 *
 * # Why a slab is not lit like a cut
 *
 * They show surfaces facing opposite ways. A cut is looked at down onto the
 * tops of things, so the surfaces face the camera and an overhead key lands on
 * them square. A slab keeps only a few millimetres of the body, and what is
 * left of a structure in that band is its *wall* — the outside of a vessel, the
 * rim of a muscle — which stands vertical. An overhead light rakes those at
 * eighty degrees and returns almost nothing, which is exactly what a dark slab
 * looks like.
 *
 * Twenty degrees puts the light near the plane instead, so the walls catch it
 * and each structure reads as a ring rather than a smudge.
 */
const RAKE_ABOVE_HORIZON = (20 * Math.PI) / 180;

/**
 * The key light for a thin slab: low, and from the studio key's own side.
 *
 * The azimuth is borrowed rather than invented, so the section is lit from the
 * same side as the body it was taken from and the two pictures agree about
 * where the light in the room is.
 */
export function rakingKey(forward: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
  const aimed = studioLightDirections(forward, up);
  const alongPlane = aimed.key.clone().projectOnPlane(forward.clone().normalize());
  // The key is directly down the view axis and has no side to come from. Any
  // azimuth is as good as any other there, so pick one instead of emitting a
  // zero-length direction that would black the section out.
  if (alongPlane.lengthSq() < 1e-8) alongPlane.set(1, 0, 0).projectOnPlane(forward);
  alongPlane.normalize();

  return alongPlane
    .multiplyScalar(Math.cos(RAKE_ABOVE_HORIZON))
    .addScaledVector(forward.clone().normalize().negate(), Math.sin(RAKE_ABOVE_HORIZON))
    .normalize();
}
