import { create } from "zustand";

import * as db from "@/lib/studyDb";
import type {
  ImportSummary,
  NoteInput,
  SessionSummary,
  StudyNote,
  StudyStats,
  TurnInput,
} from "@/lib/studyDb";

/**
 * The study journal's view state.
 *
 * One rule runs through every action here: **the journal never throws into the
 * rest of the app**. A failed write records itself in `error` and returns. The
 * atlas, the viewport and the assistant all work with no database at all, and a
 * locked or unwritable file should cost the student their notes, not their
 * lesson.
 */

interface StudyStore {
  sessions: SessionSummary[];
  notes: StudyNote[];
  stats: StudyStats | null;
  /** Free-text filter, applied to both lists. */
  query: string;
  /** When set, both lists are narrowed to one structure. */
  organFilter: string | null;
  /** Its name, kept alongside: the structure may not be loaded to look up. */
  organFilterLabel: string | null;
  error: string | null;
  /** False until the first successful load, so the panel can say "loading". */
  loaded: boolean;

  refresh: () => Promise<void>;
  setQuery: (query: string) => Promise<void>;
  setOrganFilter: (organId: string | null, label?: string | null) => Promise<void>;
  dismissError: () => void;

  /**
   * Writes report success rather than throwing it.
   *
   * `false` is not decoration: a case grade may only be recorded once the turn
   * that created the session row has landed, and firing it after a failed save
   * would produce a second, unrelated error about a session that does not
   * exist — which reads like a different bug.
   */
  saveTurn: (turn: TurnInput) => Promise<boolean>;
  recordVerdict: (sessionId: string, score: number, verdict: string) => Promise<boolean>;
  renameSession: (sessionId: string, title: string) => Promise<boolean>;
  removeSession: (sessionId: string) => Promise<boolean>;

  addNote: (input: NoteInput) => Promise<boolean>;
  editNote: (id: number, body: string) => Promise<boolean>;
  removeNote: (id: number) => Promise<boolean>;

  /**
   * How often each structure has been worked on, keyed by `organ_id`.
   *
   * Absent means never — the query does not return zeros, and the viewer reads
   * absence as the gap it is.
   */
  coverage: Record<string, number>;
  /** Whether the viewport is painted with it. */
  coverageVisible: boolean;
  setCoverageVisible: (visible: boolean) => Promise<void>;

  /** Where the last export landed, or what the last import merged. */
  transfer: string | null;
  exportJournal: () => Promise<void>;
  importJournal: () => Promise<void>;
  dismissTransfer: () => void;
}

/** Plain English for what a merge actually did. */
export function describeImport(summary: ImportSummary): string {
  const parts: string[] = [];
  const added = summary.sessions_added + summary.notes_added;
  const updated = summary.sessions_updated + summary.notes_updated;
  if (summary.sessions_added > 0) parts.push(`${summary.sessions_added} sessions`);
  if (summary.notes_added > 0) parts.push(`${summary.notes_added} notes`);

  if (added === 0 && updated === 0) {
    // The honest report of a repeat import, and the one most worth spelling
    // out: silence here reads as a failure.
    return "Nothing new — that journal is already here.";
  }

  const head = parts.length > 0 ? `Added ${parts.join(" and ")}` : "Merged";
  const tail = updated > 0 ? `, updated ${updated}` : "";
  const rest = summary.skipped > 0 ? `. ${summary.skipped} already here.` : ".";
  return `${head}${tail}${rest}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Rows into a lookup, which is how the viewer asks about one structure. */
function tally(rows: db.StudyCoverage[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.organ_id, row.touches]));
}

export const useStudyStore = create<StudyStore>()((set, get) => {
  /**
   * Run a journal operation, then reload.
   *
   * Reloading rather than patching the arrays in place: every write changes
   * more than the row it touched — a turn bumps a session's position, its
   * message count and the statistics — and the read that would keep those in
   * sync costs microseconds against a local file.
   */
  async function write(operation: () => Promise<unknown>): Promise<boolean> {
    try {
      await operation();
      set({ error: null });
    } catch (error) {
      set({ error: message(error) });
      return false;
    }
    await get().refresh();
    return true;
  }

  return {
    sessions: [],
    notes: [],
    stats: null,
    query: "",
    organFilter: null,
    organFilterLabel: null,
    error: null,
    loaded: false,

    coverage: {},
    coverageVisible: false,

    refresh: async () => {
      const { query, organFilter, coverageVisible } = get();
      const term = query.trim() || null;
      try {
        const [sessions, notes, stats, coverage] = await Promise.all([
          db.listStudySessions(term, organFilter),
          db.listNotes(organFilter, term),
          db.studyStats(),
          // Only while the map is on screen. It is a whole-journal aggregate
          // and nothing else reads it, so paying for it on every note saved
          // would be work for a view nobody is looking at.
          coverageVisible ? db.studyCoverage() : Promise.resolve(null),
        ]);
        set({
          sessions,
          notes,
          stats,
          ...(coverage ? { coverage: tally(coverage) } : {}),
          error: null,
          loaded: true,
        });
      } catch (error) {
        set({ error: message(error), loaded: true });
      }
    },

    setCoverageVisible: async (visible) => {
      set({ coverageVisible: visible });
      // Fetched on the way in rather than kept up to date in the background:
      // switching the map on is exactly when the reader wants today's answer,
      // and it is stale by one note at worst.
      if (visible) await get().refresh();
    },

    setQuery: async (query) => {
      set({ query });
      await get().refresh();
    },

    setOrganFilter: async (organId, label = null) => {
      set({ organFilter: organId, organFilterLabel: organId ? label : null });
      await get().refresh();
    },

    dismissError: () => set({ error: null }),

    saveTurn: (turn) => write(() => db.saveStudyTurn(turn)),

    recordVerdict: (sessionId, score, verdict) =>
      write(() => db.recordCaseResult(sessionId, score, verdict)),

    renameSession: (sessionId, title) =>
      write(() => db.renameStudySession(sessionId, title)),

    removeSession: (sessionId) => write(() => db.deleteStudySession(sessionId)),

    addNote: (input) => write(() => db.createNote(input)),

    editNote: (id, body) => write(() => db.updateNote(id, body)),

    removeNote: (id) => write(() => db.deleteNote(id)),

    transfer: null,

    exportJournal: async () => {
      try {
        const path = await db.exportJournal();
        // `null` is a cancelled dialog, not a failure. Reporting it would
        // teach the reader to distrust the message that matters.
        set({ transfer: path ? `Saved to ${path}` : null, error: null });
      } catch (error) {
        set({ error: message(error) });
      }
    },

    importJournal: async () => {
      let summary: ImportSummary | null;
      try {
        summary = await db.importJournal();
      } catch (error) {
        set({ error: message(error) });
        return;
      }
      if (!summary) return;
      set({ transfer: describeImport(summary), error: null });
      await get().refresh();
    },

    dismissTransfer: () => set({ transfer: null }),
  };
});
