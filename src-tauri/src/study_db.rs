//! The study journal: notes, saved sessions and clinical case drills.
//!
//! # Why this is in Rust and not in the sidecar
//!
//! Python already has `sqlite3` in its standard library, so the engine could
//! have owned this. It should not. The engine is the process that holds the
//! user's API key and talks to a model provider, and it is the process we kill
//! and respawn when it crashes. Someone's revision notes want the opposite of
//! both: no network reach, and a lifetime tied to the application rather than
//! to whichever provider is having a bad afternoon.
//!
//! # Degrading instead of failing
//!
//! An unopenable database must not take the atlas down with it. `open` never
//! panics and never returns `Err`; a failure is remembered as
//! [`State::Unavailable`] and surfaces per call, so the viewer, the tree and
//! the assistant all keep working while saving is the only thing broken.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Schema revision, tracked in SQLite's own `user_version` pragma. Bump it and
/// add a step to `migrate` — never edit an existing step, or a database written
/// by a released build becomes unreadable.
const SCHEMA_VERSION: i32 = 2;

/// Marker on an exported journal, so an unrelated `.json` is refused with a
/// sentence rather than a parse error.
pub const EXPORT_FORMAT: &str = "anatria3d.journal";
/// Bumped when the exported shape changes incompatibly.
pub const EXPORT_VERSION: u32 = 1;

const MAX_TITLE: usize = 200;
const MAX_BODY: usize = 20_000;
const MAX_MESSAGE: usize = 100_000;

