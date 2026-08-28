import { invoke } from "@tauri-apps/api/core";

/**
 * The application's own record, from the window's side.
 *
 * # Why the window writes to a file at all
 *
 * Because most of what goes wrong is only visible here. A store that refuses
 * to persist, a manifest that will not load, an answer the schema rejected —
 * none of it reaches Rust on its own, and all of it dies with the window. The
 * console is where it lands today, and a reader has no way to open one.
 *
 * # What must never be written
 *
 * No content: not a question, not an answer, not a note, not a session title.
 * The file exists to be handed to somebody else, and this application's whole
 * claim is that what the reader writes stays on their machine. Identifiers and
 * error codes are the line — a structure id is about the atlas, a model name is
 * about the provider, and a sentence the reader typed is about the reader.
 */

export interface LogEntry {
  /** Milliseconds since the epoch. */
  at: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

/**
 * Record an event. Never throws and never waits.
 *
 * Deliberately fire-and-forget: every call site is somewhere already dealing
 * with a failure, and a diagnostic that can itself fail — or that has to be
 * awaited — is one that gets left out of the paths that need it most.
 */
export function logEvent(
  level: LogEntry["level"],
  source: string,
  message: string,
): void {
  void invoke("log_event", { level, source, message }).catch(() => {
    // Nowhere left to report this, which is the one case where silence is the
    // only option available.
  });
}

export function readLog(): Promise<LogEntry[]> {
  return invoke("read_log");
}

export function logLocation(): Promise<string | null> {
  return invoke("log_location");
}

export function clearLog(): Promise<void> {
  return invoke("clear_log");
}

/** Write a copy wherever the reader chooses. Resolves to the path, or null. */
export function saveLogCopy(contents: string): Promise<string | null> {
  return invoke("save_log_copy", { contents });
}
