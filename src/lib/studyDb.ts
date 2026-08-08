import { invoke } from "@tauri-apps/api/core";

import type { Language, SessionMode, UserProfile } from "./schemas";

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
  kind: SessionMode;
  title: string;
  profile: UserProfile;
  language: Language;
  /** 0–100, present once a case has been graded. */
  score: number | null;
  verdict: string | null;
  message_count: number;
  structure_count: number;
  /** Epoch milliseconds — sortable without parsing, and no date library. */
  created_at: number;
  updated_at: number;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  created_at: number;
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
  kind: SessionMode;
  title: string;
  profile: UserProfile;
  language: Language;
  question: string;
  answer: string;
  organ_ids: string[];
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
  limit = 100,
): Promise<SessionSummary[]> {
  return invoke("list_study_sessions", { query, organId, limit });
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
// Taking the journal with you
// ---------------------------------------------------------------------------

/** What an import did, so the reader is told rather than left guessing. */
export interface ImportSummary {
  sessions_added: number;
  sessions_updated: number;
  notes_added: number;
  notes_updated: number;
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
