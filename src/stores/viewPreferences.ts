import type { BackgroundMode } from "@/features/viewer/background";
import type { AnatomicalSystem } from "@/lib/schemas";

/**
 * The parts of the view worth carrying between sessions.
 *
 * # What is in here, and what is deliberately not
 *
 * The line is **configuration versus working state**. Which systems are on, how
 * translucent they are, whether structures are labelled, what the space sits on
 * and whether the eyes follow you are all decisions someone made about how they
 * want to work — they should survive closing the app, the way the panel widths
 * do.
 *
 * Everything that *narrows or cuts* the view is the other kind, and restoring
 * it is the wrong sort of helpful: the selection, the isolation set, hidden
 * individual structures, pathology overlays, a running pathway — and the cross
 * section, which was in here once and had to come out. A body that opens
 * already sliced through the neck reads as a broken render, not as a setting
 * being honoured, however faithfully the tree reflects it. Nobody sets a cut
 * and thinks "this is how I want the app to start".
 *
 * `localStorage` rather than the Tauri store, for the same reason as the panel
 * widths: it reads synchronously, so the first frame is already correct.
 */

const STORAGE_KEY = "anatria3d.view.v1";

export interface ViewPreferences {
  hiddenSystems: AnatomicalSystem[];
  systemOpacity: Partial<Record<AnatomicalSystem, number>>;
  eyeTracking: boolean;
  labelsVisible: boolean;
  background: BackgroundMode;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/**
 * Turn whatever was in storage into something safe to apply.
 *
 * Validated against the manifest actually loaded, not just against the type.
 * A build that drops or renames a system would otherwise restore a preference
 * for one that no longer exists — leaving a system hidden with no row in the
 * tree to switch it back on, which is unrecoverable without clearing storage.
 */
export function sanitiseViewPreferences(
  raw: unknown,
  known: Iterable<AnatomicalSystem>,
): Partial<ViewPreferences> {
  if (typeof raw !== "object" || raw === null) return {};
  const stored = raw as Record<string, unknown>;
  const systems = new Set(known);
  const clean: Partial<ViewPreferences> = {};

  if (Array.isArray(stored.hiddenSystems)) {
    clean.hiddenSystems = stored.hiddenSystems.filter(
      (system): system is AnatomicalSystem =>
        typeof system === "string" && systems.has(system as AnatomicalSystem),
    );
  }

  if (typeof stored.systemOpacity === "object" && stored.systemOpacity !== null) {
    const opacity: Partial<Record<AnatomicalSystem, number>> = {};
    for (const [system, value] of Object.entries(stored.systemOpacity)) {
      if (!systems.has(system as AnatomicalSystem)) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      // A stored 1 would say "ghosted" for a layer that is solid, which is the
      // distinction the reset button and the x-ray toggle both read.
      if (value >= 1) continue;
      opacity[system as AnatomicalSystem] = clamp(value, 0.02, 0.99);
    }
    clean.systemOpacity = opacity;
  }

  // `crossSection` is deliberately not read, and a file written by the build
  // that did store it is simply ignored on the way in.

  if (typeof stored.eyeTracking === "boolean") clean.eyeTracking = stored.eyeTracking;
  if (typeof stored.labelsVisible === "boolean") clean.labelsVisible = stored.labelsVisible;
  if (stored.background === "dark" || stored.background === "light") {
    clean.background = stored.background;
  }

  return clean;
}

/** The raw stored value, or null. Parsing failures are treated as absence. */
export function readStoredView(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeStoredView(preferences: ViewPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A full or disabled store costs the reader their layout next time, which
    // is not worth interrupting this session for.
  }
}
