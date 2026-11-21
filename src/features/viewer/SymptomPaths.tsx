import { Html } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { CasePath, PathPoint, PathSpread } from "@/lib/studyDb";
import { useCaseStore } from "@/stores/caseStore";

/**
 * Symptom paths on the case's patient, drawn over the body.
 *
 * # What the line is, and what it is not
 *
 * A path joins the centres of the structures its author marked, in order, and
 * nothing more. It is **not** the course of a nerve, nor a dermatome: the atlas
 * holds no dermatome data, and a line that bent along the skin as if it knew
 * where C6 runs would be exactly the confident wrong picture this viewer
 * refuses to draw. The panel says so in words, and the assistant is told the
 * same, and asked to light the real nerve instead.
 *
 * What the line does say is the kind of travel, because that is what the
 * reader has to reason with:
 *
 * - `radiating` — solid, with arrows: one symptom moving along a nerve.
 * - `referred` — dashed: felt here, caused elsewhere. The break in the line is
 *   the point, the same two places joined solidly would claim a route.
 * - `multifocal` — no line at all: separate places, no direction.
 *
 * # Why this is a layer of its own
 *
 * The same reasoning as `PathwayFlow`: drawing into organ materials would make
 * every memoised `OrganMesh` care about paths. Here, nothing else in the scene
 * knows they exist, and with no case open the component renders nothing.
 */

/**
 * The path colour, and why it is rose.
 *
 * Cyan is selection, violet is a physiological route, amber through crimson is
 * pathology severity. Rose collides with none of them and reads as a symptom
 * drawn over the anatomy, not as anatomy.
 */
export const PATH_COLOUR = "#ff5c8a";

/**
 * A student's hypothesis, in lime: plainly not the patient's symptom, and
 * clashing with none of the colours above. The same line styles apply.
 */
export const HYPOTHESIS_COLOUR = "#a3e635";

/** Line thickness, as a fraction of the model's largest dimension. */
const TUBE_SCALE = 0.0035;
/** Stop marker radius at intensity 0 and the growth per point of intensity. */
const MARKER_BASE = 0.006;
const MARKER_PER_INTENSITY = 0.0009;
/** Arrowhead size, likewise. */
const ARROW_SCALE = 0.016;
/** Dashes per segment of a referred path. */
const DASHES_PER_STEP = 7;

export function SymptomPathsLayer({
  centres,
  centresRevision,
  modelScale,
}: {
  centres: Map<string, THREE.Vector3>;
  /** `centres` is a ref; this is what says it has changed. */
  centresRevision: number;
  modelScale: number;
}) {
  const activeCaseId = useCaseStore((s) => s.activeCaseId);
  const paths = useCaseStore((s) => s.paths);
  const draft = useCaseStore((s) => s.draft);

  if (!activeCaseId) return null;

  const shown = paths.filter((path) => path.active);

  return (
    <group>
      {shown.map((path) => (
        <SymptomPath
          key={path.id}
          points={path.points}
          spread={path.spread}
          colour={path.kind === "hypothesis" ? HYPOTHESIS_COLOUR : PATH_COLOUR}
          centres={centres}
          centresRevision={centresRevision}
          modelScale={modelScale}
          opacity={0.7}
        />
      ))}
      {draft && (
        <SymptomPath
          points={draft.points}
          spread={draft.spread}
          colour={draft.kind === "hypothesis" ? HYPOTHESIS_COLOUR : PATH_COLOUR}
          centres={centres}
          centresRevision={centresRevision}
          modelScale={modelScale}
          // Fainter until it is saved, so a half-drawn path is not mistaken
          // for part of the case.
          opacity={0.45}
        />
      )}
    </group>
  );
}

interface Stop {
  at: THREE.Vector3;
  point: PathPoint;
  role: "start" | "via" | "end" | "place";
}

