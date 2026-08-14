import { create } from "zustand";

import type { VirtualPatient } from "@/lib/schemas";
import * as db from "@/lib/studyDb";
import {
  MAX_VISITS,
  type CaseDigest,
  type CaseFile,
  type CaseInput,
  type CaseVisit,
  type CaseSymptom,
  type CaseFinding,
  type SymptomInput,
} from "@/lib/studyDb";

/**
 * Case files, and which one the conversation is currently a visit to.
 *
 * Same rule as the study journal it lives beside: **this never throws into the
 * rest of the app**. A failed read leaves `error` set and the case picker
 * empty, and the assistant carries on as an ordinary drill. Losing the ability
 * to group visits must not cost anyone their lesson.
 *
 * `activeCaseId` is deliberately not persisted. A conversation is abandoned
 * when the app closes, so silently resuming a case on next launch would file a
 * visit the reader never opened — and the picker makes continuing one click
 * anyway.
 */

interface CaseStore {
  cases: CaseFile[];
  /** The case the next saved turn belongs to. `null` is an ordinary drill. */
  activeCaseId: string | null;
  /** Complaints marked on the active case, oldest first. */
  symptoms: CaseSymptom[];
  /**
   * The active case's visits, oldest first.
   *
   * Held without the sealed answer, deliberately. The digest they come from
   * carries it — the engine needs it — but nothing on screen may, so it is
   * dropped here rather than filtered at every place that renders. A panel
   * cannot leak a value it was never handed.
   */
  visits: CaseVisit[];
  /**
   * What has been added to the record since the case opened, oldest first.
   *
   * Separate from `CaseFile.findings`, which stays exactly as it was sealed.
   * Appended and never edited: an answer given at visit 3 has to be readable
   * against what visit 3 had been told, and a record that can be rewritten
   * backwards grades nothing.
   */
  record: CaseFinding[];
  error: string | null;
  loaded: boolean;

