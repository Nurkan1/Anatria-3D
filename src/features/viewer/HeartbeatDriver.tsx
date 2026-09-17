import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { ManifestOrgan } from "@/lib/schemas";
import { useHeartStore } from "@/stores/heartStore";

import {
  BEAT_ATRIA,
  BEAT_VENTRICLES,
  BEATING,
  beatAt,
  chamberCentres,
  CYCLE,
  passed,
} from "./heartbeat";
import { playDub, playLub } from "./heartSound";

/**
 * The longest a single frame may advance the heart, in seconds.
 *
 * A stall — a shader compiling, the window dragged — would otherwise arrive as
 * one enormous step, and the heart would jump a whole beat with its sounds
 * crammed into one frame. Clamped, the heart simply runs a little slow for that
 * moment, which nobody can see.
 */
const LONGEST_STEP_S = 0.1;

/**
 * The clock the heart beats to, run once per frame for the whole heart.
 *
 * Mounted always and idle unless the heartbeat is on. Each frame it writes the
 * two shared contraction values, keeps every beating mesh's chamber centre in
 * that mesh's own coordinates — so an exploded or moved heart still contracts
 * towards the right point — and plays a heart sound when the cycle passes one.
 */
export function HeartbeatDriver({
  boxes,
  organs,
  revision,
}: {
  /** The scene's measured boxes, filled in place as systems load. */
  boxes: ReadonlyMap<string, THREE.Box3>;
  organs: readonly ManifestOrgan[];
  /** Bumped when `boxes` changes, which its identity never says. */
  revision: number;
}) {
  const enabled = useHeartStore((s) => s.enabled);
  const centres = useMemo(
    () => (enabled ? chamberCentres(boxes, organs) : null),
    [enabled, boxes, organs, revision],
  );
  /** Seconds of heartbeat so far. Restarts at the top of a cycle each time. */
  const clock = useRef(0);
  const inverse = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => {
    if (enabled) return;
    // Back to rest, so the next time it starts it starts from a heart at rest.
    clock.current = 0;
    BEAT_ATRIA.value = 0;
    BEAT_VENTRICLES.value = 0;
  }, [enabled]);

  useFrame((_, delta) => {
    if (!enabled || !centres) return;
    const before = clock.current;
    const after = before + Math.min(delta, LONGEST_STEP_S);
    clock.current = after;

    const beat = beatAt(after);
    BEAT_ATRIA.value = beat.atria;
    BEAT_VENTRICLES.value = beat.ventricles;

    for (const entry of BEATING.values()) {
      const centre = centres.get(entry.chamber);
      if (!centre) continue;
      entry.centre.value.copy(centre).applyMatrix4(inverse.copy(entry.mesh.matrixWorld).invert());
    }

    // Read rather than subscribed: a preference nobody changes mid-frame.
    if (useHeartStore.getState().sound) {
      if (passed(before, after, CYCLE.s1)) playLub();
      if (passed(before, after, CYCLE.s2)) playDub();
    }
  });

  return null;
}
