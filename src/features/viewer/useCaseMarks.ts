import { useEffect } from "react";

import { useCaseStore } from "@/stores/caseStore";
import { useSceneStore, type PathologyOverlay } from "@/stores/sceneStore";

/**
 * A complaint with no number on it still has to be visible.
 *
 * Mid-scale rather than nothing: severity is optional when marking, and a
 * complaint recorded without one is not a mild complaint — it is one nobody was
 * asked to rate. Rendering it at zero would make it invisible, which is the one
 * reading the reader definitely did not mean.
 */
const UNRATED = 0.5;

/** The reader's 0–10 scale onto the overlay's 0–1. */
export function markSeverity(severity: number | null): number {
  if (severity === null) return UNRATED;
  return Math.min(Math.max(severity, 0), 10) / 10;
}

export function caseMarksFrom(
  symptoms: readonly { organ_id: string; symptom: string; severity: number | null }[],
): Record<string, PathologyOverlay> {
  const marks: Record<string, PathologyOverlay> = {};
  for (const symptom of symptoms) {
    const existing = marks[symptom.organ_id];
    const severity = markSeverity(symptom.severity);
    // Two complaints on one structure: the worse one decides the colour, and
    // both names are kept so the tooltip does not silently drop one.
    marks[symptom.organ_id] =
      existing && existing.severity >= severity
        ? { pathology: `${existing.pathology} · ${symptom.symptom}`, severity: existing.severity }
        : {
            pathology: existing ? `${existing.pathology} · ${symptom.symptom}` : symptom.symptom,
            severity,
          };
  }
  return marks;
}

/**
 * Light the open patient's complaints on the model, and put them out on leaving.
 *
 * Derived, never commanded: the marks are a projection of what is in the
 * journal, recomputed whenever the presentation changes. That is why it costs
 * nothing — no model call, no tokens, and it lands the instant a patient is
 * selected rather than whenever the assistant next gets round to it.
 *
 * Mounted beside the atlas rather than inside the case panel, so selecting a
 * patient lights the body even when the reader is looking at the viewer.
 */
export function useCaseMarks(): void {
  const symptoms = useCaseStore((state) => state.symptoms);
  const activeCaseId = useCaseStore((state) => state.activeCaseId);
  const setCaseMarks = useSceneStore((state) => state.setCaseMarks);

  useEffect(() => {
    setCaseMarks(activeCaseId ? caseMarksFrom(symptoms) : {});
  }, [symptoms, activeCaseId, setCaseMarks]);
}