  refresh: () => Promise<void>;
  /** Mark a complaint where the reader pointed. */
  mark: (input: SymptomInput) => Promise<CaseSymptom | null>;
  unmark: (id: number) => Promise<boolean>;
  /** Add to the record, stamped by the journal with the visit it was learned at. */
  note: (body: string) => Promise<CaseFinding | null>;
  unnote: (id: number) => Promise<boolean>;
  /** Open a case, seal its answer, and make it the active one. */
  open: (input: CaseInput) => Promise<CaseFile | null>;
  /** Continue an existing case, or `null` to go back to one-off drills. */
  select: (caseId: string | null) => void;
  remove: (caseId: string) => Promise<boolean>;
  /** Deliberate act. Never called while merely listing or opening a case. */
  reveal: (caseId: string) => Promise<string | null>;
  dismissError: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A case with no room left cannot be continued, only started afresh. */
export function isFull(entry: CaseFile): boolean {
  return entry.visit_count >= MAX_VISITS;
}

/** What the picker shows for a case: how far in it is. */
export function visitLabel(entry: CaseFile): string {
  return isFull(entry) ? "complete" : `visit ${entry.visit_count + 1}`;
}

/**
 * Fold accents away before comparing.
 *
 * Not a nicety in the languages this is used in. A reader searching for
 * "cardiaco" should find "Dolor cardíaco", and one who typed the accent should
 * find the case they wrote without it — a search that is only right when both
 * spellings agree is a search that fails exactly when someone is in a hurry.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Whether a case answers to what the reader typed.
 *
 * Matched on the title alone, deliberately. The findings would also match, but
 * they run to a paragraph of vitals — a search for "hipertensión" that returned
 * every case mentioning blood pressure would be a list, not an answer.
 */
export function matchesQuery(entry: CaseFile, query: string): boolean {
  const needle = fold(query.trim());
  return needle === "" || fold(entry.title).includes(needle);
}

/** Below this a picker is shorter than the box that would filter it. */
export const FILTER_PATIENTS_FROM = 8;

/**
 * Whether a review of this case may see the answer and the verdicts.
 *
 * **The seal protects a visit until it is graded, not a case for ever.** Once a
 * visit is graded the written verdict already contains the reasoning the reader
 * should have reached — the drill prompt requires it to — so withholding the
 * sealed answer at that point protects nothing while making the summary worse.
 * While any visit is still open, the opposite holds: a summary that quoted the
 * verdicts would answer a question the reader has not attempted yet.
 *
 * Decided from `score IS NULL` and nothing else. Not a setting, not a checkbox,
 * nothing anyone can leave in the wrong position.
 */
export function reviewMaySeeTheAnswer(
  visits: readonly CaseVisit[],
  /**
   * When the reader opened the answer themselves. Set, and the seal is spent.
   *
   * Added after measuring the grading rule against a real journal: **1 visit
   * graded out of 13**, because most visits are conversations rather than
   * examinations and will never carry a score. A rule that is correct and
   * never fires protects nothing — it only hides the reader's own writing
   * from them. The deliberate act is what the seal was for; requiring a grade
   * was a proxy for it that did not hold.
   */
  revealedAt: number | null = null,
): boolean {
  if (revealedAt !== null) return true;
  return visits.length > 0 && visits.every((visit) => visit.score !== null);
}

/**
 * What a review will actually be working from.
 *
 * `Review this case` switched the mode and left an empty panel, which reads as
 * a button that does nothing. The missing piece was never a spinner: it was an
 * honest account of the file. A review sees the patient, the complaints marked
 * on the body and the findings written when the case was opened — and past
 * visits only as `visit_no`, `score` and `verdict`, never their transcripts. So
 * a case with no findings and nothing graded really is close to empty, and
 * saying so is the difference between a thin summary and a bug.
 */
export interface ReviewReadiness {
  /** Visits still to be graded — what keeps the sealed answer sealed. */
  ungraded: number;
  /** Visits on the file at all. Zero means there is nothing to summarise yet. */
  visits: number;
  /** Complaints marked on the body. */
  complaints: number;
  /** Entries added to the record since the case was opened. */
  updates: number;
  /**
   * True when the case has no findings at all — neither sealed at the opening
   * nor added since, so there is nothing to reason from but the complaints.
   *
   * An opening with none is only possible on cases written before findings
   * existed as a column; the composer has required them since. Those cases can
   * still be caught up, which is what the record is for.
   */
  bare: boolean;
}

export function reviewReadiness(
  patient: CaseFile,
  symptoms: readonly CaseSymptom[],
  visits: readonly CaseVisit[],
  record: readonly CaseFinding[] = [],
): ReviewReadiness {
  return {
    ungraded: visits.filter((visit) => visit.score === null).length,
    visits: visits.length,
    complaints: symptoms.length,
    updates: record.length,
    bare: patient.findings.trim() === "" && record.length === 0,
  };
}

export const useCaseStore = create<CaseStore>((set, get) => ({
  cases: [],
  activeCaseId: null,
  symptoms: [],
  visits: [],
  record: [],
  error: null,
  loaded: false,

  refresh: async () => {
    try {
      const active = get().activeCaseId;
      const [cases, digest] = await Promise.all([
        db.listCases(),
        // Only the active case's. Reading every case's history to draw a picker
        // would grow with the journal for a panel nobody is looking at.
        active ? db.caseDigest(active) : Promise.resolve(null),
      ]);
      set({
        cases,
        symptoms: digest?.symptoms ?? [],
        // `ground_truth` is on the digest and is deliberately not destructured
        // out into the store: what the panel is never given, it can never show.
        visits: digest?.visits ?? [],
        record: digest?.record_updates ?? [],
        error: null,
        loaded: true,
      });
    } catch (error) {
      set({ error: message(error), loaded: true });
    }
  },

  open: async (input) => {
    try {
      const opened = await db.createCase(input);
      set((state) => ({
        cases: [opened, ...state.cases],
        activeCaseId: opened.id,
        // A new case starts with nothing marked on it and no visits.
        symptoms: [],
        visits: [],
        record: [],
        error: null,
      }));
      return opened;
    } catch (error) {
      set({ error: message(error) });
      return null;
    }
  },

  select: (caseId) => {
    set({ activeCaseId: caseId, symptoms: [], visits: [], record: [] });
    // The presentation belongs to the case, so switching cases without
    // reloading would show the previous patient's complaints on this one.
    if (caseId) void get().refresh();
  },

  mark: async (input) => {
    try {
      const marked = await db.addCaseSymptom(input);
      set((state) => ({ symptoms: [...state.symptoms, marked], error: null }));
      return marked;
    } catch (error) {
      set({ error: message(error) });
      return null;
    }
  },

  unmark: async (id) => {
    try {
      await db.deleteCaseSymptom(id);
      set((state) => ({
        symptoms: state.symptoms.filter((entry) => entry.id !== id),
        error: null,
      }));
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    }
  },

  note: async (body) => {
    const text = body.trim();
    if (text === "") return null;
    const caseId = get().activeCaseId;
    if (!caseId) return null;
    try {
      const entry = await db.addCaseFinding({ case_id: caseId, body: text });
      set((state) => ({ record: [...state.record, entry], error: null }));
      return entry;
    } catch (error) {
      set({ error: message(error) });
      return null;
    }
  },

  unnote: async (id) => {
    try {
      await db.deleteCaseFinding(id);
      set((state) => ({
        record: state.record.filter((entry) => entry.id !== id),
        error: null,
      }));
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    }
  },

  remove: async (caseId) => {
    try {
      await db.deleteCase(caseId);
      set((state) => ({
        cases: state.cases.filter((entry) => entry.id !== caseId),
        // The visits survive as ordinary sessions, so the conversation is not
        // ended — it simply stops belonging to anything. The complaints do
        // not: they described the invented patient and go with them.
        activeCaseId: state.activeCaseId === caseId ? null : state.activeCaseId,
        symptoms: state.activeCaseId === caseId ? [] : state.symptoms,
        visits: state.activeCaseId === caseId ? [] : state.visits,
        record: state.activeCaseId === caseId ? [] : state.record,
        error: null,
      }));
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    }
  },

  reveal: async (caseId) => {
    try {
      const answer = await db.revealCaseAnswer(caseId);
      // Reloading, because the journal has just stamped `revealed_at` and the
      // panel decides what to offer from it. Without this the button would
      // still say "reveal" on a case that is already open.
      await get().refresh();
      return answer;
    } catch (error) {
      set({ error: message(error) });
      return null;
    }
  },

  dismissError: () => set({ error: null }),
}));

/** The active case, or `undefined` when the next turn is an ordinary drill. */
export function activeCase(state: CaseStore): CaseFile | undefined {
  return state.cases.find((entry) => entry.id === state.activeCaseId);
}

/**
 * The open case, in the shape the engine takes — or nothing.
 *
 * Read fresh from the journal on every question rather than held in memory.
 * The digest is what the *engine* needs, and it is cheap: it is one SQLite
 * read, it costs no tokens, and it is identical on every machine because
 * nothing in it was generated.
 *
 * Sending this is what stops the assistant refusing. Without it the engine
 * cannot tell an invented patient from a real one, and an ordinary sentence
 * inside a drill — "he has neck pain" — trips the individual-patient rule.
 *
 * `labelFor` names the structure a complaint was marked on. The label stored
 * with the complaint wins, because it was captured when the structure was
 * loaded and survives the system being switched off since.
 */
export async function virtualPatientContext(
  sessionId: string,
  labelFor: (organId: string) => string | null,
  /**
   * A review of a case that is still open is sent a redacted patient: no
   * sealed answer, no verdicts. Redacting here rather than instructing the
   * model not to mention them is what makes the guarantee real — the summary
   * cannot contain what never crossed the boundary.
   */
  mode: "case" | "review" = "case",
): Promise<{ case: VirtualPatient } | Record<string, never>> {
  const caseId = useCaseStore.getState().activeCaseId;
  if (!caseId) return {};

  let digest: CaseDigest | null = null;
  try {
    digest = await db.caseDigest(caseId);
  } catch (error) {
    // The drill still works without it; it simply forgets. Failing the whole
    // question over a journal read would cost the reader their answer too.
    useCaseStore.setState({ error: message(error) });
    return {};
  }
  if (!digest) return {};

  // The turn is filed *after* the answer, so this session may not be in the
  // digest yet. Either it is already a visit, or it is about to become the
  // next one.
  const current = digest.visits.find((visit) => visit.session_id === sessionId);
  const visitNo = current?.visit_no ?? digest.visits.length + 1;
  // A drill always needs the script to stay coherent. A review only earns it
  // once nothing is left unattempted.
  const mayReveal =
    mode === "case" || reviewMaySeeTheAnswer(digest.visits, digest.case.revealed_at);

  return {
    case: {
      title: digest.case.title,
      sex: digest.case.sex,
      age_years: digest.case.age_years,
      height_cm: digest.case.height_cm,
      weight_kg: digest.case.weight_kg,
      findings: digest.case.findings,
      // Given to the reader exactly as the opening findings are. Not sealed:
      // these are what the patient turned out to report, not what the case
      // turns out to be.
      record_updates: digest.record_updates.map((entry) => ({
        visit_no: entry.visit_no,
        body: entry.body,
      })),
      ground_truth: mayReveal ? digest.ground_truth : "",
      visit_no: visitNo,
      complaints: digest.symptoms.map((symptom) => ({
        organ_id: symptom.organ_id,
        label: symptom.organ_label ?? labelFor(symptom.organ_id) ?? symptom.organ_id,
        symptom: symptom.symptom,
        severity: symptom.severity,
      })),
      earlier_visits: digest.visits
        .filter((visit) => visit.visit_no < visitNo)
        .map((visit) => ({
          visit_no: visit.visit_no,
          score: visit.score,
          // The verdict states the reasoning the reader should have reached,
          // so it is the answer in all but name.
          verdict: mayReveal ? visit.verdict : null,
        })),
    },
  };
}
