import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { ManifestOrgan } from "@/lib/schemas";
import { useHeartStore } from "@/stores/heartStore";
import { useSceneStore } from "@/stores/sceneStore";

import {
  BEAT_ATRIA,
  BEAT_BASE_ATRIA,
  BEAT_BASE_VENTRICLES,
  BEAT_GLOW,
  BEAT_REACH_ATRIA,
  BEAT_REACH_VENTRICLES,
  BEAT_VENTRICLES,
  BEATING,
  BEATING_VERSION,
  chamberCentres,
  chamberHolds,
  HEART_PROBE,
  SEAM_ATTRIBUTE,
  seamFreedom,
  seamGrid,
  type BeatingMesh,
  type ChamberPoints,
} from "./heartbeat";
import {
  FLOW_CHAMBER,
  FLOW_PATH_ATTRIBUTE,
  FLOW_PROBE,
  FLOW_SOURCES,
  FLOW_UNIFORMS,
  FLOWING,
  FLOWING_VERSION,
  PulseTrain,
  type FlowKind,
} from "./bloodFlow";
import { flowPaths, type PathMesh } from "./flowPaths";
import { playDub, playLub } from "./heartSound";
import { rhythm, RhythmPlayer } from "./rhythms";

/**
 * The longest a single frame may advance the heart, in seconds.
 *
 * A stall — a shader compiling, the window dragged — would otherwise arrive as
 * one enormous step, and the heart would jump a whole beat with its sounds
 * crammed into one frame. Clamped, the heart simply runs a little slow for that
 * moment, which nobody can see.
 */
const LONGEST_STEP_S = 0.1;

function pointsOf(entry: BeatingMesh): ChamberPoints {
  return {
    chamber: entry.chamber,
    vertices: entry.mesh.geometry.getAttribute("position"),
    matrixWorld: entry.mesh.matrixWorld,
  };
}

/**
 * Give every beating geometry its seam attribute. See `seamFreedom`.
 *
 * Run when what is beating changes, not per frame: it reads every vertex of the
 * heart, and the answer does not change while the heart stays where it is.
 */
function measureSeams(): void {
  const started = performance.now();
  const walls: ChamberPoints[] = [];
  for (const entry of BEATING.values()) if (entry.wall) walls.push(pointsOf(entry));
  const grid = seamGrid(walls);
  for (const entry of BEATING.values()) {
    const free = seamFreedom(grid, pointsOf(entry));
    entry.mesh.geometry.setAttribute(SEAM_ATTRIBUTE, new THREE.BufferAttribute(free, 1));
  }
  HEART_PROBE.seamMs = performance.now() - started;
}

/**
 * Measure how far along the vessels every lit vertex is. See `flowPaths.ts`.
 *
 * Each kind of vessel is its own network, from its own chamber: the arteries do
 * not borrow a path through a vein that happens to lie against them.
 */
function measurePaths(centres: ReadonlyMap<string, THREE.Vector3>): void {
  const started = performance.now();
  let vertices = 0;
  for (const kind of Object.keys(FLOW_CHAMBER) as FlowKind[]) {
    const origin = centres.get(FLOW_CHAMBER[kind]);
    const entries = [...FLOWING.values()].filter((entry) => entry.kind === kind);
    if (!origin || entries.length === 0) continue;
    const meshes: PathMesh[] = entries.map((entry) => {
      entry.mesh.updateWorldMatrix(true, false);
      const position = entry.mesh.geometry.getAttribute("position");
      vertices += position.count;
      return { vertices: position, matrixWorld: entry.mesh.matrixWorld, seed: entry.seed };
    });
    const paths = flowPaths(meshes, origin);
    entries.forEach((entry, i) => {
      entry.mesh.geometry.setAttribute(FLOW_PATH_ATTRIBUTE, new THREE.BufferAttribute(paths[i]!, 1));
    });
  }
  FLOW_PROBE.pathMs = performance.now() - started;
  FLOW_PROBE.vertices = vertices;
}

/**
 * Frames the vessel registry must stay unchanged before the paths are measured.
 *
 * Systems load a few meshes a frame, and turning the body to glass mounts six
 * hundred lights over several frames. Measuring on every change would measure
 * the network hundreds of times while it was still arriving.
 */
const PATH_SETTLE_FRAMES = 20;

