//! The application's own record of what happened to it.
//!
//! # Why this exists
//!
//! Because everything the application knew about its own failures died with
//! the window. A store that had silently fallen back to memory, an engine that
//! refused to start, a journal that migrated — all of it was visible for the
//! length of one session, to nobody, and the reader was left saying "it does
//! not remember my settings" while the reason sat one line away in a console
//! they had no way to open. Finding one such fault from the outside took a
//! morning of reading a browser engine's private files.
//!
//! So the facts are written down, they survive the process, and the reader can
//! hand them over.
//!
//! # What is never written here
//!
//! **No content. Ever.** Not a question, not an answer, not a note, not a
//! patient, not the name of a structure the reader looked at. This application
//! is local and private by design and a log is exactly how that gets undone by
//! accident — a well-meant "log the failing request" and the reader's own words
//! are on disk in a file built to be sent to somebody else. What goes in is what
//! the application did and what went wrong with it: components starting,
//! failing, versions, paths, error codes.
//!
//! The one judgement call is identifiers. A structure id or a model name is
//! about the atlas or the provider rather than about the reader, and is worth
//! the diagnostic value. A session title is the reader's own words and is not.
//!
//! # Why it is bounded, and rewritten rather than rotated
//!
//! An unbounded log on a student's laptop is a slow leak nobody notices until
//! the disk is full. A second file to rotate into is another thing to explain,
//! clean up and get wrong. Instead the file is trimmed in place when it grows
//! past its cap: the oldest half goes, the newest half stays, and the reader
//! keeps what a report would actually need — what happened most recently.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Filename inside the app data directory, beside the journal.
pub const LOG_FILE: &str = "anatria3d.log";

/// How large the file is allowed to grow before its oldest half is dropped.
///
/// Half a megabyte is a few thousand entries — far more history than any report
/// needs, and small enough that reading the whole file to trim it is free.
const MAX_BYTES: u64 = 512 * 1024;

/// The most entries a single read will return.
///
/// The panel shows a tail, not an archive. A cap here means a corrupted or
/// enormous file cannot turn a diagnostic into a hang.
const MAX_READ: usize = 500;

/// How long a single message may be before it is cut.
///
/// Anything longer is a stack trace or a dump, and the first line of those is
/// the part anybody reads.
const MAX_MESSAGE: usize = 1_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogEntry {
    /// Milliseconds since the epoch, so the panel can render it in local time.
    pub at: i64,
    /// `info`, `warn` or `error`. Anything else is recorded as `info`.
    pub level: String,
    /// Which part of the application spoke: `engine`, `storage`, `journal`…
    pub source: String,
    pub message: String,
}

#[derive(Debug)]
pub struct AppLog {
    /// `None` when no writable directory was found. Logging then does nothing,
    /// which is the correct failure: a diagnostic that takes the application
    /// down is worse than no diagnostic.
    path: Option<PathBuf>,
    /// Serialises appends, and the trim that occasionally follows one.
    gate: Mutex<()>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Cut a string to `limit` characters, never mid-character.
fn clamp(value: &str, limit: usize) -> String {
    // Newlines would break the one-entry-per-line format, and a tab reads the
    // same in the panel.
    let flat = value.replace(['\n', '\r'], " ");
    if flat.chars().count() <= limit {
        return flat;
    }
    flat.chars().take(limit).collect::<String>() + "…"
}

impl AppLog {
    /// Open the log beside the journal. Never fails.
    pub fn open(path: &Path) -> Self {
        // The directory is created here rather than assumed: on a first launch
        // nothing has written to it yet, and the first thing worth logging is
        // often something that happened before the journal opened.
        let usable = path
            .parent()
            .map(|dir| fs::create_dir_all(dir).is_ok())
            .unwrap_or(false);

        Self {
            path: usable.then(|| path.to_path_buf()),
            gate: Mutex::new(()),
        }
    }

    /// Where the file is, for the panel to show and the reader to find.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Record one event. Failure to write is swallowed, deliberately.
    pub fn append(&self, level: &str, source: &str, message: &str) {
        let Some(path) = self.path.as_ref() else {
            return;
        };
        let entry = LogEntry {
            at: now_ms(),
            level: match level {
                "warn" | "error" => level.to_string(),
                _ => "info".to_string(),
            },
            source: clamp(source, 40),
            message: clamp(message, MAX_MESSAGE),
        };
        let Ok(line) = serde_json::to_string(&entry) else {
            return;
        };

        let _guard = self.gate.lock();
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
        self.trim(path);
    }

