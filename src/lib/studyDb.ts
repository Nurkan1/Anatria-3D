import { invoke } from "@tauri-apps/api/core";

import type { AiProvider, FiledMode, Language, UserProfile } from "./schemas";

/**
 * The study journal, as the renderer sees it.
 *
 * Unlike `ipc.ts` these calls carry no Zod validation, and the difference is
 * deliberate. The engine boundary crosses a language and a process whose schema
 * has a separate owner, so it is worth a runtime check. This boundary is serde
 * serialising Rust structs that live in the same repository, covered by the
 * tests in `study_db.rs` — a type declaration is the honest amount of
 * ceremony for it.
 *
 * Command arguments are camelCase (Tauri renames them); the fields *inside* a
 * payload struct stay snake_case, because serde reads them by their declared
 * name.
 */

export interface SessionSummary {
  id: string;
  kind: FiledMode;
  title: string;
  profile: UserProfile;
  language: Language;
  /** 0–100, present once a case has been graded. */
  score: number | null;
  verdict: string | null;
  message_count: number;
  structure_count: number;
  /**
   * The virtual patient this was a visit to, and which visit.
   *
   * Null on every ordinary conversation, which is most of them. Carried on the
   * summary so a list of sixty rows can say which belong to whom without a
   * query per row.
   */
  case_id: string | null;
  visit_no: number | null;
  /** Epoch milliseconds — sortable without parsing, and no date library. */
  created_at: number;
  updated_at: number;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  created_at: number;
  /**
   * Which model produced this answer, and what it cost.
   *
   * Null on every question, and on any answer written before the journal
   * recorded it. Nothing is backfilled — an old answer genuinely has no
   * recorded model, and filling in the current selection would look like a
   * fact rather than a guess.
   */
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface SessionDetail {
  session: SessionSummary;
  messages: StoredMessage[];
  structures: string[];
}

export interface StudyNote {
  id: number;
  organ_id: string | null;
  organ_label: string | null;
  session_id: string | null;
  body: string;
  created_at: number;
  updated_at: number;
}

export interface StudyStats {
  sessions: number;
  cases: number;
  graded_cases: number;
  notes: number;
  average_score: number | null;
}

export interface TurnInput {
  session_id: string;
  kind: FiledMode;
  title: string;
  profile: UserProfile;
  language: Language;
  question: string;
  answer: string;
  organ_ids: string[];
  /** Provenance for the answer. Absent when the provider reported none. */
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  /**
   * The case this session is a visit to. Read only when the session is first
   * created — a conversation cannot change which case it belongs to halfway
   * through, because its visit number would have to be invented.
   */
  case_id?: string | null;
}

export interface NoteInput {
  organ_id: string | null;
  organ_label: string | null;
  session_id: string | null;
  body: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Append a finished exchange, creating the session row if this is the first. */
export function saveStudyTurn(turn: TurnInput): Promise<void> {
  return invoke("save_study_turn", { turn });
}

export function recordCaseResult(
  sessionId: string,
  score: number,
  verdict: string,
): Promise<void> {
  return invoke("record_case_result", { sessionId, score, verdict });
}

/**
 * Sessions, newest first. Both filters are optional and compose — narrowing to
 * a structure and then searching within it is the natural follow-up question.
 */
export function listStudySessions(
  query: string | null,
  organId: string | null,
  caseId: string | null,
  limit = 100,
): Promise<SessionSummary[]> {
  return invoke("list_study_sessions", { query, organId, caseId, limit });
}

export function getStudySession(sessionId: string): Promise<SessionDetail | null> {
  return invoke("get_study_session", { sessionId });
}

export function renameStudySession(sessionId: string, title: string): Promise<void> {
  return invoke("rename_study_session", { sessionId, title });
}

export function deleteStudySession(sessionId: string): Promise<void> {
  return invoke("delete_study_session", { sessionId });
}

// ---------------------------------------------------------------------------
// Case files
// ---------------------------------------------------------------------------

/**
 * The sex a case is reasoned about.
 *
 * Not the sex of the model on screen: this build ships a male mesh whichever is
 * chosen, and the interface has to say so where the choice is made. Presentation
 * differs by sex in exactly the systems these cases are for — a case that
 * reasons about it while showing a male body is honest; one that hides the
 * limitation is not.
 */
export type CaseSex = "male" | "female";

/** A case file, without its sealed answer. See `revealCaseAnswer`. */
export interface CaseFile {
  id: string;
  title: string;
  sex: CaseSex;
  age_years: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  /**
   * Vitals, history and results the reader is given.
   *
   * On the summary, unlike the sealed answer, precisely because they are not
   * secret — a case whose findings were withheld could not be reasoned about.
   */
  findings: string;
  /** When the answer was sealed — always at creation. */
  sealed_at: number;
  /**
   * When the reader opened the answer themselves, or null while sealed.
   *
   * A door, not a leak. Recorded in the file rather than held in the window,
   * so a case that has been opened stays open — otherwise a summary would
   * include the answer today and withhold it tomorrow.
   */
  revealed_at: number | null;
  profile: UserProfile;
  language: Language;
  created_at: number;
  updated_at: number;
  visit_count: number;
}

export interface CaseInput {
  id: string;
  title: string;
  sex: CaseSex;
  age_years?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  findings: string;
  ground_truth: string;
  profile: UserProfile;
  language: Language;
}

export interface CaseVisit {
  session_id: string;
  visit_no: number;
  score: number | null;
  verdict: string | null;
  structures: string[];
  created_at: number;
}

/**
 * A complaint marked on the body.
 *
 * `organ_id` is **where the reader marked it**, not where the cause is. Those
 * are often different, and working the second out from the first is the
 * reasoning being taught — pain down the left arm belongs to the heart, and no
 * static atlas can show that.
 */
export interface CaseSymptom {
  id: number;
  organ_id: string;
  /** Kept alongside: the structure's system may be switched off. */
  organ_label: string | null;
  symptom: string;
  /** 0–10, the scale the reader already knows. Null when not asked. */
  severity: number | null;
  session_id: string | null;
  created_at: number;
}

export interface SymptomInput {
  case_id: string;
  session_id?: string | null;
  organ_id: string;
  organ_label?: string | null;
  symptom: string;
  severity?: number | null;
}

/**
 * Something learned about the patient after the case was opened.
 *
 * The opening findings on `CaseFile` are sealed where they were written; these
 * accumulate beside them, each stamped with the visit it was known at. That
 * ordering is clinical information in itself — a weight that came down over
 * four visits is a different case from a weight that was always low.
 */
export interface CaseFinding {
  id: number;
  /** Counted by the journal at insert time, never passed in. */
  visit_no: number;
  body: string;
  created_at: number;
}

export interface FindingInput {
  case_id: string;
  body: string;
}

export interface CaseDigest {
  case: CaseFile;
  /** Bound for the engine, which needs the script to keep the course coherent. */
  ground_truth: string;
  visits: CaseVisit[];
  /** Oldest first — the presentation as it developed. */
  symptoms: CaseSymptom[];
  /** Oldest first — what has been added to the record since it was opened. */
  record_updates: CaseFinding[];
}

/** Highest severity a complaint may carry, mirroring the journal's check. */
export const MAX_SEVERITY = 10;

/** Mark a complaint where the reader points. */
export function addCaseSymptom(symptom: SymptomInput): Promise<CaseSymptom> {
  return invoke("add_case_symptom", { symptom });
}

export function caseSymptoms(caseId: string): Promise<CaseSymptom[]> {
  return invoke("case_symptoms", { caseId });
}

export function deleteCaseSymptom(id: number): Promise<void> {
  return invoke("delete_case_symptom", { id });
}

/** Add to the record. There is no equivalent for the sealed answer. */
export function addCaseFinding(finding: FindingInput): Promise<CaseFinding> {
  return invoke("add_case_finding", { finding });
}

export function caseFindings(caseId: string): Promise<CaseFinding[]> {
  return invoke("case_findings", { caseId });
}

export function deleteCaseFinding(id: number): Promise<void> {
  return invoke("delete_case_finding", { id });
}

/** Visits one case may hold, mirroring `MAX_VISITS` in the journal. */
export const MAX_VISITS = 20;

/**
 * Open a case and seal its answer, now, before anything has been attempted.
 *
 * There is no call that edits `ground_truth` afterwards and no column to put a
 * person's name in. Both are deliberate: an answer written once the attempt is
 * in hand grades nothing, and a case file that cannot hold a person cannot
 * become a medical record.
 */
export function createCase(kase: CaseInput): Promise<CaseFile> {
  return invoke("create_case", { case: kase });
}

export function listCases(): Promise<CaseFile[]> {
  return invoke("list_cases");
}

/** Its own call, so opening a case can never spoil it. */
export function revealCaseAnswer(caseId: string): Promise<string | null> {
  return invoke("reveal_case_answer", { caseId });
}

/** What the next visit carries forward. Read from the journal, never generated. */
export function caseDigest(caseId: string): Promise<CaseDigest | null> {
  return invoke("case_digest", { caseId });
}

/** The visits survive as ordinary sessions. */
export function deleteCase(caseId: string): Promise<void> {
  return invoke("delete_case", { caseId });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function createNote(note: NoteInput): Promise<StudyNote> {
  return invoke("create_note", { note });
}

export function updateNote(id: number, body: string): Promise<void> {
  return invoke("update_note", { id, body });
}

export function deleteNote(id: number): Promise<void> {
  return invoke("delete_note", { id });
}

export function listNotes(
  organId: string | null,
  query: string | null,
  limit = 200,
): Promise<StudyNote[]> {
  return invoke("list_notes", { organId, query, limit });
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function studyStats(): Promise<StudyStats> {
  return invoke("study_stats");
}

/** One structure and how often it has been worked on. */
export interface StudyCoverage {
  organ_id: string;
  touches: number;
}

/**
 * How much attention each structure has had — notes and sessions together.
 *
 * Structures never touched are absent rather than zero: a row for each of three
 * and a half thousand would be a payload made almost entirely of nothing, and
 * the caller reads absence as the gap it is.
 */
export function studyCoverage(): Promise<StudyCoverage[]> {
  return invoke("study_coverage");
}

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

/** What one finished turn cost. */
export interface UsageInput {
  /** The conversation it belongs to, when there is one. */
  session_id: string | null;
  provider: AiProvider;
  /** The id the engine actually sent, defaults resolved. */
  model: string;
  input_tokens: number;
  output_tokens: number;
}

/** One local day's spend on one model. */
export interface UsageBucket {
  /** `YYYY-MM-DD` in the reader's own timezone. */
  day: string;
  provider: AiProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Turns behind these numbers. */
  turns: number;
}

export function recordTokenUsage(usage: UsageInput): Promise<void> {
  return invoke("record_token_usage", { usage });
}

/**
 * Spend over the last `days` days, already grouped by local day and model.
 *
 * Grouped in SQLite rather than here: the alternative is shipping every turn
 * the reader has ever taken across this boundary to add up six numbers.
 */
export function tokenUsage(days: number): Promise<UsageBucket[]> {
  return invoke("token_usage", { days });
}

// ---------------------------------------------------------------------------
// Taking the journal with you
// ---------------------------------------------------------------------------

/** What an import did, so the reader is told rather than left guessing. */
export interface ImportSummary {
  sessions_added: number;
  sessions_updated: number;
  notes_added: number;
  notes_updated: number;
  /**
   * Cases are sealed, so they are only ever added, never updated.
   *
   * Missing from this interface until a reader restored a backup of 26
   * patients and was told "nothing new". The journal had counted them all
   * along; the field the count arrived in did not exist on this side, so
   * `describeImport` could not have reported it however hard it tried.
   */
  cases_added: number;
  /** Already present and not newer — what makes a repeat import visibly a no-op. */
  skipped: number;
}

/**
 * Write the whole journal to a file the reader chooses.
 *
 * No path crosses this boundary in either direction on the way *in*: Rust opens
 * the dialog itself, because a command that accepted a path would hand the
 * renderer a general "write anywhere on this disk" capability. The path comes
 * back only so the UI can say where it went. `null` means cancelled.
 */
export function exportJournal(): Promise<string | null> {
  return invoke("export_journal");
}

/** Fold a journal file into this one, merging rather than replacing. */
export function importJournal(): Promise<ImportSummary | null> {
  return invoke("import_journal");
}

/**
 * Write a rendered view to a file the reader chooses.
 *
 * Base64 rather than a byte array: a PNG of a full-screen view is a few
 * megabytes, and a few million numbers in a JSON array is not a payload, it is
 * a stall. Rust opens the dialog, so no path crosses this boundary on the way
 * in. `null` means cancelled.
 */
export function saveViewImage(pngBase64: string): Promise<string | null> {
  return invoke("save_view_image", { pngBase64 });
}