/**
 * The clock the heart beats to, run once per frame for the whole heart.
 *
 * Mounted always and idle unless the heartbeat is on. Each frame it writes the
 * two shared contraction values from the chosen rhythm, keeps every beating
 * mesh's chamber centre in that mesh's own coordinates — so an exploded or
 * moved heart still contracts towards the right point — and plays the heart
 * sounds the rhythm laid down for that frame.
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
  const rhythmId = useHeartStore((s) => s.rhythm);
  const centres = useMemo(
    () => (enabled ? chamberCentres(boxes, organs) : null),
    [enabled, boxes, organs, revision],
  );

  // Where the base is held. Written when the heart is measured, not per frame.
  useEffect(() => {
    if (!enabled) return;
    const holds = chamberHolds(boxes, organs);
    BEAT_BASE_ATRIA.value = holds.atria?.base ?? 0;
    BEAT_REACH_ATRIA.value = holds.atria?.reach ?? 0;
    BEAT_BASE_VENTRICLES.value = holds.ventricles?.base ?? 0;
    BEAT_REACH_VENTRICLES.value = holds.ventricles?.reach ?? 0;
  }, [enabled, boxes, organs, revision]);

  /** Seconds of heartbeat so far. Restarts at the top of a cycle each time. */
  const clock = useRef(0);
  /** The registry version the seams were last measured for. */
  const measured = useRef(-1);
  /** The vessel registry version the paths were measured for, and how long it has held. */
  const pathsMeasured = useRef(-1);
  const pathsSeen = useRef({ version: -1, frames: 0 });
  /** The rhythm being played, made on the first frame after it was chosen. */
  const player = useRef<RhythmPlayer | null>(null);
  /** The blood the contractions push. See `bloodFlow.ts`. */
  const pulses = useMemo(() => new PulseTrain(), []);

  // A new rhythm starts from the top, from a heart at rest.
  useEffect(() => {
    player.current = null;
    clock.current = 0;
    pulses.reset();
  }, [rhythmId, pulses]);
  const inverse = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => {
    if (enabled) return;
    // Back to rest, so the next time it starts it starts from a heart at rest.
    clock.current = 0;
    measured.current = -1;
    pathsMeasured.current = -1;
    player.current = null;
    BEAT_ATRIA.value = 0;
    BEAT_VENTRICLES.value = 0;
    BEAT_GLOW.value = 0;
    pulses.reset();
    FLOW_UNIFORMS.uPulseStrength.value.fill(0);
    FLOW_UNIFORMS.uVenous.value = 0;
  }, [enabled, pulses]);

  useFrame((_, delta) => {
    if (!enabled || !centres) return;

    if (measured.current !== BEATING_VERSION.value) {
      measured.current = BEATING_VERSION.value;
      measureSeams();
    }

    const version = FLOWING_VERSION.value;
    if (version !== pathsMeasured.current && FLOWING.size > 0) {
      const seen = pathsSeen.current;
      if (seen.version !== version) {
        seen.version = version;
        seen.frames = 0;
      } else if (++seen.frames >= PATH_SETTLE_FRAMES) {
        pathsMeasured.current = version;
        measurePaths(centres);
      }
    }

    const before = clock.current;
    const after = before + Math.min(delta, LONGEST_STEP_S);
    clock.current = after;

    player.current ??= new RhythmPlayer(rhythm(rhythmId));
    const beat = player.current.advance(before, after);
    BEAT_ATRIA.value = beat.atria;
    BEAT_VENTRICLES.value = beat.ventricles;

    for (const entry of BEATING.values()) {
      const centre = centres.get(entry.chamber);
      if (!centre) continue;
      entry.centre.value.copy(centre).applyMatrix4(inverse.copy(entry.mesh.matrixWorld).invert());
    }

    // The chambers light only when the blood's light is showing too.
    BEAT_GLOW.value = (useSceneStore.getState().systemOpacity.cardiovascular ?? 1) < 1 ? 1 : 0;

    // The blood follows the contractions, heard or not.
    for (const level of beat.lub) pulses.launch(after, level);
    pulses.advance(after, after - before, FLOW_UNIFORMS.uPulseAge.value, FLOW_UNIFORMS.uPulseStrength.value);
    FLOW_UNIFORMS.uVenous.value = pulses.venous;
    FLOW_UNIFORMS.uFlowTime.value = after;
    for (const kind of Object.keys(FLOW_CHAMBER) as FlowKind[]) {
      const centre = centres.get(FLOW_CHAMBER[kind]);
      if (centre) FLOW_SOURCES[kind].value.copy(centre);
    }

    // Read rather than subscribed: a preference nobody changes mid-frame.
    if (useHeartStore.getState().sound) {
      for (const level of beat.lub) playLub(level);
      for (const level of beat.dub) playDub(level);
    }
  });

  return null;
}
