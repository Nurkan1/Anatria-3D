import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { ManifestOrgan } from "@/lib/schemas";
import { useBreathStore } from "@/stores/breathStore";
import { useSceneStore } from "@/stores/sceneStore";

import {
  BREATH_AXIS,
  BREATH_FILL,
  BREATH_FRAME,
  BREATH_PATTERNS,
  BREATH_ROLE,
  breathFill,
  breathingIn,
  breathRole,
} from "./breathing";
import { beatChamber, isChamberWall } from "./heartbeat";
import { sinusPace } from "./sinusArrhythmia";

/**
 * The breath's clock. See `breathing.ts`.
 *
 * One write a frame to a shared uniform, and nothing at all while the switch
 * is off and the last breath has run out.
 *
 * **Switching on or off never jumps.** The breath fades in over a second and,
 * switched off, the chest is allowed to finish breathing out before it stops —
 * a body frozen half-full reads as a fault. A change of pattern carries the
 * depth across in the same way.
 */

/** Seconds to come up to full depth, or to settle. */
const EASE = 1;

/**
 * Whether the body is breathing in right now — for the panel, which reads it
 * on its own schedule rather than having the scene re-render it — and how far
 * the breath is pulling the heart rate above or below its own, as a fraction:
 * 0 whenever the body is not breathing. See `sinusArrhythmia.ts`.
 */
export const BREATH_NOW = { inhaling: false, running: false, swing: 0 };

type Measured = Pick<ManifestOrgan, "organ_id" | "system" | "name_en" | "ta2_latin" | "path">;

/**
 * The chest's heights for `BREATH_FRAME`: the bottom and top of the lungs
 * together, and the top of the heart's chamber walls.
 *
 * Measured from what is loaded. With the lungs or the heart switched off their
 * vessels can still be on screen, so each falls back to where it lies in a
 * body of ordinary proportions, from the sternum's height — the lungs from
 * sixteen centimetres below it to fourteen above, the heart's top four above.
 */
export function breathFrame(
  boxes: ReadonlyMap<string, THREE.Box3>,
  organs: Iterable<Measured>,
  sternumY: number,
): [number, number, number] {
  const lungs = new THREE.Box3();
  const heart = new THREE.Box3();
  for (const organ of organs) {
    const box = boxes.get(organ.organ_id);
    if (!box || box.isEmpty()) continue;
    if (organ.system === "respiratory" && breathRole(organ) === BREATH_ROLE.lung) lungs.union(box);
    else if (beatChamber(organ) !== null && isChamberWall(organ)) heart.union(box);
  }
  return [
    lungs.isEmpty() ? sternumY - 0.16 : lungs.min.y,
    lungs.isEmpty() ? sternumY + 0.14 : lungs.max.y,
    heart.isEmpty() ? sternumY + 0.04 : heart.max.y,
  ];
}

export function BreathDriver({
  boxes,
  bounds,
  revision,
}: {
  boxes: Map<string, THREE.Box3>;
  bounds: THREE.Box3 | null;
  revision: number;
}) {
  /**
   * Where the chest is: the sternum's middle, and an axis a hand's depth
   * behind it for the ribs to swing about. From the body's proportions until
   * the skeleton has been measured.
   */
  const axis = useMemo(() => {
    const sternum = boxes.get("body_of_sternum");
    if (sternum) {
      const centre = sternum.getCenter(new THREE.Vector3());
      return [centre.x, centre.y, sternum.max.z - 0.1];
    }
    if (bounds && !bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3());
      const middle = bounds.getCenter(new THREE.Vector3());
      return [middle.x, bounds.min.y + size.y * 0.73, middle.z];
    }
    return [0, 1.32, 0];
    // `boxes` is a ref's map and cannot invalidate a memo; `revision` is.
  }, [boxes, bounds, revision]);
  useEffect(() => {
    BREATH_AXIS.value = axis;
  }, [axis]);

  const organs = useSceneStore((s) => s.organs);
  useEffect(() => {
    BREATH_FRAME.value = breathFrame(boxes, Object.values(organs), axis[1]!);
    // `boxes` is filled in place; `revision` says when.
  }, [boxes, organs, axis, revision]);

  const clock = useRef(0);
  const amplitude = useRef(0);
  const depth = useRef(1);
  const sinusSwing = useRef(BREATH_PATTERNS.quiet.sinusSwing);

  useEffect(
    () => () => {
      BREATH_FILL.value = 0;
      BREATH_NOW.running = false;
      BREATH_NOW.swing = 0;
    },
    [],
  );

  useFrame((_, delta) => {
    // Read rather than subscribed: this runs every frame.
    const { enabled, pattern: id } = useBreathStore.getState();
    const pattern = BREATH_PATTERNS[id];
    // Nothing to do, and nothing done: off, and the last breath is out.
    if (!enabled && amplitude.current === 0) {
      if (BREATH_NOW.running) {
        BREATH_FILL.value = 0;
        BREATH_NOW.running = false;
        BREATH_NOW.swing = 0;
        clock.current = 0;
      }
      return;
    }
    const step = Math.min(delta, 0.05);
    clock.current += step;
    const fill = breathFill(clock.current, pattern);
    const inhaling = breathingIn(clock.current, pattern);

    if (enabled) {
      amplitude.current = Math.min(1, amplitude.current + step / EASE);
    } else if (!inhaling) {
      // Let the breath finish going out, then stop: a body frozen half-full
      // reads as a fault.
      amplitude.current = Math.max(0, amplitude.current - step / EASE);
      if (fill < 0.02) amplitude.current = 0;
    }
    depth.current += (pattern.depth - depth.current) * Math.min(1, step * 1.5);
    sinusSwing.current += (pattern.sinusSwing - sinusSwing.current) * Math.min(1, step * 1.5);

    BREATH_FILL.value = fill * amplitude.current * depth.current;
    BREATH_NOW.inhaling = inhaling;
    BREATH_NOW.running = amplitude.current > 0;
    BREATH_NOW.swing = amplitude.current * sinusSwing.current * sinusPace(clock.current, pattern);
  });

  return null;
}