#[derive(Debug, thiserror::Error)]
pub enum StudyError {
    #[error("the study journal is unavailable: {0}")]
    Unavailable(String),
    #[error("{0}")]
    Invalid(String),
    #[error("study journal error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

impl serde::Serialize for StudyError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, StudyError>;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/// What a session looks like in a list. Deliberately without its messages: the
/// sidebar renders every session the student has, and loading each transcript
/// to show a title would read the whole journal to draw one panel.
#[derive(Debug, Serialize)]
pub struct SessionSummary {
    pub id: String,
    /// `tutor` for an ordinary conversation, `case` for a clinical drill.
    pub kind: String,
    pub title: String,
    pub profile: String,
    pub language: String,
    /// 0–100, present only once a case has been graded.
    pub score: Option<i64>,
    pub verdict: Option<String>,
    pub message_count: i64,
    pub structure_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct SessionDetail {
    pub session: SessionSummary,
    pub messages: Vec<StoredMessage>,
    /// Structures this session touched, so reopening it can restore the scene.
    pub structures: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Note {
    pub id: i64,
    /// Identity that survives leaving this machine — see the schema v2 step.
    pub uuid: String,
    pub organ_id: Option<String>,
    /// The structure's name, copied at write time.
    ///
    /// Denormalised on purpose: notes are listed with the atlas mostly
    /// unloaded, and a note that can only name its subject when the right
    /// system happens to be switched on is a note you cannot browse.
    pub organ_label: Option<String>,
    pub session_id: Option<String>,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Portable journal
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportSession {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub profile: String,
    pub language: String,
    #[serde(default)]
    pub score: Option<i64>,
    #[serde(default)]
    pub verdict: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub messages: Vec<StoredMessage>,
    #[serde(default)]
    pub structures: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportNote {
    pub uuid: String,
    #[serde(default)]
    pub organ_id: Option<String>,
    #[serde(default)]
    pub organ_label: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JournalExport {
    pub format: String,
    pub version: u32,
    pub exported_at: i64,
    #[serde(default)]
    pub sessions: Vec<ExportSession>,
    #[serde(default)]
    pub notes: Vec<ExportNote>,
}

/// What an import actually did, so the reader is told rather than left guessing.
#[derive(Debug, Default, Serialize)]
pub struct ImportSummary {
    pub sessions_added: u32,
    pub sessions_updated: u32,
    pub notes_added: u32,
    pub notes_updated: u32,
    /// Already present and not newer — the count that makes a repeat import
    /// visibly a no-op rather than a silent one.
    pub skipped: u32,
}

#[derive(Debug, Serialize)]
pub struct StudyStats {
    pub sessions: i64,
    pub cases: i64,
    pub graded_cases: i64,
    pub notes: i64,
    pub average_score: Option<f64>,
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// One completed exchange, saved as it finishes.
///
/// The session row is upserted rather than created separately: a turn is the
/// only thing worth persisting, so there is no window in which an empty session
/// exists because the user opened a panel and typed nothing.
#[derive(Debug, Deserialize)]
pub struct TurnInput {
    pub session_id: String,
    pub kind: String,
    pub title: String,
    pub profile: String,
    pub language: String,
    pub question: String,
    pub answer: String,
    /// Structures the student had selected — the index behind "what have I
    /// studied about the left ventricle?".
    pub organ_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct NoteInput {
    pub organ_id: Option<String>,
    pub organ_label: Option<String>,
    pub session_id: Option<String>,
    pub body: String,
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

enum State {
    Ready(Box<Connection>),
    /// Why the journal could not be opened, kept so every call can say so
    /// rather than reporting a generic failure.
    Unavailable(String),
}

pub struct StudyDb(Mutex<State>);

impl StudyDb {
    /// Open (or create) the journal beside the application's other data.
    ///
    /// Infallible by design — see the module header.
    pub fn open(path: &Path) -> Self {
        Self(Mutex::new(match Self::connect(path) {
            Ok(conn) => State::Ready(Box::new(conn)),
            Err(err) => {
                eprintln!("[study] {err}");
                State::Unavailable(err.to_string())
            }
        }))
    }

    /// In-memory journal, for tests.
    #[cfg(test)]
    pub fn in_memory() -> Self {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("pragmas");
        migrate(&mut conn).expect("migrate");
        Self(Mutex::new(State::Ready(Box::new(conn))))
    }

    fn connect(path: &Path) -> std::result::Result<Connection, Box<dyn std::error::Error>> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(path)?;
        // WAL so a long read (listing sessions) never blocks the write that
        // saves the turn the student just finished. `foreign_keys` is off by
        // default in SQLite, and the ON DELETE CASCADE below is load-bearing.
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        migrate(&mut conn)?;
        Ok(conn)
    }

    fn with<T>(&self, run: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| StudyError::Unavailable("journal lock poisoned".into()))?;
        match &mut *guard {
            State::Ready(conn) => run(conn),
            State::Unavailable(reason) => Err(StudyError::Unavailable(reason.clone())),
        }
    }

    // -- sessions ----------------------------------------------------------

    pub fn save_turn(&self, turn: TurnInput) -> Result<()> {
        let id = require(&turn.session_id, "session_id")?;
        let kind = match turn.kind.as_str() {
            "tutor" | "case" => turn.kind.clone(),
            other => return Err(StudyError::Invalid(format!("unknown session kind {other:?}"))),
        };
        let question = clamp(&turn.question, MAX_MESSAGE);
        let answer = clamp(&turn.answer, MAX_MESSAGE);
        if question.is_empty() && answer.is_empty() {
            return Err(StudyError::Invalid("nothing to save in this turn".into()));
        }
        let title = fallback_title(&turn.title, &question);
        let now = now_ms();

        self.with(|conn| {
            let tx = conn.transaction()?;
            // The title is only written on insert. Renaming a session must
            // survive the next turn, and re-deriving it from the first question
            // every time would quietly undo the rename.
            tx.execute(
                "INSERT INTO study_session
                     (id, kind, title, profile, language, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(id) DO UPDATE SET updated_at = ?6",
                params![id, kind, title, turn.profile, turn.language, now],
            )?;

            for (role, content) in [("user", &question), ("assistant", &answer)] {
                if content.is_empty() {
                    continue;
                }
                tx.execute(
                    "INSERT INTO study_message (session_id, role, content, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![id, role, content, now],
                )?;
            }

            for organ_id in &turn.organ_ids {
                let organ_id = organ_id.trim();
                if organ_id.is_empty() {
                    continue;
                }
                tx.execute(
                    "INSERT OR IGNORE INTO session_structure (session_id, organ_id)
                     VALUES (?1, ?2)",
                    params![id, organ_id],
                )?;
            }

            tx.commit()?;
            Ok(())
        })
    }

    /// Attach a grade to a case drill.
    pub fn record_case_result(&self, session_id: &str, score: i64, verdict: &str) -> Result<()> {
        let id = require(session_id, "session_id")?;
        if !(0..=100).contains(&score) {
            return Err(StudyError::Invalid(format!(
                "score must be between 0 and 100, got {score}"
            )));
        }
        let verdict = clamp(verdict, MAX_BODY);
        self.with(|conn| {
            let changed = conn.execute(
                "UPDATE study_session SET score = ?2, verdict = ?3, updated_at = ?4
                 WHERE id = ?1",
                params![id, score, verdict, now_ms()],
            )?;
            if changed == 0 {
                // The grade arrives from the engine, which knows nothing about
                // what the journal holds. Silently dropping it would leave a
                // drill that looks ungraded for no visible reason.
                return Err(StudyError::Invalid(format!("no session {id:?} to grade")));
            }
            Ok(())
        })
    }

    /// Sessions, newest first.
    ///
    /// Both filters are optional and compose in SQL rather than in the caller:
    /// narrowing to a structure and then searching the text within it is the
    /// natural follow-up question ("what did I say about the aorta and
    /// dissection?"), and splitting them into two commands would make it
    /// unanswerable.
    pub fn list_sessions(
        &self,
        query: Option<&str>,
        organ_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<SessionSummary>> {
        let limit = limit.clamp(1, 500);
        let filter = query.map(like_pattern);
        let organ = blank_to_none(organ_id);

        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.id, s.kind, s.title, s.profile, s.language, s.score, s.verdict,
                        (SELECT COUNT(*) FROM study_message m WHERE m.session_id = s.id),
                        (SELECT COUNT(*) FROM session_structure x WHERE x.session_id = s.id),
                        s.created_at, s.updated_at
                 FROM study_session s
                 WHERE (?1 IS NULL
                        OR s.title LIKE ?1 ESCAPE '\\'
                        OR EXISTS (SELECT 1 FROM study_message m
                                   WHERE m.session_id = s.id
                                     AND m.content LIKE ?1 ESCAPE '\\'))
                   AND (?2 IS NULL
                        OR EXISTS (SELECT 1 FROM session_structure x
                                   WHERE x.session_id = s.id AND x.organ_id = ?2))
                 ORDER BY s.updated_at DESC
                 LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![filter, organ, limit], read_summary)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    pub fn session(&self, session_id: &str) -> Result<Option<SessionDetail>> {
        let id = require(session_id, "session_id")?;
        self.with(|conn| {
            let session = conn
                .query_row(
                    "SELECT s.id, s.kind, s.title, s.profile, s.language, s.score, s.verdict,
                            (SELECT COUNT(*) FROM study_message m WHERE m.session_id = s.id),
                            (SELECT COUNT(*) FROM session_structure x WHERE x.session_id = s.id),
                            s.created_at, s.updated_at
                     FROM study_session s WHERE s.id = ?1",
                    params![id],
                    read_summary,
                )
                .optional()?;
            let Some(session) = session else {
                return Ok(None);
            };

            let mut stmt = conn.prepare(
                "SELECT role, content, created_at FROM study_message
                 WHERE session_id = ?1 ORDER BY id",
            )?;
            let messages = stmt
                .query_map(params![id], |row| {
                    Ok(StoredMessage {
                        role: row.get(0)?,
                        content: row.get(1)?,
                        created_at: row.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut stmt = conn.prepare(
                "SELECT organ_id FROM session_structure WHERE session_id = ?1 ORDER BY organ_id",
            )?;
            let structures = stmt
                .query_map(params![id], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(Some(SessionDetail {
                session,
                messages,
                structures,
            }))
        })
    }

    pub fn rename_session(&self, session_id: &str, title: &str) -> Result<()> {
        let id = require(session_id, "session_id")?;
        let title = clamp(title, MAX_TITLE);
        if title.is_empty() {
            return Err(StudyError::Invalid("a session needs a title".into()));
        }
        self.with(|conn| {
            conn.execute(
                "UPDATE study_session SET title = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, title, now_ms()],
            )?;
            Ok(())
        })
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let id = require(session_id, "session_id")?;
        self.with(|conn| {
            conn.execute("DELETE FROM study_session WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    // -- notes -------------------------------------------------------------

    pub fn create_note(&self, input: NoteInput) -> Result<Note> {
        let body = clamp(&input.body, MAX_BODY);
        if body.is_empty() {
            return Err(StudyError::Invalid("a note needs a body".into()));
        }
        let now = now_ms();
        self.with(|conn| {
            conn.execute(
                "INSERT INTO note
                     (uuid, organ_id, organ_label, session_id, body, created_at, updated_at)
                 VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    blank_to_none(input.organ_id.as_deref()),
                    blank_to_none(input.organ_label.as_deref()),
                    blank_to_none(input.session_id.as_deref()),
                    body,
                    now
                ],
            )?;
            let id = conn.last_insert_rowid();
            let uuid: String =
                conn.query_row("SELECT uuid FROM note WHERE id = ?1", params![id], |row| {
                    row.get(0)
                })?;
            Ok(Note {
                id,
                uuid,
                organ_id: blank_to_none(input.organ_id.as_deref()),
                organ_label: blank_to_none(input.organ_label.as_deref()),
                session_id: blank_to_none(input.session_id.as_deref()),
                body,
                created_at: now,
                updated_at: now,
            })
        })
    }

    pub fn update_note(&self, id: i64, body: &str) -> Result<()> {
        let body = clamp(body, MAX_BODY);
        if body.is_empty() {
            return Err(StudyError::Invalid("a note needs a body".into()));
        }
        self.with(|conn| {
            let changed = conn.execute(
                "UPDATE note SET body = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, body, now_ms()],
            )?;
            if changed == 0 {
                return Err(StudyError::Invalid(format!("no note {id}")));
            }
            Ok(())
        })
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        self.with(|conn| {
            conn.execute("DELETE FROM note WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    /// Notes, newest first. `organ_id` narrows to one structure, `query` does a
    /// substring match on the body; both are optional and compose.
    pub fn list_notes(
        &self,
        organ_id: Option<&str>,
        query: Option<&str>,
        limit: i64,
    ) -> Result<Vec<Note>> {
        let limit = limit.clamp(1, 500);
        let organ = blank_to_none(organ_id);
        let filter = query.map(like_pattern);
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, uuid, organ_id, organ_label, session_id, body,
                        created_at, updated_at
                 FROM note
                 WHERE (?1 IS NULL OR organ_id = ?1)
                   AND (?2 IS NULL OR body LIKE ?2 ESCAPE '\\')
                 ORDER BY updated_at DESC
                 LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![organ, filter, limit], |row| {
                Ok(Note {
                    id: row.get(0)?,
                    uuid: row.get(1)?,
                    organ_id: row.get(2)?,
                    organ_label: row.get(3)?,
                    session_id: row.get(4)?,
                    body: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    // -- portability -------------------------------------------------------

    /// The whole journal, in a form that can be carried to another machine.
    ///
    /// JSON rather than a copy of the database file. A `.db` copy cannot be
    /// merged into an existing journal, breaks the moment the two machines are
    /// on different schema versions, and is opaque to anyone who wants to know
    /// what they are about to hand to a class.
    pub fn export(&self) -> Result<JournalExport> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, title, profile, language, score, verdict,
                        created_at, updated_at
                 FROM study_session ORDER BY created_at",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(ExportSession {
                        id: row.get(0)?,
                        kind: row.get(1)?,
                        title: row.get(2)?,
                        profile: row.get(3)?,
                        language: row.get(4)?,
                        score: row.get(5)?,
                        verdict: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                        messages: Vec::new(),
                        structures: Vec::new(),
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut sessions = rows;
            let mut messages = conn.prepare(
                "SELECT role, content, created_at FROM study_message
                 WHERE session_id = ?1 ORDER BY id",
            )?;
            let mut structures =
                conn.prepare("SELECT organ_id FROM session_structure WHERE session_id = ?1")?;
            for session in &mut sessions {
                session.messages = messages
                    .query_map(params![session.id], |row| {
                        Ok(StoredMessage {
                            role: row.get(0)?,
                            content: row.get(1)?,
                            created_at: row.get(2)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                session.structures = structures
                    .query_map(params![session.id], |row| row.get(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
            }

            let mut stmt = conn.prepare(
                "SELECT uuid, organ_id, organ_label, session_id, body,
                        created_at, updated_at
                 FROM note ORDER BY created_at",
            )?;
            let notes = stmt
                .query_map([], |row| {
                    Ok(ExportNote {
                        uuid: row.get(0)?,
                        organ_id: row.get(1)?,
                        organ_label: row.get(2)?,
                        session_id: row.get(3)?,
                        body: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(JournalExport {
                format: EXPORT_FORMAT.to_owned(),
                version: EXPORT_VERSION,
                exported_at: now_ms(),
                sessions,
                notes,
            })
        })
    }

    /// Fold an exported journal into this one.
    ///
    /// **Merge, never replace.** Someone importing on a second machine is
    /// adding their history to it, not throwing away what is already there —
    /// and re-importing the same file has to be a no-op, or a student who
    /// double-clicks twice doubles their journal.
    ///
    /// Sessions are keyed by their id, which was a UUID from the start. Notes
    /// are keyed by the uuid added in schema v2. Both resolve conflicts by
    /// keeping the version that was edited last.
    pub fn import(&self, incoming: JournalExport) -> Result<ImportSummary> {
        if incoming.format != EXPORT_FORMAT {
            return Err(StudyError::Invalid(
                "That file is not an Anatria3D study journal.".into(),
            ));
        }
        if incoming.version > EXPORT_VERSION {
            return Err(StudyError::Invalid(format!(
                "That journal was written by a newer version of Anatria3D \
                 (format {}, this build reads {}). Update the app and try again.",
                incoming.version, EXPORT_VERSION
            )));
        }

        let mut summary = ImportSummary::default();
        self.with(|conn| {
            let tx = conn.transaction()?;

            for session in &incoming.sessions {
                let existing: Option<(i64, i64)> = tx
                    .query_row(
                        "SELECT updated_at,
                                (SELECT COUNT(*) FROM study_message m
                                 WHERE m.session_id = s.id)
                         FROM study_session s WHERE s.id = ?1",
                        params![session.id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?;

                let kind = match session.kind.as_str() {
                    "tutor" | "case" => session.kind.as_str(),
                    // Refusing the whole file over one odd row would lose the
                    // rest of somebody's history for nothing.
                    _ => {
                        summary.skipped += 1;
                        continue;
                    }
                };

                match existing {
                    None => {
                        tx.execute(
                            "INSERT INTO study_session
                                 (id, kind, title, profile, language, score, verdict,
                                  created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                            params![
                                session.id,
                                kind,
                                clamp(&session.title, MAX_TITLE),
                                session.profile,
                                session.language,
                                session.score,
                                session.verdict,
                                session.created_at,
                                session.updated_at,
                            ],
                        )?;
                        write_messages(&tx, session)?;
                        summary.sessions_added += 1;
                    }
                    // A conversation only grows, so "more messages" is the
                    // reliable sign that the incoming copy is the later one —
                    // more reliable than a timestamp, which also moves when a
                    // case is graded or a title is changed.
                    Some((_, existing_messages))
                        if session.messages.len() as i64 > existing_messages =>
                    {
                        tx.execute(
                            "DELETE FROM study_message WHERE session_id = ?1",
                            params![session.id],
                        )?;
                        write_messages(&tx, session)?;
                        tx.execute(
                            "UPDATE study_session
                             SET title = ?2, score = COALESCE(?3, score),
                                 verdict = COALESCE(?4, verdict), updated_at = ?5
                             WHERE id = ?1",
                            params![
                                session.id,
                                clamp(&session.title, MAX_TITLE),
                                session.score,
                                session.verdict,
                                session.updated_at,
                            ],
                        )?;
                        summary.sessions_updated += 1;
                    }
                    Some(_) => {
                        // A grade may have arrived on the other machine even
                        // when the transcript did not grow.
                        if session.score.is_some() {
                            tx.execute(
                                "UPDATE study_session
                                 SET score = COALESCE(score, ?2),
                                     verdict = COALESCE(verdict, ?3)
                                 WHERE id = ?1",
                                params![session.id, session.score, session.verdict],
                            )?;
                        }
                        summary.skipped += 1;
                    }
                }

                for organ_id in &session.structures {
                    tx.execute(
                        "INSERT OR IGNORE INTO session_structure (session_id, organ_id)
                         VALUES (?1, ?2)",
                        params![session.id, organ_id],
                    )?;
                }
            }

            for note in &incoming.notes {
                let body = clamp(&note.body, MAX_BODY);
                if body.is_empty() || note.uuid.trim().is_empty() {
                    summary.skipped += 1;
                    continue;
                }

                // A note may name a session that never made it here — the file
                // could predate a deletion. The foreign key would reject it, so
                // it becomes a note without a conversation rather than a
                // failure that loses the note.
                let session_id = match note.session_id.as_deref() {
                    Some(id)
                        if tx
                            .query_row(
                                "SELECT 1 FROM study_session WHERE id = ?1",
                                params![id],
                                |_| Ok(()),
                            )
                            .optional()?
                            .is_some() =>
                    {
                        Some(id)
                    }
                    _ => None,
                };

                let existing: Option<i64> = tx
                    .query_row(
                        "SELECT updated_at FROM note WHERE uuid = ?1",
                        params![note.uuid],
                        |row| row.get(0),
                    )
                    .optional()?;

                match existing {
                    None => {
                        tx.execute(
                            "INSERT INTO note
                                 (uuid, organ_id, organ_label, session_id, body,
                                  created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                            params![
                                note.uuid,
                                note.organ_id,
                                note.organ_label,
                                session_id,
                                body,
                                note.created_at,
                                note.updated_at,
                            ],
                        )?;
                        summary.notes_added += 1;
                    }
                    Some(mine) if note.updated_at > mine => {
                        tx.execute(
                            "UPDATE note
                             SET organ_id = ?2, organ_label = ?3, session_id = ?4,
                                 body = ?5, updated_at = ?6
                             WHERE uuid = ?1",
                            params![
                                note.uuid,
                                note.organ_id,
                                note.organ_label,
                                session_id,
                                body,
                                note.updated_at,
                            ],
                        )?;
                        summary.notes_updated += 1;
                    }
                    Some(_) => summary.skipped += 1,
                }
            }

            tx.commit()?;
            Ok(())
        })?;

        Ok(summary)
    }

    // -- progress ----------------------------------------------------------

    pub fn stats(&self) -> Result<StudyStats> {
        self.with(|conn| {
            let row = conn.query_row(
                "SELECT
                     (SELECT COUNT(*) FROM study_session),
                     (SELECT COUNT(*) FROM study_session WHERE kind = 'case'),
                     (SELECT COUNT(*) FROM study_session WHERE score IS NOT NULL),
                     (SELECT COUNT(*) FROM note),
                     (SELECT AVG(score) FROM study_session WHERE score IS NOT NULL)",
                [],
                |row| {
                    Ok(StudyStats {
                        sessions: row.get(0)?,
                        cases: row.get(1)?,
                        graded_cases: row.get(2)?,
                        notes: row.get(3)?,
                        average_score: row.get(4)?,
                    })
                },
            )?;
            Ok(row)
        })
    }

    /// How much attention each structure has had, for painting the atlas with
    /// the reader's own revision.
    ///
    /// A note counts and so does appearing in a session, and they are added
    /// rather than reported apart. The question this answers is "have I been
    /// here", and a student who worked through the mediastinum for an hour
    /// without writing anything down has been there.
    ///
    /// One query rather than a join because the two tables have nothing to join
    /// on — they are two independent records of the same visit. `UNION ALL`,
    /// not `UNION`: collapsing duplicates would turn twelve notes on the heart
    /// into one.
    ///
    /// Structures the reader has never touched are simply absent. Returning a
    /// zero for each of three and a half thousand would be a payload made
    /// almost entirely of nothing.
    pub fn coverage(&self) -> Result<Vec<StudyCoverage>> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT organ_id, COUNT(*) AS touches FROM (
                     SELECT organ_id FROM note WHERE organ_id IS NOT NULL
                     UNION ALL
                     SELECT organ_id FROM session_structure
                 )
                 GROUP BY organ_id
                 ORDER BY touches DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(StudyCoverage {
                    organ_id: row.get(0)?,
                    touches: row.get(1)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
        })
    }
}

/// One structure, and how often the reader has worked on it.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StudyCoverage {
    pub organ_id: String,
    pub touches: i64,
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }

    // Steps are additive and never edited: a database written by a released
    // build has to keep opening.
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE study_session (
                 id         TEXT PRIMARY KEY,
                 kind       TEXT NOT NULL CHECK (kind IN ('tutor', 'case')),
                 title      TEXT NOT NULL,
                 profile    TEXT NOT NULL,
                 language   TEXT NOT NULL,
                 score      INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
                 verdict    TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE INDEX idx_session_recent ON study_session(updated_at DESC);

             CREATE TABLE study_message (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                 content    TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX idx_message_session ON study_message(session_id, id);

             CREATE TABLE session_structure (
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 organ_id   TEXT NOT NULL,
                 PRIMARY KEY (session_id, organ_id)
             );
             CREATE INDEX idx_structure_organ ON session_structure(organ_id);

             CREATE TABLE note (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 organ_id    TEXT,
                 organ_label TEXT,
                 session_id  TEXT REFERENCES study_session(id) ON DELETE SET NULL,
                 body        TEXT NOT NULL,
                 created_at  INTEGER NOT NULL,
                 updated_at  INTEGER NOT NULL
             );
             CREATE INDEX idx_note_organ ON note(organ_id);
             CREATE INDEX idx_note_recent ON note(updated_at DESC);",
        )?;
    }

    if version < 2 {
        // Notes need an identity that survives leaving this machine. The
        // rowid does not: two laptops both call their first note 1, so
        // merging an imported journal on rowid would collide every note
        // against an unrelated one. `randomblob` gives us a UUID-shaped key
        // from SQLite itself, with no crate to add.
        //
        // It cannot be a column DEFAULT — SQLite requires those to be
        // constant — so it is generated at each INSERT and backfilled here.
        conn.execute_batch(
            "ALTER TABLE note ADD COLUMN uuid TEXT;
             UPDATE note SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
             CREATE UNIQUE INDEX idx_note_uuid ON note(uuid);",
        )?;
    }

    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Write a session's transcript, rejecting a role the schema would not accept.
fn write_messages(tx: &rusqlite::Transaction<'_>, session: &ExportSession) -> rusqlite::Result<()> {
    for message in &session.messages {
        if message.role != "user" && message.role != "assistant" {
            continue;
        }
        tx.execute(
            "INSERT INTO study_message (session_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session.id,
                message.role,
                clamp(&message.content, MAX_MESSAGE),
                message.created_at
            ],
        )?;
    }
    Ok(())
}

fn read_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        profile: row.get(3)?,
        language: row.get(4)?,
        score: row.get(5)?,
        verdict: row.get(6)?,
        message_count: row.get(7)?,
        structure_count: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn require(value: &str, field: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(StudyError::Invalid(format!("{field} is required")));
    }
    Ok(trimmed.to_owned())
}

/// Trim, then cut to a byte budget without splitting a UTF-8 character.
///
/// Cyrillic is two bytes per character, so a naive `[..max]` would panic on
/// exactly the content this app is built to hold.
fn clamp(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= max {
        return trimmed.to_owned();
    }
    let mut end = max;
    while end > 0 && !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    trimmed[..end].to_owned()
}

fn blank_to_none(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Wrap a user's search term for `LIKE`, escaping the wildcards so a note
/// containing a literal `%` is still findable.
fn like_pattern(query: &str) -> String {
    let escaped = query
        .trim()
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// Sessions are titled from their first question. An empty title is not worth
/// rejecting a save over — the student still wants the turn kept.
fn fallback_title(title: &str, question: &str) -> String {
    let title = clamp(title, MAX_TITLE);
    if !title.is_empty() {
        return title;
    }
    let derived = clamp(question, 80);
    if derived.is_empty() {
        "Untitled session".to_owned()
    } else {
        derived
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(session_id: &str, question: &str, answer: &str) -> TurnInput {
        TurnInput {
            session_id: session_id.into(),
            kind: "tutor".into(),
            title: question.into(),
            profile: "student".into(),
            language: "es".into(),
            question: question.into(),
            answer: answer.into(),
            organ_ids: vec![],
        }
    }

    #[test]
    fn coverage_counts_notes_and_sessions_together() {
        // "Have I been here" is the question, and an hour working through the
        // mediastinum counts even if nothing was written down.
        let db = StudyDb::in_memory();
        let mut studied = turn("s1", "The heart?", "Yes.");
        studied.organ_ids = vec!["left_ventricle".into(), "aorta".into()];
        db.save_turn(studied).unwrap();
        db.create_note(NoteInput {
            organ_id: Some("left_ventricle".into()),
            organ_label: Some("Ventriculus sinister".into()),
            session_id: None,
            body: "Thickest wall.".into(),
        })
        .unwrap();

        let coverage = db.coverage().unwrap();
        let ventricle = coverage
            .iter()
            .find(|row| row.organ_id == "left_ventricle")
            .unwrap();
        // One session and one note, added rather than reported apart.
        assert_eq!(ventricle.touches, 2);
        assert_eq!(
            coverage.iter().find(|row| row.organ_id == "aorta").unwrap().touches,
            1
        );
    }

    #[test]
    fn coverage_does_not_collapse_repeated_work() {
        // `UNION` instead of `UNION ALL` would turn twelve notes on the heart
        // into one, and the map would show a glance and a term's revision the
        // same shade.
        let db = StudyDb::in_memory();
        for body in ["First thought.", "Second thought.", "Third."] {
            db.create_note(NoteInput {
                organ_id: Some("left_ventricle".into()),
                organ_label: Some("Ventriculus sinister".into()),
                session_id: None,
                body: body.into(),
            })
            .unwrap();
        }

        let coverage = db.coverage().unwrap();
        assert_eq!(coverage.len(), 1);
        assert_eq!(coverage[0].touches, 3);
    }

    #[test]
    fn coverage_leaves_out_what_was_never_studied() {
        // Absence is the answer. A zero for each of three and a half thousand
        // structures would be a payload made almost entirely of nothing — and
        // the gaps are exactly what the map is for.
        let db = StudyDb::in_memory();
        db.create_note(NoteInput {
            organ_id: None,
            organ_label: None,
            session_id: None,
            body: "Revise the conduction system.".into(),
        })
        .unwrap();

        assert!(db.coverage().unwrap().is_empty());
    }

    #[test]
    fn a_turn_creates_its_session() {
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "What does the left ventricle do?", "It pumps."))
            .unwrap();

        let sessions = db.list_sessions(None, None, 50).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].message_count, 2);
        assert_eq!(sessions[0].title, "What does the left ventricle do?");
    }

    #[test]
    fn later_turns_append_to_the_same_session() {
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "First?", "One.")).unwrap();
        db.save_turn(turn("s1", "Second?", "Two.")).unwrap();

        let detail = db.session("s1").unwrap().unwrap();
        assert_eq!(detail.messages.len(), 4);
        // Order is what makes a transcript replayable.
        assert_eq!(detail.messages[0].content, "First?");
        assert_eq!(detail.messages[3].content, "Two.");
    }

    #[test]
    fn renaming_survives_the_next_turn() {
        // The title is derived from the first question, so a save that
        // re-derived it would silently undo the student's rename.
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "First?", "One.")).unwrap();
        db.rename_session("s1", "Cardiac cycle").unwrap();
        db.save_turn(turn("s1", "Second?", "Two.")).unwrap();

        assert_eq!(db.session("s1").unwrap().unwrap().session.title, "Cardiac cycle");
    }

    #[test]
    fn structures_index_the_sessions_that_studied_them() {
        let db = StudyDb::in_memory();
        let mut first = turn("s1", "Compare these", "Sure.");
        first.organ_ids = vec!["left_ventricle".into(), "right_atrium".into()];
        db.save_turn(first).unwrap();

        let mut second = turn("s2", "And this?", "Yes.");
        second.organ_ids = vec!["right_atrium".into()];
        db.save_turn(second).unwrap();

        let found = db.list_sessions(None, Some("right_atrium"), 50).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(
            db.list_sessions(None, Some("left_ventricle"), 50).unwrap().len(),
            1
        );
    }

    #[test]
    fn the_same_structure_twice_in_one_session_is_recorded_once() {
        let db = StudyDb::in_memory();
        for _ in 0..2 {
            let mut input = turn("s1", "Again", "Again.");
            input.organ_ids = vec!["aorta".into()];
            db.save_turn(input).unwrap();
        }
        assert_eq!(db.session("s1").unwrap().unwrap().structures, vec!["aorta"]);
    }

    #[test]
    fn deleting_a_session_takes_its_messages_with_it() {
        // Guards the `PRAGMA foreign_keys = ON` that makes ON DELETE CASCADE
        // real — SQLite ignores the clause without it.
        let db = StudyDb::in_memory();
        let mut input = turn("s1", "Q", "A");
        input.organ_ids = vec!["aorta".into()];
        db.save_turn(input).unwrap();
        db.delete_session("s1").unwrap();

        assert!(db.session("s1").unwrap().is_none());
        assert!(db.list_sessions(None, Some("aorta"), 50).unwrap().is_empty());
    }

    #[test]
    fn a_case_can_be_graded() {
        let db = StudyDb::in_memory();
        let mut input = turn("c1", "Manage this patient", "Here is the case.");
        input.kind = "case".into();
        db.save_turn(input).unwrap();
        db.record_case_result("c1", 72, "Solid on the anatomy, thin on timing.")
            .unwrap();

        let stats = db.stats().unwrap();
        assert_eq!(stats.cases, 1);
        assert_eq!(stats.graded_cases, 1);
        assert_eq!(stats.average_score, Some(72.0));
    }

    #[test]
    fn grading_a_session_that_is_not_there_is_an_error() {
        // The grade comes from the engine, which cannot see the journal.
        // Swallowing it would leave a drill looking ungraded for no reason.
        let db = StudyDb::in_memory();
        assert!(db.record_case_result("nope", 50, "…").is_err());
    }

    #[test]
    fn a_score_outside_the_scale_is_rejected() {
        let db = StudyDb::in_memory();
        let mut input = turn("c1", "Case", "Brief.");
        input.kind = "case".into();
        db.save_turn(input).unwrap();
        assert!(db.record_case_result("c1", 140, "…").is_err());
    }

    #[test]
    fn notes_filter_by_structure_and_by_text() {
        let db = StudyDb::in_memory();
        db.create_note(NoteInput {
            organ_id: Some("left_ventricle".into()),
            organ_label: Some("Ventriculus sinister".into()),
            session_id: None,
            body: "Wall thickness ~10 mm".into(),
        })
        .unwrap();
        db.create_note(NoteInput {
            organ_id: Some("aorta".into()),
            organ_label: Some("Aorta".into()),
            session_id: None,
            body: "Three layers".into(),
        })
        .unwrap();

        assert_eq!(db.list_notes(Some("aorta"), None, 50).unwrap().len(), 1);
        assert_eq!(db.list_notes(None, Some("layers"), 50).unwrap().len(), 1);
        assert_eq!(db.list_notes(None, None, 50).unwrap().len(), 2);
    }

    #[test]
    fn a_note_keeps_its_structure_name() {
        // The atlas is mostly unloaded when notes are browsed, so the label has
        // to travel with the note rather than be looked up.
        let db = StudyDb::in_memory();
        let note = db
            .create_note(NoteInput {
                organ_id: Some("left_ventricle".into()),
                organ_label: Some("Ventriculus sinister".into()),
                session_id: None,
                body: "Note".into(),
            })
            .unwrap();
        assert_eq!(note.organ_label.as_deref(), Some("Ventriculus sinister"));
    }

    #[test]
    fn an_empty_note_is_refused() {
        let db = StudyDb::in_memory();
        assert!(db
            .create_note(NoteInput {
                organ_id: None,
                organ_label: None,
                session_id: None,
                body: "   ".into(),
            })
            .is_err());
    }

    #[test]
    fn searching_matches_the_transcript_not_just_the_title() {
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "Tell me about the heart", "The myocardium is thick."))
            .unwrap();

        assert_eq!(db.list_sessions(Some("myocardium"), None, 50).unwrap().len(), 1);
        assert_eq!(db.list_sessions(Some("pancreas"), None, 50).unwrap().len(), 0);
    }

    #[test]
    fn the_two_session_filters_compose() {
        // "What did I say about the aorta, on the subject of dissection?" is
        // one question. Applying only one filter would answer a different one.
        let db = StudyDb::in_memory();
        let mut aortic = turn("s1", "Aortic dissection", "The intima tears.");
        aortic.organ_ids = vec!["aorta".into()];
        db.save_turn(aortic).unwrap();

        let mut cardiac = turn("s2", "Aortic valve anatomy", "Three cusps.");
        cardiac.organ_ids = vec!["aorta".into()];
        db.save_turn(cardiac).unwrap();

        let mut elsewhere = turn("s3", "Carotid dissection", "Similar mechanism.");
        elsewhere.organ_ids = vec!["carotid".into()];
        db.save_turn(elsewhere).unwrap();

        let hits = db
            .list_sessions(Some("dissection"), Some("aorta"), 50)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "s1");
    }

    #[test]
    fn a_wildcard_in_a_search_is_a_literal() {
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "Stenosis 50% severity", "Noted.")).unwrap();
        db.save_turn(turn("s2", "Unrelated", "Noted.")).unwrap();

        // Unescaped, "%" would match every session.
        assert_eq!(db.list_sessions(Some("50%"), None, 50).unwrap().len(), 1);
    }

    #[test]
    fn cyrillic_survives_the_length_clamp() {
        // Two bytes per character: a naive byte slice would panic mid-character
        // on exactly the language this app targets first.
        let long = "я".repeat(MAX_BODY);
        let clamped = clamp(&long, MAX_BODY);
        assert!(clamped.len() <= MAX_BODY);
        assert!(clamped.chars().all(|c| c == 'я'));
    }

    // -- taking the journal to another machine -----------------------------

    fn note(db: &StudyDb, body: &str) -> Note {
        db.create_note(NoteInput {
            organ_id: Some("aorta".into()),
            organ_label: Some("Aorta".into()),
            session_id: None,
            body: body.into(),
        })
        .unwrap()
    }

    /// A journal with one session and one note, as a second machine would see it.
    fn populated() -> StudyDb {
        let db = StudyDb::in_memory();
        let mut input = turn("s1", "What does the aorta do?", "It carries blood.");
        input.organ_ids = vec!["aorta".into()];
        db.save_turn(input).unwrap();
        note(&db, "Three layers: intima, media, adventitia");
        db
    }

    #[test]
    fn a_journal_round_trips_into_an_empty_machine() {
        let source = populated();
        let exported = source.export().unwrap();

        let fresh = StudyDb::in_memory();
        let summary = fresh.import(exported).unwrap();

        assert_eq!(summary.sessions_added, 1);
        assert_eq!(summary.notes_added, 1);
        let detail = fresh.session("s1").unwrap().unwrap();
        assert_eq!(detail.messages.len(), 2);
        assert_eq!(detail.structures, vec!["aorta"]);
        assert_eq!(fresh.list_notes(None, None, 50).unwrap()[0].body, "Three layers: intima, media, adventitia");
    }

    #[test]
    fn importing_the_same_file_twice_changes_nothing() {
        // Someone will double-click it. Doubling their journal would be the
        // worst possible answer.
        let source = populated();
        let fresh = StudyDb::in_memory();
        fresh.import(source.export().unwrap()).unwrap();

        let second = fresh.import(source.export().unwrap()).unwrap();
        assert_eq!(second.sessions_added, 0);
        assert_eq!(second.notes_added, 0);
        assert!(second.skipped >= 2);
        assert_eq!(fresh.list_notes(None, None, 50).unwrap().len(), 1);
        assert_eq!(fresh.stats().unwrap().sessions, 1);
    }

    #[test]
    fn importing_merges_instead_of_replacing() {
        // The whole point: arriving at a second machine adds your history to
        // what is there, it does not overwrite it.
        let source = populated();
        let target = StudyDb::in_memory();
        target.save_turn(turn("local", "Local question", "Local answer")).unwrap();
        note(&target, "A note written on this machine");

        target.import(source.export().unwrap()).unwrap();

        assert_eq!(target.stats().unwrap().sessions, 2);
        assert_eq!(target.list_notes(None, None, 50).unwrap().len(), 2);
    }

    #[test]
    fn the_later_edit_of_a_note_wins() {
        let source = populated();
        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        // Edited on the other machine after the copy was taken.
        let mut exported = source.export().unwrap();
        exported.notes[0].body = "Rewritten elsewhere".into();
        exported.notes[0].updated_at += 10_000;

        let summary = target.import(exported).unwrap();
        assert_eq!(summary.notes_updated, 1);
        assert_eq!(target.list_notes(None, None, 50).unwrap()[0].body, "Rewritten elsewhere");
    }

    #[test]
    fn an_older_copy_of_a_note_does_not_overwrite_a_newer_one() {
        let source = populated();
        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        let local = target.list_notes(None, None, 50).unwrap()[0].id;
        target.update_note(local, "Newer local wording").unwrap();

        target.import(source.export().unwrap()).unwrap();
        assert_eq!(target.list_notes(None, None, 50).unwrap()[0].body, "Newer local wording");
    }

    #[test]
    fn a_longer_transcript_replaces_a_shorter_one() {
        // A conversation only grows, so more messages is the reliable sign of
        // the later copy — more reliable than a timestamp, which also moves
        // when a case is graded.
        let source = populated();
        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        source.save_turn(turn("s1", "And its branches?", "The arch gives three.")).unwrap();
        let summary = target.import(source.export().unwrap()).unwrap();

        assert_eq!(summary.sessions_updated, 1);
        assert_eq!(target.session("s1").unwrap().unwrap().messages.len(), 4);
    }

    #[test]
    fn a_shorter_transcript_never_truncates_a_longer_one() {
        let source = populated();
        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();
        target.save_turn(turn("s1", "Follow-up here", "Answered here.")).unwrap();

        target.import(source.export().unwrap()).unwrap();
        assert_eq!(target.session("s1").unwrap().unwrap().messages.len(), 4);
    }

    #[test]
    fn a_grade_earned_elsewhere_is_picked_up() {
        let source = populated();
        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        source.record_case_result("s1", 81, "Good on the layers, thin on the branches.").unwrap();
        target.import(source.export().unwrap()).unwrap();

        assert_eq!(target.list_sessions(None, None, 50).unwrap()[0].score, Some(81));
    }

    #[test]
    fn a_note_whose_session_is_gone_is_kept_as_an_orphan() {
        // The foreign key would reject it. Losing the note over a conversation
        // somebody deleted would be the wrong trade.
        let source = populated();
        let mut exported = source.export().unwrap();
        exported.notes[0].session_id = Some("a-session-that-never-arrived".into());

        let fresh = StudyDb::in_memory();
        let summary = fresh.import(exported).unwrap();
        assert_eq!(summary.notes_added, 1);
        assert!(fresh.list_notes(None, None, 50).unwrap()[0].session_id.is_none());
    }

    #[test]
    fn a_file_that_is_not_a_journal_is_refused_by_name() {
        let fresh = StudyDb::in_memory();
        let mut exported = populated().export().unwrap();
        exported.format = "something.else".into();
        let error = fresh.import(exported).unwrap_err().to_string();
        assert!(error.contains("not an Anatria3D study journal"));
    }

    #[test]
    fn a_journal_from_a_newer_build_is_refused_rather_than_half_read() {
        let fresh = StudyDb::in_memory();
        let mut exported = populated().export().unwrap();
        exported.version = EXPORT_VERSION + 1;
        assert!(fresh.import(exported).unwrap_err().to_string().contains("newer version"));
    }

    #[test]
    fn every_note_gets_an_identity_that_survives_the_machine() {
        let db = populated();
        let uuid = &db.list_notes(None, None, 50).unwrap()[0].uuid;
        assert_eq!(uuid.len(), 32, "expected a 16-byte hex id, got {uuid:?}");
    }

    #[test]
    fn notes_written_before_the_upgrade_are_given_an_identity() {
        // The v1 -> v2 step has to backfill, or every pre-existing note would
        // be unmergeable and the first import would collide them all.
        // A database exactly as schema v1 left it: `note` with no uuid column.
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE note (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 organ_id    TEXT,
                 organ_label TEXT,
                 session_id  TEXT,
                 body        TEXT NOT NULL,
                 created_at  INTEGER NOT NULL,
                 updated_at  INTEGER NOT NULL
             );
             INSERT INTO note (organ_id, body, created_at, updated_at)
             VALUES ('aorta', 'Written before the upgrade', 1, 1);",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();

        migrate(&mut conn).unwrap();

        let uuid: Option<String> = conn
            .query_row("SELECT uuid FROM note", [], |row| row.get(0))
            .unwrap();
        assert_eq!(uuid.map(|id| id.len()), Some(32));
    }

    #[test]
    fn an_unknown_session_kind_is_rejected() {
        let db = StudyDb::in_memory();
        let mut input = turn("s1", "Q", "A");
        input.kind = "exam".into();
        assert!(db.save_turn(input).is_err());
    }
}