    /// Drop the oldest half once the file passes its cap.
    fn trim(&self, path: &Path) {
        let Ok(meta) = fs::metadata(path) else { return };
        if meta.len() <= MAX_BYTES {
            return;
        }
        let Ok(file) = File::open(path) else { return };
        let lines: Vec<String> = BufReader::new(file).lines().map_while(Result::ok).collect();
        let keep = lines.split_at(lines.len() / 2).1.join("\n");
        // Written whole rather than in place: a half-written trim would lose
        // the file, and this runs rarely enough that the cost is irrelevant.
        let _ = fs::write(path, keep + "\n");
    }

    /// The most recent entries, oldest first, capped at [`MAX_READ`].
    ///
    /// Unparseable lines are skipped rather than reported. A log that refuses
    /// to be read because one line was written during a power cut is a log that
    /// fails exactly when it is needed.
    pub fn read(&self) -> Vec<LogEntry> {
        let Some(path) = self.path.as_ref() else {
            return Vec::new();
        };
        let Ok(file) = File::open(path) else {
            return Vec::new();
        };
        let entries: Vec<LogEntry> = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str(&line).ok())
            .collect();

        let start = entries.len().saturating_sub(MAX_READ);
        entries[start..].to_vec()
    }

    /// Empty the log at the reader's request.
    ///
    /// Truncates rather than deletes, so the next append does not have to
    /// re-create the file and the reader can see it is theirs to clear.
    pub fn clear(&self) -> std::io::Result<()> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        let _guard = self.gate.lock();
        fs::write(path, "")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of its own for each test.
    ///
    /// Not the clock: these run in parallel and several land in the same
    /// millisecond, which had them all writing to one file and counting each
    /// other's entries.
    fn temp_log() -> (AppLog, PathBuf) {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("anatria-log-{}-{unique}", std::process::id()));
        let path = dir.join(LOG_FILE);
        let _ = fs::remove_dir_all(&dir);
        (AppLog::open(&path), path)
    }

    #[test]
    fn records_and_reads_back_in_order() {
        let (log, _) = temp_log();
        log.append("info", "engine", "started");
        log.append("error", "storage", "refused");

        let entries = log.read();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].source, "engine");
        assert_eq!(entries[1].level, "error");
        assert!(entries[0].at > 0, "every entry is stamped");
    }

    #[test]
    fn an_unknown_level_is_recorded_as_info() {
        // The frontend is not the authority on this vocabulary, and a typo
        // must not produce a level the panel has no colour for.
        let (log, _) = temp_log();
        log.append("catastrophe", "engine", "…");
        assert_eq!(log.read()[0].level, "info");
    }

    #[test]
    fn a_newline_cannot_forge_a_second_entry() {
        // One entry per line is the whole format. A message containing a
        // newline would otherwise write a line that parses as its own record.
        let (log, _) = temp_log();
        log.append("info", "engine", "first\n{\"at\":0,\"level\":\"error\"}");
        assert_eq!(log.read().len(), 1);
    }

    #[test]
    fn a_long_message_is_cut_rather_than_stored_whole() {
        let (log, _) = temp_log();
        log.append("error", "engine", &"x".repeat(5_000));
        assert!(log.read()[0].message.chars().count() <= MAX_MESSAGE + 1);
    }

    #[test]
    fn clearing_empties_it_and_leaves_it_usable() {
        let (log, path) = temp_log();
        log.append("info", "engine", "before");
        log.clear().expect("clear");
        assert!(log.read().is_empty(), "nothing survives the clear");
        assert!(path.exists(), "the file itself stays");

        log.append("info", "engine", "after");
        assert_eq!(log.read().len(), 1, "and it still records");
    }

    #[test]
    fn a_corrupt_line_does_not_take_the_rest_with_it() {
        let (log, path) = temp_log();
        log.append("info", "engine", "good");
        {
            let mut file = OpenOptions::new().append(true).open(&path).unwrap();
            writeln!(file, "{{ this is not json").unwrap();
        }
        log.append("info", "engine", "also good");

        assert_eq!(log.read().len(), 2);
    }

    #[test]
    fn it_stays_bounded() {
        let (log, path) = temp_log();
        // Comfortably past the cap: 900 entries of a kilobyte each.
        for _ in 0..900 {
            log.append("info", "engine", &"y".repeat(900));
        }

        let size = fs::metadata(&path).unwrap().len();
        assert!(size <= MAX_BYTES, "trimmed in place, was {size}");
        assert!(!log.read().is_empty(), "and the recent half is still there");
    }

    #[test]
    fn a_directory_it_cannot_create_disables_it_without_failing() {
        // A diagnostic that takes the application down is worse than none.
        let log = AppLog::open(Path::new("\0invalid\0/anatria3d.log"));
        log.append("error", "engine", "nowhere to put this");

        assert!(log.path().is_none());
        assert!(log.read().is_empty());
        assert!(log.clear().is_ok());
    }
}
