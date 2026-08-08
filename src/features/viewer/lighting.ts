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