function SymptomPath({
  points,
  spread,
  colour,
  centres,
  centresRevision,
  modelScale,
  opacity,
}: {
  points: CasePath["points"];
  spread: PathSpread;
  colour: string;
  centres: Map<string, THREE.Vector3>;
  centresRevision: number;
  modelScale: number;
  opacity: number;
}) {
  const stops = useMemo<Stop[]>(() => {
    void centresRevision;
    // A structure whose system is switched off has no measured centre and is
    // skipped, so the rest of the path still draws.
    const measured = points.flatMap((point) => {
      const at = centres.get(point.organ_id);
      return at ? [{ at: at.clone(), point }] : [];
    });
    return measured.map((entry, index) => ({
      ...entry,
      role:
        spread === "multifocal"
          ? "place"
          : index === 0
            ? "start"
            : index === measured.length - 1
              ? "end"
              : "via",
    }));
  }, [points, spread, centres, centresRevision]);

  const curve = useMemo(() => {
    if (spread === "multifocal") return null;
    const distinct = stops
      .map((stop) => stop.at)
      .filter((at, index, all) => index === 0 || at.distanceToSquared(all[index - 1]!) > 1e-12);
    if (distinct.length < 2) return null;
    // Centripetal, as for `PathwayFlow`: it does not overshoot between unevenly
    // spaced centres.
    return new THREE.CatmullRomCurve3(distinct, false, "centripetal", 0.5);
  }, [stops, spread]);

  const radius = modelScale * TUBE_SCALE;

  const solid = useMemo(() => {
    if (!curve || spread !== "radiating") return null;
    return new THREE.TubeGeometry(curve, stops.length * 16, radius, 8, false);
  }, [curve, spread, stops.length, radius]);

  const dashes = useMemo(() => {
    if (!curve || spread !== "referred") return [];
    const samples = curve.getSpacedPoints(Math.max(2, (stops.length - 1) * DASHES_PER_STEP * 2));
    const pieces: THREE.TubeGeometry[] = [];
    for (let at = 0; at + 1 < samples.length; at += 2) {
      pieces.push(
        new THREE.TubeGeometry(new THREE.LineCurve3(samples[at]!, samples[at + 1]!), 1, radius, 6, false),
      );
    }
    return pieces;
  }, [curve, spread, stops.length, radius]);

  /** One arrow per segment, at its middle, pointing the way the symptom travels. */
  const arrows = useMemo(() => {
    if (!curve) return [];
    const segments = stops.length - 1;
    const up = new THREE.Vector3(0, 1, 0);
    return Array.from({ length: segments }, (_, index) => {
      const t = (index + 0.5) / segments;
      const position = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      return { position, rotation: new THREE.Quaternion().setFromUnitVectors(up, tangent) };
    });
  }, [curve, stops.length]);

  // GPU buffers outlive the React tree unless they are disposed.
  useEffect(() => () => solid?.dispose(), [solid]);
  useEffect(() => () => dashes.forEach((piece) => piece.dispose()), [dashes]);

  const material = (
    <meshBasicMaterial
      color={colour}
      transparent
      opacity={opacity}
      // An annotation over the anatomy, accumulated through it rather than
      // hidden behind it: a path down the arm that vanished under the deltoid
      // would teach nothing.
      depthTest={false}
      depthWrite={false}
      toneMapped={false}
    />
  );

  return (
    <group renderOrder={4}>
      {solid && (
        <mesh geometry={solid} renderOrder={4}>
          {material}
        </mesh>
      )}
      {dashes.map((piece, index) => (
        <mesh key={index} geometry={piece} renderOrder={4}>
          {material}
        </mesh>
      ))}
      {arrows.map((arrow, index) => (
        <mesh key={index} position={arrow.position} quaternion={arrow.rotation} renderOrder={5}>
          <coneGeometry args={[modelScale * ARROW_SCALE * 0.45, modelScale * ARROW_SCALE, 12]} />
          {material}
        </mesh>
      ))}
      {stops.map((stop, index) => (
        <group key={`${stop.point.organ_id}-${index}`} position={stop.at}>
          <mesh renderOrder={5}>
            <sphereGeometry
              args={[modelScale * (MARKER_BASE + MARKER_PER_INTENSITY * (stop.point.intensity ?? 3)), 16, 16]}
            />
            <meshBasicMaterial
              color={colour}
              transparent
              opacity={Math.min(1, opacity + 0.25)}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          {/* Lifted off the marker so the label does not cover what it labels,
              and kept under the viewport's own panels (z-20), which it once
              drew over. */}
          <Html
            center
            position={[0, modelScale * 0.024, 0]}
            zIndexRange={[9, 0]}
            style={{ pointerEvents: "none" }}
          >
            <span className="whitespace-nowrap rounded bg-slate-950/80 px-1 py-px text-[9px] font-medium text-rose-200 ring-1 ring-rose-500/40">
              {stopLabel(stop.role, index)}
              {stop.point.intensity !== null && (
                <span className="text-rose-300/70"> · {stop.point.intensity}/10</span>
              )}
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}

function stopLabel(role: Stop["role"], index: number): string {
  if (role === "start") return "Start";
  if (role === "end") return "End";
  return String(index + 1);
}
