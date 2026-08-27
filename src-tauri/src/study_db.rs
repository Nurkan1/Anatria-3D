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
const SCHEMA_VERSION: i32 = 9;

/// Marker on an exported journal, so an unrelated `.json` is refused with a
/// sentence rather than a parse error.
pub const EXPORT_FORMAT: &str = "anatria3d.journal";
/// Bumped when the exported shape changes incompatibly.
pub const EXPORT_VERSION: u32 = 1;

const MAX_TITLE: usize = 200;
const MAX_BODY: usize = 20_000;
const MAX_MESSAGE: usize = 100_000;

/// Visits one case may hold.
///
/// A ceiling rather than none, because every visit adds its verdict to the
/// digest the next one carries: unbounded visits are an unbounded prompt, paid
/// for by the reader. Twenty consultations already exceed any teaching case,
/// and refusing the twenty-first with a sentence beats a case that quietly
/// becomes expensive.
const MAX_VISITS: i64 = 20;

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
    /// The virtual patient this was a visit to, if any.
    ///
    /// On the summary so a list of sixty sessions can say which belong to whom
    /// without a second query per row. Null for every ordinary conversation,
    /// which is most of them.
    pub case_id: Option<String>,
    pub visit_no: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
    pub created_at: i64,
    /// Which model produced this answer. `None` on every question, and on any
    /// answer written before the journal recorded it.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub input_tokens: Option<i64>,
    #[serde(default)]
    pub output_tokens: Option<i64>,
    /// How much of `input_tokens` the provider served from its prompt cache.
    ///
    /// `None` on every turn recorded before the journal knew to ask, which is
    /// not the same as zero and is why this is an option rather than a
    /// defaulted integer: a reader looking at last month must not be told its
    /// answers were all charged at full rate when the truth is nobody counted.
    #[serde(default)]
    pub cache_read_tokens: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SessionDetail {
    pub session: SessionSummary,
    pub messages: Vec<StoredMessage>,
    /// Structures this session touched, so reopening it can restore the scene.
    pub structures: Vec<String>,
}

/// A simulated patient a case runs over several visits.
///
/// **It cannot hold a person.** There is no name, and no free-text identity
/// field of any kind — not by convention but because the columns do not exist,
/// so a case file cannot be turned into a medical record by misuse. The
/// demographics below are the parameters of a teaching scenario and describe
/// nobody.
///
/// Without the sealed answer: see `case_answer`.
#[derive(Debug, Serialize)]
pub struct CaseFile {
    pub id: String,
    pub title: String,
    /// `male` or `female`. Drives the reasoning; the 3D model shipped in this
    /// build is male either way, which the interface has to say out loud.
    pub sex: String,
    pub age_years: Option<i64>,
    pub height_cm: Option<i64>,
    pub weight_kg: Option<f64>,
    /// Vitals, history and results the reader is *given*.
    ///
    /// On this struct, unlike `ground_truth`, precisely because they are not
    /// secret: a case whose findings were withheld could not be reasoned about
    /// at all.
    pub findings: String,
    /// When the answer was sealed — always at creation, never later.
    pub sealed_at: i64,
    /// When the reader opened the answer themselves, or `None` while sealed.
    ///
    /// A door, not a leak. `ground_truth` still has no method that edits it —
    /// this records that somebody deliberately looked, which is the act the
    /// seal was always meant to keep accidental.
    pub revealed_at: Option<i64>,
    pub profile: String,
    pub language: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub visit_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CaseInput {
    pub id: String,
    pub title: String,
    pub sex: String,
    #[serde(default)]
    pub age_years: Option<i64>,
    #[serde(default)]
    pub height_cm: Option<i64>,
    #[serde(default)]
    pub weight_kg: Option<f64>,
    #[serde(default)]
    pub findings: String,
    pub ground_truth: String,
    pub profile: String,
    pub language: String,
}

/// A complaint marked on the body.
///
/// The `organ_id` is **where the reader marked it**, not where the cause is.
/// Those are frequently different — the whole point of recording one is that
/// working out the second from the first is the reasoning being taught.
#[derive(Debug, Serialize, Deserialize)]
pub struct CaseSymptom {
    pub id: i64,
    /// The structure or body region the complaint was marked on.
    pub organ_id: String,
    /// Its name, kept alongside: the system it belongs to may be switched off.
    pub organ_label: Option<String>,
    pub symptom: String,
    /// 0–10, the scale the reader already knows. Absent when not asked.
    pub severity: Option<i64>,
    /// The visit it was reported at, if it was reported during one.
    pub session_id: Option<String>,
    pub created_at: i64,
}

/// Something learned about the patient after the case was opened.
///
/// The interval history: a weight that came down, a blood pressure that did
/// not, what the imaging said. Stamped with the visit it was known at and
/// never edited afterwards — an answer given at visit 3 has to be readable
/// against what visit 3 had been told, and a record rewritten backwards
/// grades nothing.
#[derive(Debug, Serialize, Deserialize)]
pub struct CaseFinding {
    pub id: i64,
    /// The visit this was known at. See `add_finding` — counted, not passed in.
    pub visit_no: i64,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct FindingInput {
    pub case_id: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct SymptomInput {
    pub case_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub organ_id: String,
    #[serde(default)]
    pub organ_label: Option<String>,
    pub symptom: String,
    #[serde(default)]
    pub severity: Option<i64>,
}

/// One visit, as the next one needs to remember it.
#[derive(Debug, Serialize)]
pub struct CaseVisit {
    pub session_id: String,
    pub visit_no: i64,
    pub score: Option<i64>,
    /// The written judgement. This *is* the digest — `MIN_VERDICT_CHARS` in the
    /// engine already requires it to stand on its own weeks later.
    pub verdict: Option<String>,
    pub structures: Vec<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct CaseDigest {
    pub case: CaseFile,
    /// For the engine, not for the reader. See `case_digest`.
    pub ground_truth: String,
    pub visits: Vec<CaseVisit>,
    /// Every complaint marked so far, oldest first — the presentation as it
    /// developed, which is what a course of illness actually is.
    pub symptoms: Vec<CaseSymptom>,
    /// What has been added to the record since, oldest first. The opening
    /// findings stay on `case`, sealed where they were written.
    pub record_updates: Vec<CaseFinding>,
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
    /// The case this was a visit to. Absent in every journal exported before
    /// schema v5, which is why it defaults rather than being required.
    #[serde(default)]
    pub case_id: Option<String>,
    #[serde(default)]
    pub visit_no: Option<i64>,
}

/// A case as it travels between machines.
///
/// Carries the sealed answer — a backup that dropped it would restore a case
/// nobody can ever grade against. It is the reader's own file, on the reader's
/// own disk, and it describes an invented patient.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportCase {
    pub id: String,
    pub title: String,
    pub sex: String,
    #[serde(default)]
    pub age_years: Option<i64>,
    #[serde(default)]
    pub height_cm: Option<i64>,
    #[serde(default)]
    pub weight_kg: Option<f64>,
    #[serde(default)]
    pub findings: String,
    pub ground_truth: String,
    pub sealed_at: i64,
    /// Travels with the case: a restore must not re-seal an answer the reader
    /// already opened, nor open one they never did.
    #[serde(default)]
    pub revealed_at: Option<i64>,
    pub profile: String,
    pub language: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Marked complaints travel inside their case, so they can never arrive
    /// orphaned. Their `id` is a local row number and is reassigned on import.
    #[serde(default)]
    pub symptoms: Vec<CaseSymptom>,
    /// The interval history, same rule. `#[serde(default)]` so a journal
    /// exported before v7 still restores — it simply has none.
    #[serde(default)]
    pub record_updates: Vec<CaseFinding>,
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
    /// Empty in journals written before schema v5.
    #[serde(default)]
    pub cases: Vec<ExportCase>,
}

/// What an import actually did, so the reader is told rather than left guessing.
#[derive(Debug, Default, Serialize)]
pub struct ImportSummary {
    pub sessions_added: u32,
    pub sessions_updated: u32,
    pub notes_added: u32,
    pub notes_updated: u32,
    /// Cases are sealed, so they are only ever added, never updated.
    pub cases_added: u32,
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
    /// Which model produced the answer, and what it cost. Absent when the
    /// provider reported nothing; recorded against the answer, never the
    /// question, because the question is the student's own words.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub input_tokens: Option<i64>,
    #[serde(default)]
    pub output_tokens: Option<i64>,
    /// How much of `input_tokens` came back out of the provider's cache.
    #[serde(default)]
    pub cache_read_tokens: Option<i64>,
    /// The case this session is a visit to, if any.
    ///
    /// `#[serde(default)]` is not decoration: a new field on an existing event
    /// is optional on the way in. A required one would make every frame from
    /// an older engine fail validation and be dropped silently — which is
    /// exactly how token accounting was lost once already.
    ///
    /// Read only when the session is created. A conversation cannot change
    /// which case it belongs to halfway through.
    #[serde(default)]
    pub case_id: Option<String>,
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

        let case_id = turn.case_id.as_deref().map(str::trim).filter(|id| !id.is_empty());

        self.with(|conn| {
            let tx = conn.transaction()?;

            // Which visit this is, decided once when the session is created.
            // A conversation already under way cannot be moved into a case:
            // its visit number would have to be invented, and every later
            // visit's digest would silently change meaning.
            let visit_no = match case_id {
                None => None,
                Some(case) => {
                    let known: bool = tx.query_row(
                        "SELECT EXISTS (SELECT 1 FROM case_file WHERE id = ?1)",
                        params![case],
                        |row| row.get(0),
                    )?;
                    if !known {
                        return Err(StudyError::Invalid(format!("no case {case:?} to visit")));
                    }
                    let existing: Option<i64> = tx
                        .query_row(
                            "SELECT visit_no FROM study_session WHERE id = ?1",
                            params![id],
                            |row| row.get(0),
                        )
                        .optional()?
                        .flatten();
                    match existing {
                        Some(already) => Some(already),
                        None => {
                            let taken: i64 = tx.query_row(
                                "SELECT COUNT(*) FROM study_session WHERE case_id = ?1",
                                params![case],
                                |row| row.get(0),
                            )?;
                            if taken >= MAX_VISITS {
                                return Err(StudyError::Invalid(format!(
                                    "this case already has its {MAX_VISITS} visits; \
                                     start a new case to carry on"
                                )));
                            }
                            Some(taken + 1)
                        }
                    }
                }
            };

            // The title is only written on insert. Renaming a session must
            // survive the next turn, and re-deriving it from the first question
            // every time would quietly undo the rename. The case and the visit
            // number are fixed on insert for the same reason.
            tx.execute(
                "INSERT INTO study_session
                     (id, kind, title, profile, language, created_at, updated_at,
                      case_id, visit_no)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET updated_at = ?6",
                params![id, kind, title, turn.profile, turn.language, now, case_id, visit_no],
            )?;

            if let Some(case) = case_id {
                // The case's own clock, so the picker can offer the one the
                // reader was last working on.
                tx.execute(
                    "UPDATE case_file SET updated_at = ?2 WHERE id = ?1",
                    params![case, now],
                )?;
            }

            for (role, content) in [("user", &question), ("assistant", &answer)] {
                if content.is_empty() {
                    continue;
                }
                // Provenance belongs to the answer alone. Filing the model
                // against the student's own question would claim it wrote it.
                let answered = role == "assistant";
                tx.execute(
                    "INSERT INTO study_message
                         (session_id, role, content, created_at,
                          model, input_tokens, output_tokens, cache_read_tokens)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        id,
                        role,
                        content,
                        now,
                        answered.then(|| turn.model.clone()).flatten(),
                        answered.then_some(turn.input_tokens).flatten(),
                        answered.then_some(turn.output_tokens).flatten(),
                        answered.then_some(turn.cache_read_tokens).flatten(),
                    ],
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
        case_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<SessionSummary>> {
        let limit = limit.clamp(1, 500);
        let filter = query.map(like_pattern);
        let organ = blank_to_none(organ_id);
        let case = blank_to_none(case_id);

        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.id, s.kind, s.title, s.profile, s.language, s.score, s.verdict,
                        (SELECT COUNT(*) FROM study_message m WHERE m.session_id = s.id),
                        (SELECT COUNT(*) FROM session_structure x WHERE x.session_id = s.id),
                        s.case_id, s.visit_no, s.created_at, s.updated_at
                 FROM study_session s
                 WHERE (?1 IS NULL
                        OR s.title LIKE ?1 ESCAPE '\\'
                        OR EXISTS (SELECT 1 FROM study_message m
                                   WHERE m.session_id = s.id
                                     AND m.content LIKE ?1 ESCAPE '\\'))
                   AND (?2 IS NULL
                        OR EXISTS (SELECT 1 FROM session_structure x
                                   WHERE x.session_id = s.id AND x.organ_id = ?2))
                   -- Narrowing to one patient composes with the other two, so
                   -- what was said about the aorta with this patient is one
                   -- query rather than a question nobody can ask.
                   AND (?3 IS NULL OR s.case_id = ?3)
                 ORDER BY s.updated_at DESC
                 LIMIT ?4",
            )?;
            let rows = stmt.query_map(params![filter, organ, case, limit], read_summary)?;
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
                            s.case_id, s.visit_no, s.created_at, s.updated_at
                     FROM study_session s WHERE s.id = ?1",
                    params![id],
                    read_summary,
                )
                .optional()?;
            let Some(session) = session else {
                return Ok(None);
            };

            let mut stmt = conn.prepare(
                "SELECT role, content, created_at, model, input_tokens, output_tokens,
                        cache_read_tokens
                 FROM study_message WHERE session_id = ?1 ORDER BY id",
            )?;
            let messages = stmt
                .query_map(params![id], |row| {
                    Ok(StoredMessage {
                        role: row.get(0)?,
                        content: row.get(1)?,
                        created_at: row.get(2)?,
                        model: row.get(3)?,
                        input_tokens: row.get(4)?,
                        output_tokens: row.get(5)?,
                        cache_read_tokens: row.get(6)?,
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

    // -- case files --------------------------------------------------------

    /// Open a case and seal its answer.
    ///
    /// The seal is the point. `ground_truth` is written now, before the reader
    /// has attempted anything, and there is no method here that edits it. An
    /// answer authored once the attempt is in hand grades nothing — it is the
    /// same defect as a prediction recorded only on the occasions it was
    /// right.
    pub fn create_case(&self, input: CaseInput) -> Result<CaseFile> {
        let id = require(&input.id, "id")?;
        let sex = match input.sex.as_str() {
            "male" | "female" => input.sex.clone(),
            other => return Err(StudyError::Invalid(format!("unknown sex {other:?}"))),
        };
        let ground_truth = clamp(&input.ground_truth, MAX_BODY);
        if ground_truth.is_empty() {
            return Err(StudyError::Invalid(
                "a case cannot be sealed without its answer".into(),
            ));
        }
        let title = fallback_title(&input.title, &ground_truth);
        check_range("age_years", input.age_years, 0, 130)?;
        check_range("height_cm", input.height_cm, 30, 260)?;
        if let Some(weight) = input.weight_kg {
            if !weight.is_finite() || !(0.5..=400.0).contains(&weight) {
                return Err(StudyError::Invalid(format!(
                    "weight_kg must be between 0.5 and 400, got {weight}"
                )));
            }
        }

        let now = now_ms();
        self.with(|conn| {
            conn.execute(
                "INSERT INTO case_file
                     (id, title, sex, age_years, height_cm, weight_kg, findings,
                      ground_truth, sealed_at, profile, language, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?9, ?9)",
                params![
                    id,
                    title,
                    sex,
                    input.age_years,
                    input.height_cm,
                    input.weight_kg,
                    clamp(&input.findings, MAX_BODY),
                    ground_truth,
                    now,
                    input.profile,
                    input.language,
                ],
            )?;
            read_case(conn, &id)?.ok_or_else(|| StudyError::Invalid("case vanished".into()))
        })
    }

    /// Cases, newest first. Without the sealed answer, deliberately — a list
    /// that carries it could spoil a case by being rendered.
    pub fn list_cases(&self) -> Result<Vec<CaseFile>> {
        self.with(|conn| {
            let mut statement = conn.prepare(CASE_SELECT)?;
            let rows = statement
                .query_map([], read_case_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    /// The sealed answer, and the record that it was opened.
    ///
    /// Its own call, because reading it is a deliberate act by the reader and
    /// never a side effect of listing or opening a case. The stamp is what
    /// makes that act durable: a case opened today must not read as sealed
    /// again tomorrow, or a summary would include the answer in one session
    /// and withhold it in the next.
    ///
    /// Idempotent in the way that matters — `revealed_at` keeps the *first*
    /// time, so looking twice does not rewrite when the case stopped being
    /// sealed. And this still cannot change `ground_truth`; there is no method
    /// anywhere that can.
    pub fn case_answer(&self, case_id: &str) -> Result<Option<String>> {
        let id = require(case_id, "case_id")?;
        let now = now_ms();
        self.with(|conn| {
            let answer: Option<String> = conn
                .query_row(
                    "SELECT ground_truth FROM case_file WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()?;
            if answer.is_some() {
                conn.execute(
                    "UPDATE case_file SET revealed_at = COALESCE(revealed_at, ?2)
                     WHERE id = ?1",
                    params![id, now],
                )?;
            }
            Ok(answer)
        })
    }

    /// Everything the next visit needs to continue, read from SQL and never
    /// generated.
    ///
    /// This is the carried-forward memory, and it costs nothing: no model call,
    /// so it is reproducible, free and identical on every machine. Past
    /// transcripts are deliberately not replayed — they grow without bound and
    /// the reader pays for every token with their own key. The written verdict
    /// already carries what mattered, which is why `MIN_VERDICT_CHARS` demands
    /// it be self-explanatory.
    ///
    /// Unlike `list_cases`, this **does** carry the sealed answer: it goes to
    /// the engine, which needs the script to keep the disease course coherent
    /// across visits. Not leaking it to the reader is the prompt's job, and is
    /// the same rule that already stops a drill answering its own question.
    pub fn case_digest(&self, case_id: &str) -> Result<Option<CaseDigest>> {
        let id = require(case_id, "case_id")?;
        self.with(|conn| {
            let Some(case) = read_case(conn, &id)? else {
                return Ok(None);
            };
            let ground_truth: String = conn.query_row(
                "SELECT ground_truth FROM case_file WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )?;

            let mut statement = conn.prepare(
                "SELECT s.id, s.visit_no, s.score, s.verdict, s.created_at
                 FROM study_session s
                 WHERE s.case_id = ?1
                 ORDER BY s.visit_no",
            )?;
            let mut visits = statement
                .query_map(params![id], |row| {
                    Ok(CaseVisit {
                        session_id: row.get(0)?,
                        visit_no: row.get(1)?,
                        score: row.get(2)?,
                        verdict: row.get(3)?,
                        structures: Vec::new(),
                        created_at: row.get(4)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut structures = conn.prepare(
                "SELECT organ_id FROM session_structure WHERE session_id = ?1 ORDER BY organ_id",
            )?;
            for visit in &mut visits {
                visit.structures = structures
                    .query_map(params![&visit.session_id], |row| row.get(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
            }

            let mut marked = conn.prepare(SYMPTOM_SELECT)?;
            let symptoms = marked
                .query_map(params![id], read_symptom_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            drop(marked);

            let mut added = conn.prepare(FINDING_SELECT)?;
            let record_updates = added
                .query_map(params![id], read_finding_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(Some(CaseDigest {
                case,
                ground_truth,
                visits,
                symptoms,
                record_updates,
            }))
        })
    }

    /// Add to the record, at the visit it became known.
    ///
    /// `visit_no` is counted here rather than passed in, and deliberately: the
    /// caller's idea of which visit it is arrives from a store that may be a
    /// turn behind, and a stamp that disagrees with the visit list is worse
    /// than no stamp at all. One visit ahead of what is filed is exactly the
    /// visit being worked on now, which is when a reader types this.
    pub fn add_finding(&self, input: FindingInput) -> Result<CaseFinding> {
        let case_id = require(&input.case_id, "case_id")?;
        let body = clamp(&input.body, MAX_BODY);
        if body.is_empty() {
            return Err(StudyError::Invalid("a record entry needs a body".into()));
        }

        let now = now_ms();
        self.with(|conn| {
            let known: bool = conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM case_file WHERE id = ?1)",
                params![case_id],
                |row| row.get(0),
            )?;
            if !known {
                return Err(StudyError::Invalid(format!(
                    "no case {case_id:?} to add to"
                )));
            }
            conn.execute(
                "INSERT INTO case_finding (case_id, visit_no, body, created_at)
                 VALUES (?1,
                         (SELECT COUNT(*) + 1 FROM study_session WHERE case_id = ?1),
                         ?2, ?3)",
                params![case_id, body, now],
            )?;
            let id = conn.last_insert_rowid();
            conn.query_row(
                &FINDING_SELECT.replace("WHERE case_id = ?1", "WHERE id = ?1"),
                params![id],
                read_finding_row,
            )
            .map_err(StudyError::from)
        })
    }

    /// The interval history for this case, oldest first.
    pub fn findings(&self, case_id: &str) -> Result<Vec<CaseFinding>> {
        let id = require(case_id, "case_id")?;
        self.with(|conn| {
            let mut statement = conn.prepare(FINDING_SELECT)?;
            let rows = statement
                .query_map(params![id], read_finding_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    /// Remove an entry. Correcting a typo, not rewriting history — the seal
    /// this protects is `ground_truth`, and that has no method at all.
    pub fn delete_finding(&self, id: i64) -> Result<()> {
        self.with(|conn| {
            conn.execute("DELETE FROM case_finding WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    /// Mark a complaint on a structure or a body region.
    ///
    /// Where it was marked, not where the cause is. A case that records "pain,
    /// left arm" and expects the reader to arrive at the heart is teaching
    /// referred pain, and the two ids being different is the lesson rather
    /// than an inconsistency to correct.
    pub fn add_symptom(&self, input: SymptomInput) -> Result<CaseSymptom> {
        let case_id = require(&input.case_id, "case_id")?;
        let organ_id = require(&input.organ_id, "organ_id")?;
        let symptom = clamp(&input.symptom, MAX_TITLE);
        if symptom.is_empty() {
            return Err(StudyError::Invalid("a symptom needs a description".into()));
        }
        check_range("severity", input.severity, 0, 10)?;

        let now = now_ms();
        self.with(|conn| {
            let known: bool = conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM case_file WHERE id = ?1)",
                params![case_id],
                |row| row.get(0),
            )?;
            if !known {
                return Err(StudyError::Invalid(format!("no case {case_id:?} to mark")));
            }
            conn.execute(
                "INSERT INTO case_symptom
                     (case_id, session_id, organ_id, organ_label, symptom, severity, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    case_id,
                    input.session_id,
                    organ_id,
                    input.organ_label,
                    symptom,
                    input.severity,
                    now,
                ],
            )?;
            let id = conn.last_insert_rowid();
            conn.query_row(
                &SYMPTOM_SELECT.replace("WHERE case_id = ?1", "WHERE id = ?1"),
                params![id],
                read_symptom_row,
            )
            .map_err(StudyError::from)
        })
    }

    /// Complaints marked on this case, oldest first.
    pub fn symptoms(&self, case_id: &str) -> Result<Vec<CaseSymptom>> {
        let id = require(case_id, "case_id")?;
        self.with(|conn| {
            let mut statement = conn.prepare(SYMPTOM_SELECT)?;
            let rows = statement
                .query_map(params![id], read_symptom_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    pub fn delete_symptom(&self, id: i64) -> Result<()> {
        self.with(|conn| {
            conn.execute("DELETE FROM case_symptom WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    /// Deleting a case leaves its visits standing as ordinary sessions.
    ///
    /// `ON DELETE SET NULL` in the schema, and the same reasoning v3 gave for
    /// `token_usage`: tidying the journal must never silently destroy the
    /// reader's own work.
    pub fn delete_case(&self, case_id: &str) -> Result<()> {
        let id = require(case_id, "case_id")?;
        self.with(|conn| {
            conn.execute("DELETE FROM case_file WHERE id = ?1", params![id])?;
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
            // Resolved against the journal rather than trusted, the same way an
            // imported session resolves its case — and for the same reason a
            // dangling key must not abort the write.
            //
            // A conversation has an id from the moment it opens on screen, but
            // `study_session` only gains the row when a turn is filed. So a
            // note written before the first answer named a session that did not
            // exist yet, and the foreign key refused the insert outright: the
            // note composer failed with `FOREIGN KEY constraint failed` for
            // every note started in a fresh conversation, while a note saved
            // from an answer worked, because by then the turn was on disk.
            //
            // Missing means the note simply belongs to no session, which is
            // what it is. The organ binding is the part worth keeping — that is
            // what makes a note findable months later — and it survives.
            let session_id = match blank_to_none(input.session_id.as_deref()) {
                Some(named) => conn
                    .query_row(
                        "SELECT id FROM study_session WHERE id = ?1",
                        params![named],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?,
                None => None,
            };

            conn.execute(
                "INSERT INTO note
                     (uuid, organ_id, organ_label, session_id, body, created_at, updated_at)
                 VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    blank_to_none(input.organ_id.as_deref()),
                    blank_to_none(input.organ_label.as_deref()),
                    session_id,
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
                // What was stored, not what was asked for. Returning the id the
                // caller sent would leave the panel holding a link the row does
                // not have, and it would survive until the next reload.
                session_id,
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
                        created_at, updated_at, case_id, visit_no
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
                        case_id: row.get(9)?,
                        visit_no: row.get(10)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut sessions = rows;
            let mut messages = conn.prepare(
                "SELECT role, content, created_at, model, input_tokens, output_tokens,
                        cache_read_tokens
                 FROM study_message WHERE session_id = ?1 ORDER BY id",
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
                            model: row.get(3)?,
                            input_tokens: row.get(4)?,
                            output_tokens: row.get(5)?,
                            cache_read_tokens: row.get(6)?,
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

            let mut cases = conn.prepare(
                "SELECT id, title, sex, age_years, height_cm, weight_kg, findings,
                        ground_truth, sealed_at, revealed_at, profile, language,
                        created_at, updated_at
                 FROM case_file ORDER BY created_at",
            )?;
            let cases = cases
                .query_map([], |row| {
                    Ok(ExportCase {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        sex: row.get(2)?,
                        age_years: row.get(3)?,
                        height_cm: row.get(4)?,
                        weight_kg: row.get(5)?,
                        findings: row.get(6)?,
                        ground_truth: row.get(7)?,
                        sealed_at: row.get(8)?,
                        revealed_at: row.get(9)?,
                        profile: row.get(10)?,
                        language: row.get(11)?,
                        created_at: row.get(12)?,
                        updated_at: row.get(13)?,
                        symptoms: Vec::new(),
                        record_updates: Vec::new(),
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut cases = cases;
            let mut marked = conn.prepare(SYMPTOM_SELECT)?;
            let mut added = conn.prepare(FINDING_SELECT)?;
            for entry in &mut cases {
                entry.symptoms = marked
                    .query_map(params![&entry.id], read_symptom_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                entry.record_updates = added
                    .query_map(params![&entry.id], read_finding_row)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
            }
            drop(marked);
            drop(added);

            Ok(JournalExport {
                format: EXPORT_FORMAT.to_owned(),
                version: EXPORT_VERSION,
                exported_at: now_ms(),
                sessions,
                notes,
                cases,
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

            // Cases before sessions: a visit's foreign key needs its case to
            // already be there, and `PRAGMA foreign_keys = ON` is set.
            //
            // `INSERT OR IGNORE`, never an update. A case is sealed at
            // creation, so a second copy of one is by definition the same
            // case — and if it somehow is not, the local seal is the one the
            // reader's own grades were judged against and must win.
            let mut fresh_cases: Vec<&ExportCase> = Vec::new();
            for case in &incoming.cases {
                if !matches!(case.sex.as_str(), "male" | "female") {
                    summary.skipped += 1;
                    continue;
                }
                let added = tx.execute(
                    "INSERT OR IGNORE INTO case_file
                         (id, title, sex, age_years, height_cm, weight_kg, findings,
                          ground_truth, sealed_at, revealed_at, profile, language,
                          created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        case.id,
                        clamp(&case.title, MAX_TITLE),
                        case.sex,
                        case.age_years,
                        case.height_cm,
                        case.weight_kg,
                        clamp(&case.findings, MAX_BODY),
                        clamp(&case.ground_truth, MAX_BODY),
                        case.sealed_at,
                        case.revealed_at,
                        case.profile,
                        case.language,
                        case.created_at,
                        case.updated_at,
                    ],
                )?;
                if added == 1 {
                    summary.cases_added += 1;
                    // Their symptoms are written after the sessions loop: each
                    // one names the visit it was reported at, and that session
                    // does not exist yet. Only for cases that were actually
                    // added, which is what makes a repeated import a no-op
                    // instead of doubling every complaint.
                    fresh_cases.push(case);
                } else {
                    summary.skipped += 1;
                }
            }

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
                        // `case_id` resolves through a lookup rather than being
                        // written straight in: a journal can name a case whose
                        // row did not travel with it, and a dangling key would
                        // abort the whole import over one loose visit. Missing
                        // means the session lands as an ordinary one, which is
                        // exactly what it is without its case.
                        tx.execute(
                            "INSERT INTO study_session
                                 (id, kind, title, profile, language, score, verdict,
                                  created_at, updated_at, case_id, visit_no)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                                     (SELECT id FROM case_file WHERE id = ?10), ?11)",
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
                                session.case_id,
                                session.visit_no,
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

                // Re-attach a visit that lost its case.
                //
                // The update branches above rewrite the transcript and the
                // grade and nothing else, which was wrong in a way that only
                // showed up on the path this exists for: deleting a case
                // leaves its sessions standing with `case_id` set to NULL, so
                // restoring the backup gave the patient back with no visits
                // attached and no way to reattach them. The case row was
                // fine; the link was gone for good.
                //
                // `COALESCE` in both columns, so a visit that already belongs
                // to a case is never moved to another one. Only a session
                // that has no case takes the incoming one, and only if that
                // case actually arrived — the same lookup the insert uses,
                // for the same reason.
                if session.case_id.is_some() {
                    tx.execute(
                        "UPDATE study_session
                         SET case_id = COALESCE(
                                 case_id, (SELECT id FROM case_file WHERE id = ?2)),
                             visit_no = COALESCE(visit_no, ?3)
                         WHERE id = ?1",
                        params![session.id, session.case_id, session.visit_no],
                    )?;
                }

                for organ_id in &session.structures {
                    tx.execute(
                        "INSERT OR IGNORE INTO session_structure (session_id, organ_id)
                         VALUES (?1, ?2)",
                        params![session.id, organ_id],
                    )?;
                }
            }

            // Now that the visits exist, the complaints can point at them.
            // `session_id` resolves through a lookup for the same reason
            // `case_id` does above: a symptom whose visit did not travel is
            // still a symptom, and a dangling key would abort the whole
            // restore over it.
            for case in &fresh_cases {
                for symptom in &case.symptoms {
                    let text = clamp(&symptom.symptom, MAX_TITLE);
                    if text.is_empty() || symptom.organ_id.trim().is_empty() {
                        summary.skipped += 1;
                        continue;
                    }
                    tx.execute(
                        "INSERT INTO case_symptom
                             (case_id, session_id, organ_id, organ_label,
                              symptom, severity, created_at)
                         VALUES (?1, (SELECT id FROM study_session WHERE id = ?2),
                                 ?3, ?4, ?5, ?6, ?7)",
                        params![
                            case.id,
                            symptom.session_id,
                            symptom.organ_id.trim(),
                            symptom.organ_label,
                            text,
                            symptom.severity,
                            symptom.created_at,
                        ],
                    )?;
                }

                // `visit_no` is carried across, never recounted. It records
                // which visit the reader had been told this by, and recounting
                // it against the visits that happened to travel would restamp
                // the interval history onto the wrong visits.
                for entry in &case.record_updates {
                    let body = clamp(&entry.body, MAX_BODY);
                    if body.is_empty() {
                        summary.skipped += 1;
                        continue;
                    }
                    tx.execute(
                        "INSERT INTO case_finding (case_id, visit_no, body, created_at)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![case.id, entry.visit_no.max(1), body, entry.created_at],
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

    // -- consumption -------------------------------------------------------

    /// File what one turn cost.
    ///
    /// The session reference is resolved here rather than trusted, and falls
    /// back to `NULL` when no such session exists. A turn's cost is known the
    /// moment the provider answers, but its session row is written afterwards
    /// and — for a turn that failed or was cancelled — never. Enforcing the
    /// key would make the spend record depend on an ordering it has no reason
    /// to care about, and lose exactly the turns worth counting: the ones that
    /// cost tokens and produced nothing.
    pub fn record_usage(&self, usage: UsageInput) -> Result<()> {
        if usage.provider.trim().is_empty() || usage.model.trim().is_empty() {
            return Err(StudyError::Invalid(
                "a usage record needs a provider and a model".into(),
            ));
        }
        if usage.input_tokens < 0 || usage.output_tokens < 0 {
            return Err(StudyError::Invalid("token counts cannot be negative".into()));
        }

        self.with(|conn| {
            let session_id = match usage.session_id.as_deref() {
                Some(id) => conn
                    .query_row(
                        "SELECT id FROM study_session WHERE id = ?1",
                        params![id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?,
                None => None,
            };

            conn.execute(
                "INSERT INTO token_usage
                     (session_id, provider, model, input_tokens, output_tokens,
                      cache_read_tokens, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    session_id,
                    usage.provider.trim(),
                    usage.model.trim(),
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.cache_read_tokens,
                    now_ms(),
                ],
            )?;
            Ok(())
        })
    }

    /// Spend over the last `days` days, one row per local day and model.
    ///
    /// Bucketed here rather than in the panel because SQLite can do it in the
    /// index and the alternative is shipping every turn the reader has ever
    /// taken across the IPC boundary to add up six numbers. A year of daily use
    /// across three models is a few hundred rows.
    ///
    /// `localtime`, deliberately. A question asked at half past eleven at night
    /// belongs to the day the reader was awake for, not to the following one in
    /// UTC — and the weekly and monthly rollups are built from these buckets,
    /// so getting the day boundary wrong would move spend between months.
    pub fn usage(&self, days: i64) -> Result<Vec<UsageBucket>> {
        let days = days.clamp(1, 3660);
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
                        provider,
                        model,
                        SUM(input_tokens),
                        SUM(output_tokens),
                        -- Rows written before the column existed are NULL, and
                        -- a NULL anywhere in SUM does not poison it — but a day
                        -- with no counted rows at all sums to NULL, so the
                        -- coalesce is what keeps that day at zero instead of
                        -- failing to decode into an i64.
                        COALESCE(SUM(cache_read_tokens), 0),
                        COUNT(*)
                 FROM token_usage
                 WHERE day >= date('now', 'localtime', ?1)
                 GROUP BY day, provider, model
                 ORDER BY day DESC",
            )?;
            // `-N days` covers today plus the N-1 before it, which is what
            // "the last seven days" means to a reader looking at a week.
            let window = format!("-{} days", days - 1);
            let rows = stmt.query_map(params![window], |row| {
                Ok(UsageBucket {
                    day: row.get(0)?,
                    provider: row.get(1)?,
                    model: row.get(2)?,
                    input_tokens: row.get(3)?,
                    output_tokens: row.get(4)?,
                    cache_read_tokens: row.get(5)?,
                    turns: row.get(6)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
        })
    }
}

/// What one turn cost, on the way in.
#[derive(Debug, Deserialize)]
pub struct UsageInput {
    /// The conversation it belongs to, if it was filed as one.
    pub session_id: Option<String>,
    pub provider: String,
    /// The id the engine actually sent, defaults resolved.
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// The part of `input_tokens` the provider served from its own cache.
    #[serde(default)]
    pub cache_read_tokens: i64,
}

/// One local day's spend on one model.
#[derive(Debug, Serialize)]
pub struct UsageBucket {
    /// `YYYY-MM-DD` in the reader's own timezone.
    pub day: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// Of `input_tokens`, how much was served from the provider's cache.
    ///
    /// Summed as zero where the rows predate the column, which understates the
    /// saving for old days rather than inventing one. The panel says so.
    pub cache_read_tokens: i64,
    /// Turns behind these numbers, so an average per question is available.
    pub turns: i64,
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

    // **Every step and the version stamp commit together, or none of them do.**
    //
    // Without this the stamp is a separate write from the work it describes,
    // and the two can come apart: a step that fails halfway leaves its earlier
    // statements applied, and a build whose `SCHEMA_VERSION` is ahead of its
    // steps stamps a version it never migrated to. Either way the database
    // afterwards *claims* a shape it does not have — and because the stamp is
    // what decides whether to migrate at all, it never tries again. The failure
    // surfaces later as `no such table`, a long way from the cause.
    //
    // `user_version` is part of the database header and is written through the
    // journal like any other page, so it rolls back with the rest.
    let tx = conn.transaction()?;

    // Steps are additive and never edited: a database written by a released
    // build has to keep opening.
    if version < 1 {
        tx.execute_batch(
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
        tx.execute_batch(
            "ALTER TABLE note ADD COLUMN uuid TEXT;
             UPDATE note SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
             CREATE UNIQUE INDEX idx_note_uuid ON note(uuid);",
        )?;
    }

    if version < 3 {
        // What each turn cost, so the reader can see their own consumption
        // without logging into three provider dashboards.
        //
        // Its own table rather than columns on `study_session`, for two
        // reasons. A turn that failed or was cancelled still spent input
        // tokens and still belongs in the total, but is deliberately never
        // filed as a session — that is the rule that keeps half-answers out of
        // the journal, and it must not double as a rule about money. And a
        // session runs over days: a single pair of columns on it could only
        // say when the session started, not when the spend happened.
        //
        // `ON DELETE SET NULL` rather than CASCADE. Deleting a conversation
        // removes what was said; it cannot un-spend the tokens, and a total
        // that silently shrinks when you tidy your journal is a total nobody
        // can reconcile against a provider's bill. The orphaned row keeps the
        // date, the provider and the model, and carries no anatomy, no
        // question and no prose — there is nothing in it to be private about.
        tx.execute_batch(
            "CREATE TABLE token_usage (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id    TEXT REFERENCES study_session(id) ON DELETE SET NULL,
                 provider      TEXT NOT NULL,
                 model         TEXT NOT NULL,
                 input_tokens  INTEGER NOT NULL CHECK (input_tokens  >= 0),
                 output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
                 created_at    INTEGER NOT NULL
             );
             CREATE INDEX idx_usage_when ON token_usage(created_at DESC);",
        )?;
    }

    if version < 4 {
        // Which model produced an answer, and what it cost.
        //
        // On the message rather than only in `token_usage`, because the two
        // answer different questions. That table is a ledger — it must survive
        // the session being deleted, and it is keyed by nothing finer than the
        // conversation. This is provenance: *this paragraph* came from that
        // model. A student reopening a session weeks later, or printing one to
        // revise from, is entitled to know which model told them this, and a
        // journal that keeps only the prose cannot say.
        //
        // Nullable, and nothing is backfilled. Every answer written before
        // this column existed genuinely has no recorded model, and inventing
        // one — the current selection, the provider's default — would be worse
        // than the blank: it would look like a fact.
        tx.execute_batch(
            "ALTER TABLE study_message ADD COLUMN model TEXT;
             ALTER TABLE study_message ADD COLUMN input_tokens INTEGER;
             ALTER TABLE study_message ADD COLUMN output_tokens INTEGER;",
        )?;
    }

    if version < 5 {
        // Case files: several visits to the same simulated patient.
        //
        // The journal already held the episodes (`study_session`) and the
        // structures each one touched (`session_structure`). This is only the
        // thing that groups them, which is why it is two columns and a table
        // rather than a subsystem.
        //
        // **There is no name column, and there is no free-text identity field
        // of any kind.** That is not an oversight and not a policy note: a
        // case file is physically unable to hold a person, so it cannot become
        // a medical record by misuse. Same construction as
        // `record_case_verdict`, which cannot be called outside case mode
        // however much a model would like to. The demographics below are the
        // parameters of a teaching scenario — they describe nobody.
        //
        // `ground_truth` is sealed on creation, before the reader has answered
        // anything, and never edited afterwards. An answer written once the
        // attempt is in hand is worth nothing: it is the same defect as a
        // prediction that gets recorded only when it turned out right.
        //
        // `ON DELETE SET NULL` rather than CASCADE, for the reason v3 gave for
        // `token_usage`: deleting a case must not take the reader's work with
        // it. The visits survive as ordinary sessions, which is exactly what
        // they were before they were grouped.
        //
        // `case_symptom` is the exception and does CASCADE, because it is the
        // one thing here that is not the reader's own work: a complaint marked
        // on a body region belongs to the invented patient and means nothing
        // without them. It is also the table the whole feature turns on — the
        // reader marks *where it hurts*, on the surface, and what has to be
        // worked out is *which structure* is responsible. Referred pain runs
        // the wrong way round for a static atlas to teach, and this is the
        // shape that lets a case ask it.
        //
        // `organ_label` is stored beside the id, exactly as `note` does: the
        // structure may belong to a system that is switched off, and a symptom
        // that cannot name where it was marked is a symptom nobody can read.
        tx.execute_batch(
            "CREATE TABLE case_file (
                 id           TEXT PRIMARY KEY,
                 title        TEXT NOT NULL,
                 sex          TEXT NOT NULL CHECK (sex IN ('male', 'female')),
                 age_years    INTEGER CHECK (age_years IS NULL OR age_years BETWEEN 0 AND 130),
                 height_cm    INTEGER CHECK (height_cm IS NULL OR height_cm BETWEEN 30 AND 260),
                 weight_kg    REAL    CHECK (weight_kg IS NULL OR weight_kg BETWEEN 0.5 AND 400),
                 ground_truth TEXT NOT NULL,
                 sealed_at    INTEGER NOT NULL,
                 profile      TEXT NOT NULL,
                 language     TEXT NOT NULL,
                 created_at   INTEGER NOT NULL,
                 updated_at   INTEGER NOT NULL
             );
             CREATE INDEX idx_case_recent ON case_file(updated_at DESC);

             ALTER TABLE study_session
                 ADD COLUMN case_id TEXT REFERENCES case_file(id) ON DELETE SET NULL;
             ALTER TABLE study_session ADD COLUMN visit_no INTEGER;
             CREATE INDEX idx_session_case ON study_session(case_id, visit_no);

             CREATE TABLE case_symptom (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 case_id     TEXT NOT NULL REFERENCES case_file(id) ON DELETE CASCADE,
                 session_id  TEXT REFERENCES study_session(id) ON DELETE SET NULL,
                 organ_id    TEXT NOT NULL,
                 organ_label TEXT,
                 symptom     TEXT NOT NULL,
                 severity    INTEGER CHECK (severity IS NULL OR severity BETWEEN 0 AND 10),
                 created_at  INTEGER NOT NULL
             );
             CREATE INDEX idx_symptom_case ON case_symptom(case_id, created_at);",
        )?;
    }


    if version < 6 {
        // Findings, split out from the sealed answer.
        //
        // One field was doing two incompatible jobs, and the first real case
        // written on it showed how: the author typed "overweight, high blood
        // pressure" — which is what the *reader* has to be told in order to
        // reason at all — into the field that must never be said out loud. The
        // assistant did the sensible thing and gave it to them, quoting the
        // seal back as "according to the record".
        //
        // The rule was not wrong; the field was. A case has two kinds of
        // writing in it:
        //
        //   `findings`      — vitals, history, weight, what the labs said. The
        //                     reader sees these from the start, because a case
        //                     with no findings cannot be reasoned about.
        //   `ground_truth`  — what it turns out to be. Sealed.
        //
        // Defaulted to empty rather than nullable: every case written before
        // this column existed genuinely had nowhere to put findings, and an
        // empty string says that without a second state to handle everywhere.
        tx.execute_batch(
            "ALTER TABLE case_file ADD COLUMN findings TEXT NOT NULL DEFAULT '';",
        )?;
    }

    if version < 7 {
        // A record that can still learn something.
        //
        // v6 gave a case findings; it did not give it a second visit. The
        // column is written once, at the seal, and nothing edits it — so a
        // patient followed across eight visits presented exactly as they did
        // on the first day, for ever. That is not a longitudinal record, it is
        // a snapshot with a visit counter beside it, and the first case that
        // ran long showed it: the weight came down, the blood pressure came
        // down, and the file still said 98 kg.
        //
        // Appended rather than edited, for the same reason the answer is
        // sealed. What the reader was told at visit 3 is part of what their
        // answer at visit 3 should be judged against; a record that can be
        // rewritten backwards grades nothing. So entries accumulate, each
        // stamped with the visit it was known at, and the opening
        // `case_file.findings` stays exactly as sealed.
        //
        // CASCADE, like `case_symptom` and unlike `study_session`: this
        // describes the invented patient and means nothing without them.
        tx.execute_batch(
            "CREATE TABLE case_finding (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 case_id    TEXT NOT NULL REFERENCES case_file(id) ON DELETE CASCADE,
                 visit_no   INTEGER NOT NULL,
                 body       TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX idx_finding_case ON case_finding(case_id, id);",
        )?;
    }

    if version < 8 {
        // When the reader opened the answer themselves.
        //
        // The seal was written to require every visit graded, and measured
        // against a real journal that turned out to be unreachable: 1 visit
        // graded out of 13, because most visits are conversations rather than
        // examinations and will never carry a score. A rule that is correct
        // and never fires protects nothing — it just hides the reader's own
        // writing from them.
        //
        // So the seal keeps the job it was actually for — nobody stumbles
        // into the answer — and gains the door it was missing. Recorded in
        // the file rather than held in the window: a case that has been
        // opened stays open, so a summary does not include the answer today
        // and withhold it tomorrow.
        //
        // Nullable, and null means sealed. There is still no method that
        // *edits* `ground_truth`, which is the guarantee that mattered.
        tx.execute_batch("ALTER TABLE case_file ADD COLUMN revealed_at INTEGER;")?;
    }

    if version < 9 {
        // What a turn actually paid for, as opposed to what it sent.
        //
        // Every question re-sends the whole conversation, so the input count
        // grows with the transcript and a long session looks alarming. But a
        // long session is also the one a provider caches best, and cache reads
        // are billed at a fraction — OpenAI caches any prompt over 1,024
        // tokens without being asked. Recording only the inclusive total meant
        // the application overstated the bill exactly where it warned about it.
        //
        // Nullable, and null means "not counted", not "none". Every turn taken
        // before this column existed is unknowable, and writing a zero there
        // would be inventing a fact about the reader's own history.
        //
        // On the message as well as in `token_usage`, for the same reason the
        // other two are: the panel reads the daily rollup, and a reopened
        // conversation reads the message.
        tx.execute_batch(
            "ALTER TABLE study_message ADD COLUMN cache_read_tokens INTEGER;
             ALTER TABLE token_usage ADD COLUMN cache_read_tokens INTEGER;",
        )?;
    }

    tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    tx.commit()
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
            "INSERT INTO study_message
                 (session_id, role, content, created_at, model, input_tokens, output_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session.id,
                message.role,
                clamp(&message.content, MAX_MESSAGE),
                message.created_at,
                message.model,
                message.input_tokens,
                message.output_tokens,
            ],
        )?;
    }
    Ok(())
}

/// Shared by the list and the single read, so one cannot drift from the other.
const CASE_SELECT: &str = "SELECT c.id, c.title, c.sex, c.age_years, c.height_cm, c.weight_kg,
                                  c.findings, c.sealed_at, c.revealed_at, c.profile, c.language,
                                  c.created_at, c.updated_at,
                                  (SELECT COUNT(*) FROM study_session s WHERE s.case_id = c.id)
                           FROM case_file c
                           ORDER BY c.updated_at DESC";

fn read_case_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CaseFile> {
    Ok(CaseFile {
        id: row.get(0)?,
        title: row.get(1)?,
        sex: row.get(2)?,
        age_years: row.get(3)?,
        height_cm: row.get(4)?,
        weight_kg: row.get(5)?,
        findings: row.get(6)?,
        sealed_at: row.get(7)?,
        revealed_at: row.get(8)?,
        profile: row.get(9)?,
        language: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        visit_count: row.get(13)?,
    })
}

fn read_case(conn: &Connection, case_id: &str) -> rusqlite::Result<Option<CaseFile>> {
    let sql = CASE_SELECT.replace("FROM case_file c", "FROM case_file c WHERE c.id = ?1");
    conn.query_row(&sql, params![case_id], read_case_row).optional()
}

/// Oldest first: a presentation is read in the order it developed.
const SYMPTOM_SELECT: &str = "SELECT id, organ_id, organ_label, symptom, severity,
                                     session_id, created_at
                              FROM case_symptom
                              WHERE case_id = ?1
                              ORDER BY created_at, id";

fn read_symptom_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CaseSymptom> {
    Ok(CaseSymptom {
        id: row.get(0)?,
        organ_id: row.get(1)?,
        organ_label: row.get(2)?,
        symptom: row.get(3)?,
        severity: row.get(4)?,
        session_id: row.get(5)?,
        created_at: row.get(6)?,
    })
}

/// Ordered by `id`, not by `visit_no`: several entries can share a visit, and
/// insertion order is the order they were learned in.
const FINDING_SELECT: &str = "SELECT id, visit_no, body, created_at
                              FROM case_finding
                              WHERE case_id = ?1
                              ORDER BY id";

fn read_finding_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CaseFinding> {
    Ok(CaseFinding {
        id: row.get(0)?,
        visit_no: row.get(1)?,
        body: row.get(2)?,
        created_at: row.get(3)?,
    })
}

/// Reject an out-of-range figure with the bound in the message, rather than
/// letting SQLite answer with a constraint name the reader never chose.
fn check_range(field: &str, value: Option<i64>, low: i64, high: i64) -> Result<()> {
    match value {
        Some(found) if !(low..=high).contains(&found) => Err(StudyError::Invalid(format!(
            "{field} must be between {low} and {high}, got {found}"
        ))),
        _ => Ok(()),
    }
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
        case_id: row.get(9)?,
        visit_no: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
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
            model: None,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            case_id: None,
        }
    }

    fn case(id: &str) -> CaseInput {
        CaseInput {
            id: id.into(),
            title: "Chest pain".into(),
            sex: "female".into(),
            age_years: Some(58),
            height_cm: Some(164),
            weight_kg: Some(71.5),
            findings: "BMI 26. BP 158/94. Smoker, 20/day.".into(),
            ground_truth: "Inferior myocardial infarction; atypical presentation.".into(),
            profile: "student".into(),
            language: "es".into(),
        }
    }

    /// A visit to `case_id`, so the tests read as what they mean.
    fn visit(session_id: &str, case_id: &str) -> TurnInput {
        TurnInput {
            kind: "case".into(),
            case_id: Some(case_id.into()),
            ..turn(session_id, "What is happening?", "Consider ischaemia.")
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

        let sessions = db.list_sessions(None, None, None, 50).unwrap();
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

        let found = db.list_sessions(None, Some("right_atrium"), None, 50).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(
            db.list_sessions(None, Some("left_ventricle"), None, 50).unwrap().len(),
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
        assert!(db.list_sessions(None, Some("aorta"), None, 50).unwrap().is_empty());
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

        assert_eq!(db.list_sessions(Some("myocardium"), None, None, 50).unwrap().len(), 1);
        assert_eq!(db.list_sessions(Some("pancreas"), None, None, 50).unwrap().len(), 0);
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
            .list_sessions(Some("dissection"), Some("aorta"), None, 50)
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
        assert_eq!(db.list_sessions(Some("50%"), None, None, 50).unwrap().len(), 1);
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

        assert_eq!(target.list_sessions(None, None, None, 50).unwrap()[0].score, Some(81));
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
        // A database exactly as schema v1 left it. Every table, not just the
        // one this step touches: later steps alter the others, and a fixture
        // that omits them tests a database no release ever wrote.
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE study_session (
                 id         TEXT PRIMARY KEY,
                 kind       TEXT NOT NULL CHECK (kind IN ('tutor', 'case')),
                 title      TEXT NOT NULL,
                 profile    TEXT NOT NULL,
                 language   TEXT NOT NULL,
                 score      INTEGER,
                 verdict    TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE study_message (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                 content    TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE session_structure (
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 organ_id   TEXT NOT NULL,
                 PRIMARY KEY (session_id, organ_id)
             );
             CREATE TABLE note (
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

        // And it arrived at the current schema on the way, rather than
        // stopping at the step this test is named after.
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        conn.query_row("SELECT model FROM study_message", [], |_| Ok(()))
            .optional()
            .expect("a v1 journal should gain every later column");
        conn.query_row("SELECT case_id, visit_no FROM study_session", [], |_| Ok(()))
            .optional()
            .expect("a v1 journal should gain the case columns");
        conn.query_row("SELECT COUNT(*) FROM case_file", [], |_| Ok(()))
            .expect("a v1 journal should gain the case table");
    }

    /// A journal exactly as schema v4 left it, opened the way the app opens it.
    ///
    /// The pragmas are not decoration. `connect` turns foreign keys **on before
    /// migrating**, and SQLite changes what `ALTER TABLE ADD COLUMN` will accept
    /// when they are enabled. A fixture that omits them tests a database no
    /// release ever opens, which is how a migration can pass every test here and
    /// still fail on the first machine it meets.
    fn journal_at_v4() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE study_session (
                 id         TEXT PRIMARY KEY,
                 kind       TEXT NOT NULL CHECK (kind IN ('tutor', 'case')),
                 title      TEXT NOT NULL,
                 profile    TEXT NOT NULL,
                 language   TEXT NOT NULL,
                 score      INTEGER,
                 verdict    TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE study_message (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                 content    TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 model      TEXT,
                 input_tokens  INTEGER,
                 output_tokens INTEGER
             );
             CREATE TABLE session_structure (
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 organ_id   TEXT NOT NULL,
                 PRIMARY KEY (session_id, organ_id)
             );
             CREATE TABLE note (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 uuid        TEXT,
                 organ_id    TEXT,
                 organ_label TEXT,
                 session_id  TEXT,
                 body        TEXT NOT NULL,
                 created_at  INTEGER NOT NULL,
                 updated_at  INTEGER NOT NULL
             );
             CREATE TABLE token_usage (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id    TEXT REFERENCES study_session(id) ON DELETE SET NULL,
                 provider      TEXT NOT NULL,
                 model         TEXT NOT NULL,
                 input_tokens  INTEGER NOT NULL CHECK (input_tokens  >= 0),
                 output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
                 created_at    INTEGER NOT NULL
             );
             INSERT INTO study_session
                 (id, kind, title, profile, language, created_at, updated_at)
             VALUES ('old', 'case', 'A drill from before', 'student', 'es', 1, 1);",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 4).unwrap();
        conn
    }

    #[test]
    fn a_real_v4_journal_gains_the_case_tables() {
        // The case the released build actually meets: a journal with sessions
        // already in it, opened with foreign keys on.
        let mut conn = journal_at_v4();

        migrate(&mut conn).expect("a v4 journal must migrate");

        conn.query_row("SELECT COUNT(*) FROM case_file", [], |_| Ok(()))
            .expect("case_file should exist");
        conn.query_row("SELECT COUNT(*) FROM case_symptom", [], |_| Ok(()))
            .expect("case_symptom should exist");
        conn.query_row("SELECT COUNT(*) FROM case_finding", [], |_| Ok(()))
            .expect("case_finding should exist");
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn a_v6_journal_gains_the_record_without_losing_its_cases() {
        // The upgrade the reader's own machine will actually perform. v6 is
        // where the released build left it, with cases and visits already on
        // file, and the new table must arrive beside them rather than instead.
        let mut conn = journal_at_v4();
        migrate(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO case_file
                 (id, title, sex, findings, ground_truth, sealed_at,
                  profile, language, created_at, updated_at)
             VALUES ('c1', 'Chest pain', 'male', '', 'Sealed.', 1,
                     'student', 'es', 1, 1);",
        )
        .unwrap();
        // Wind the shape back to v6 as well as the stamp. Winding only the
        // stamp would leave a database claiming v6 while already carrying v7
        // and v8 — the exact inconsistency this whole test file exists to
        // catch, and it would fail here as a duplicate column rather than as
        // the thing it is.
        conn.execute_batch(
            "DROP TABLE case_finding;
             ALTER TABLE case_file DROP COLUMN revealed_at;
             ALTER TABLE study_message DROP COLUMN cache_read_tokens;
             ALTER TABLE token_usage DROP COLUMN cache_read_tokens;",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 6).unwrap();

        migrate(&mut conn).expect("a v6 journal must migrate");

        let cases: i64 = conn
            .query_row("SELECT COUNT(*) FROM case_file", [], |row| row.get(0))
            .unwrap();
        assert_eq!(cases, 1, "the existing case survives the upgrade");
        conn.query_row("SELECT COUNT(*) FROM case_finding", [], |_| Ok(()))
            .expect("case_finding should exist");
    }

    /// A journal written before the cache column keeps every turn it recorded,
    /// and those turns stay honestly uncounted rather than being told they paid
    /// full rate.
    #[test]
    fn a_v8_journal_gains_the_cache_column_without_inventing_history() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();

        conn.execute_batch(
            "INSERT INTO study_session
                 (id, kind, title, profile, language, created_at, updated_at)
             VALUES ('s1', 'tutor', 'Older question', 'student', 'es', 1, 1);
             INSERT INTO study_message
                 (session_id, role, content, created_at, model,
                  input_tokens, output_tokens)
             VALUES ('s1', 'assistant', 'An older answer', 1, 'gpt-5', 900, 100);
             INSERT INTO token_usage
                 (session_id, provider, model, input_tokens, output_tokens, created_at)
             VALUES ('s1', 'openai', 'gpt-5', 900, 100, 1);",
        )
        .unwrap();

        // Wind the shape back with the stamp, the same way the v6 test does.
        conn.execute_batch(
            "ALTER TABLE study_message DROP COLUMN cache_read_tokens;
             ALTER TABLE token_usage DROP COLUMN cache_read_tokens;",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 8).unwrap();

        migrate(&mut conn).expect("a v8 journal must migrate");

        let cached: Option<i64> = conn
            .query_row(
                "SELECT cache_read_tokens FROM study_message WHERE session_id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            cached, None,
            "a turn recorded before the column must read as uncounted, not as zero cached"
        );

        let (input, output): (i64, i64) = conn
            .query_row(
                "SELECT input_tokens, output_tokens FROM study_message WHERE session_id = 's1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((input, output), (900, 100), "the counts it did have survive");
    }

    /// The daily rollup has to keep working across the boundary: days made of
    /// rows that predate the column, and days made of rows that carry it.
    #[test]
    fn usage_sums_across_rows_that_predate_the_cache_column() {
        let db = StudyDb::in_memory();
        db.with(|conn| {
            conn.execute_batch(
                "INSERT INTO token_usage
                     (provider, model, input_tokens, output_tokens, cache_read_tokens, created_at)
                 VALUES ('openai', 'gpt-5', 1000, 100, NULL, strftime('%s','now') * 1000);",
            )?;
            Ok(())
        })
        .unwrap();
        db.record_usage(spend(None, "gpt-5", 2000, 200)).unwrap();

        let buckets = db.usage(7).unwrap();
        let today: i64 = buckets.iter().map(|b| b.input_tokens).sum();
        let cached: i64 = buckets.iter().map(|b| b.cache_read_tokens).sum();

        assert_eq!(today, 3000, "an uncounted row still contributes its input");
        assert_eq!(cached, 0, "and contributes nothing it never recorded");
    }

    #[test]
    fn a_failed_migration_leaves_the_version_where_it_was() {
        // The defect this guards against cost a working journal once, and the
        // symptom arrived nowhere near the cause: the database was stamped v5
        // while still shaped like v4, so `migrate` never tried again and every
        // later call answered `no such table`.
        //
        // A stamp that commits with its steps cannot lie. Here the v5 step is
        // made to fail — `case_file` already exists with the wrong shape — and
        // what matters is that the version does not move.
        let mut conn = journal_at_v4();
        conn.execute_batch("CREATE TABLE case_file (id TEXT PRIMARY KEY);")
            .unwrap();

        assert!(migrate(&mut conn).is_err(), "the step should have failed");

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 4, "a version that did not migrate must not be stamped");
        // And nothing half-applied: the columns the failed step would have
        // added are not there, so the next launch retries from a clean v4.
        assert!(
            conn.query_row("SELECT case_id FROM study_session", [], |_| Ok(()))
                .is_err(),
            "the failed step must have rolled back"
        );
    }

    #[test]
    fn a_journal_from_before_cases_keeps_its_sessions_loose() {
        // The v5 step adds a nullable column and nothing is backfilled. Every
        // session written by a released build genuinely belongs to no case,
        // and inventing one would be worse than the blank.
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE study_session (
                 id         TEXT PRIMARY KEY,
                 kind       TEXT NOT NULL CHECK (kind IN ('tutor', 'case')),
                 title      TEXT NOT NULL,
                 profile    TEXT NOT NULL,
                 language   TEXT NOT NULL,
                 score      INTEGER,
                 verdict    TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE study_message (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                 content    TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE session_structure (
                 session_id TEXT NOT NULL
                            REFERENCES study_session(id) ON DELETE CASCADE,
                 organ_id   TEXT NOT NULL,
                 PRIMARY KEY (session_id, organ_id)
             );
             CREATE TABLE note (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 organ_id    TEXT,
                 organ_label TEXT,
                 session_id  TEXT,
                 body        TEXT NOT NULL,
                 created_at  INTEGER NOT NULL,
                 updated_at  INTEGER NOT NULL
             );
             INSERT INTO study_session
                 (id, kind, title, profile, language, created_at, updated_at)
             VALUES ('old', 'case', 'A drill from before', 'student', 'es', 1, 1);",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();

        migrate(&mut conn).unwrap();

        let case_id: Option<String> = conn
            .query_row("SELECT case_id FROM study_session", [], |row| row.get(0))
            .unwrap();
        assert_eq!(case_id, None, "nothing should have been invented");
    }

    // -- case files --------------------------------------------------------

    #[test]
    fn a_session_says_which_patient_and_which_visit_it_was() {
        // Sixty rows in a list, and no way to tell which belong to whom. The
        // ids are on the row already; carrying them on the summary is what
        // lets the list say so without a query per row.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        db.save_turn(turn("loose", "Q", "A")).unwrap();

        let sessions = db.list_sessions(None, None, None, 50).unwrap();
        let filed = sessions.iter().find(|s| s.id == "s1").unwrap();
        let loose = sessions.iter().find(|s| s.id == "loose").unwrap();

        assert_eq!(filed.case_id.as_deref(), Some("c1"));
        assert_eq!(filed.visit_no, Some(1));
        assert_eq!(loose.case_id, None, "an ordinary conversation belongs to nobody");
        assert_eq!(loose.visit_no, None);
    }

    #[test]
    fn narrowing_to_one_patient_composes_with_the_other_filters() {
        // The three compose in SQL rather than in the caller, so "what did we
        // cover about this structure with this patient" is one question.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.create_case(CaseInput { id: "c2".into(), ..case("c2") }).unwrap();
        let mut first = visit("s1", "c1");
        first.organ_ids = vec!["left_ventricle".into()];
        db.save_turn(first).unwrap();
        db.save_turn(visit("s2", "c2")).unwrap();
        db.save_turn(turn("loose", "Q", "A")).unwrap();

        assert_eq!(db.list_sessions(None, None, Some("c1"), 50).unwrap().len(), 1);
        assert_eq!(
            db.list_sessions(None, Some("left_ventricle"), Some("c1"), 50)
                .unwrap()
                .len(),
            1
        );
        // The same structure, a patient who never touched it.
        assert!(db
            .list_sessions(None, Some("left_ventricle"), Some("c2"), 50)
            .unwrap()
            .is_empty());
        // And no filter still means everything.
        assert_eq!(db.list_sessions(None, None, None, 50).unwrap().len(), 3);
    }

    #[test]
    fn a_case_opens_sealed_and_stays_sealed_until_someone_looks() {
        // The door added in v8, and both sides of it. The seal was never for
        // keeping the reader from their own writing — it was for stopping
        // them tripping over it. So looking is allowed, and recorded.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        assert!(db.list_cases().unwrap()[0].revealed_at.is_none(), "sealed on opening");

        db.case_answer("c1").unwrap();

        let opened = db.list_cases().unwrap()[0].revealed_at;
        assert!(opened.is_some(), "reading the answer records that it was read");
    }

    #[test]
    fn looking_twice_keeps_the_first_time() {
        // `COALESCE`, and it matters: the stamp answers "when did this case
        // stop being sealed", which a second look must not move.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.case_answer("c1").unwrap();
        let first = db.list_cases().unwrap()[0].revealed_at;

        std::thread::sleep(std::time::Duration::from_millis(5));
        db.case_answer("c1").unwrap();

        assert_eq!(db.list_cases().unwrap()[0].revealed_at, first);
    }

    #[test]
    fn a_case_that_is_not_there_is_not_stamped() {
        // No row, no answer, and nothing written — an id typo must not create
        // the impression that some case somewhere was opened.
        let db = StudyDb::in_memory();
        assert!(db.case_answer("ghost").unwrap().is_none());
    }

    #[test]
    fn an_opened_case_stays_opened_across_a_backup() {
        // Otherwise a restore re-seals an answer the reader has already read,
        // and the summary that included it yesterday withholds it today.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.case_answer("c1").unwrap();
        let backup = db.export().unwrap();

        let restored = StudyDb::in_memory();
        restored.import(backup).unwrap();

        assert!(restored.list_cases().unwrap()[0].revealed_at.is_some());
    }

    #[test]
    fn a_case_that_was_never_opened_arrives_still_sealed() {
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        let backup = db.export().unwrap();

        let restored = StudyDb::in_memory();
        restored.import(backup).unwrap();

        assert!(restored.list_cases().unwrap()[0].revealed_at.is_none());
    }

    #[test]
    fn a_case_seals_its_answer_when_it_opens() {
        let db = StudyDb::in_memory();
        let opened = db.create_case(case("c1")).unwrap();

        // Sealed at creation, before anyone has attempted anything.
        assert!(opened.sealed_at > 0);
        assert_eq!(opened.visit_count, 0);
        assert_eq!(
            db.case_answer("c1").unwrap().as_deref(),
            Some("Inferior myocardial infarction; atypical presentation.")
        );
    }

    #[test]
    fn listing_cases_never_carries_the_answer() {
        // The reveal is a deliberate act. A list that carried the answer could
        // spoil a case merely by being rendered — and there is no field on
        // `CaseFile` for it to arrive in.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();

        let listed = db.list_cases().unwrap();
        let json = serde_json::to_string(&listed).unwrap();
        assert!(!json.contains("myocardial"), "the sealed answer leaked: {json}");
    }

    #[test]
    fn findings_are_given_to_the_reader_and_the_answer_is_not() {
        // The distinction this column exists for. Written as one field, an
        // author put "overweight, high blood pressure" — which the reader must
        // be told to reason at all — into the half that may never be said, and
        // the assistant quoted the seal back as "according to the record".
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();

        let listed = &db.list_cases().unwrap()[0];
        assert!(listed.findings.contains("158/94"), "findings are not a secret");

        let json = serde_json::to_string(&db.list_cases().unwrap()).unwrap();
        assert!(json.contains("158/94"));
        assert!(!json.contains("myocardial"), "the answer still must not travel");
    }

    #[test]
    fn a_case_written_before_findings_existed_simply_has_none() {
        // v6 defaults rather than backfills. A case authored when there was
        // one field genuinely has nowhere its findings were recorded, and
        // guessing which half of the sealed text was meant to be visible would
        // be worse than an empty string.
        let mut conn = journal_at_v4();
        migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO case_file
                 (id, title, sex, ground_truth, sealed_at, profile, language,
                  created_at, updated_at)
             VALUES ('old', 'Before', 'male', 'The answer', 1, 'student', 'es', 1, 1)",
            [],
        )
        .unwrap();

        let findings: String = conn
            .query_row("SELECT findings FROM case_file WHERE id = 'old'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(findings, "");
    }

    #[test]
    fn findings_survive_the_backup() {
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();

        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        assert!(target.list_cases().unwrap()[0].findings.contains("Smoker"));
    }

    #[test]
    fn a_case_cannot_be_opened_without_an_answer() {
        let db = StudyDb::in_memory();
        let mut blank = case("c1");
        blank.ground_truth = "   ".into();
        assert!(db.create_case(blank).is_err());
    }

    #[test]
    fn an_unknown_sex_is_rejected() {
        let db = StudyDb::in_memory();
        let mut wrong = case("c1");
        wrong.sex = "unspecified".into();
        assert!(db.create_case(wrong).is_err());
    }

    #[test]
    fn an_impossible_age_is_refused_with_the_bound_in_the_message() {
        let db = StudyDb::in_memory();
        let mut wrong = case("c1");
        wrong.age_years = Some(900);
        let message = db.create_case(wrong).unwrap_err().to_string();
        assert!(message.contains("130"), "unhelpful message: {message}");
    }

    #[test]
    fn visits_are_numbered_in_the_order_they_happen() {
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        db.save_turn(visit("s2", "c1")).unwrap();

        let digest = db.case_digest("c1").unwrap().unwrap();
        assert_eq!(
            digest.visits.iter().map(|v| v.visit_no).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(digest.case.visit_count, 2);
    }

    #[test]
    fn a_second_turn_stays_in_the_visit_it_started() {
        // A visit is a session, and a session spans several turns. Renumbering
        // on every turn would make visit three arrive four times.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();

        let digest = db.case_digest("c1").unwrap().unwrap();
        assert_eq!(digest.visits.len(), 1);
        assert_eq!(digest.visits[0].visit_no, 1);
    }

    #[test]
    fn a_visit_to_a_case_that_is_not_there_is_an_error() {
        // Silently filing it as a loose session would lose the reader's place
        // in the case with nothing on screen to say so.
        let db = StudyDb::in_memory();
        assert!(db.save_turn(visit("s1", "ghost")).is_err());
    }

    #[test]
    fn the_visit_ceiling_is_refused_with_a_way_forward() {
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        for n in 0..MAX_VISITS {
            db.save_turn(visit(&format!("s{n}"), "c1")).unwrap();
        }

        let message = db
            .save_turn(visit("one-too-many", "c1"))
            .unwrap_err()
            .to_string();
        assert!(message.contains("new case"), "no way forward offered: {message}");
    }

    #[test]
    fn the_digest_carries_the_verdict_and_the_structures_it_touched() {
        // This is the whole carried-forward memory, and it is read from SQL.
        // No model call, so it costs the reader nothing and is identical on
        // every machine.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        let mut first = visit("s1", "c1");
        first.organ_ids = vec!["left_ventricle".into(), "right_atrium".into()];
        db.save_turn(first).unwrap();
        db.record_case_result("s1", 72, "Read the ischaemia correctly, missed the timing.")
            .unwrap();

        let digest = db.case_digest("c1").unwrap().unwrap();
        assert_eq!(digest.visits[0].score, Some(72));
        assert!(digest.visits[0].verdict.as_deref().unwrap().contains("timing"));
        assert_eq!(
            digest.visits[0].structures,
            vec!["left_ventricle".to_string(), "right_atrium".to_string()]
        );
        // And the engine gets the script, or it cannot keep the course coherent.
        assert!(digest.ground_truth.contains("myocardial"));
    }

    #[test]
    fn deleting_a_case_leaves_the_readers_work_standing() {
        // `ON DELETE SET NULL`, same call as `token_usage` in v3: tidying the
        // journal must never quietly destroy what the reader did.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();

        db.delete_case("c1").unwrap();

        assert!(db.case_digest("c1").unwrap().is_none());
        let kept = db.session("s1").unwrap().expect("the visit should survive");
        assert_eq!(kept.messages.len(), 2);
    }

    #[test]
    fn an_ordinary_session_is_untouched_by_any_of_this() {
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "Q", "A")).unwrap();

        assert!(db.list_cases().unwrap().is_empty());
        assert!(db.session("s1").unwrap().is_some());
    }

    #[test]
    fn an_unknown_session_kind_is_rejected() {
        let db = StudyDb::in_memory();
        let mut input = turn("s1", "Q", "A");
        input.kind = "exam".into();
        assert!(db.save_turn(input).is_err());
    }

    // -- consumption -------------------------------------------------------

    fn spend(session_id: Option<&str>, model: &str, input: i64, output: i64) -> UsageInput {
        UsageInput {
            session_id: session_id.map(Into::into),
            provider: "google".into(),
            model: model.into(),
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: 0,
        }
    }

    #[test]
    fn usage_is_summed_per_model() {
        let db = StudyDb::in_memory();
        db.record_usage(spend(None, "gemini-3.1-flash-lite", 800, 400)).unwrap();
        db.record_usage(spend(None, "gemini-3.1-flash-lite", 200, 100)).unwrap();
        db.record_usage(spend(None, "gemini-3.1-pro", 50, 25)).unwrap();

        let mut buckets = db.usage(7).unwrap();
        buckets.sort_by(|a, b| a.model.cmp(&b.model));
        assert_eq!(buckets.len(), 2);
        assert_eq!(buckets[0].model, "gemini-3.1-flash-lite");
        assert_eq!(buckets[0].input_tokens, 1000);
        assert_eq!(buckets[0].output_tokens, 500);
        assert_eq!(buckets[0].turns, 2);
        assert_eq!(buckets[1].input_tokens, 50);
    }

    /// The turns worth counting most are the ones that produced nothing: they
    /// cost input tokens and are deliberately never filed as a session.
    #[test]
    fn a_turn_with_no_session_is_still_counted() {
        let db = StudyDb::in_memory();
        db.record_usage(spend(Some("never-written"), "gpt-5.2", 300, 0)).unwrap();

        let buckets = db.usage(7).unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].input_tokens, 300);
    }

    /// Deleting a conversation removes what was said. It cannot un-spend the
    /// tokens, and a total that shrinks when you tidy your journal is one
    /// nobody can reconcile against a provider's bill.
    #[test]
    fn deleting_a_session_keeps_its_spend() {
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "Q", "A")).unwrap();
        db.record_usage(spend(Some("s1"), "claude-sonnet-5", 900, 300)).unwrap();
        db.delete_session("s1").unwrap();

        let buckets = db.usage(7).unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].input_tokens, 900);
        assert_eq!(buckets[0].model, "claude-sonnet-5");
    }

    // -- provenance --------------------------------------------------------

    #[test]
    fn an_answer_remembers_the_model_that_wrote_it() {
        let db = StudyDb::in_memory();
        let mut input = turn("s1", "Why does adrenaline speed the heart?", "Beta-1.");
        input.model = Some("claude-sonnet-5".into());
        input.input_tokens = Some(40_500);
        input.output_tokens = Some(2_565);
        db.save_turn(input).unwrap();

        let messages = db.session("s1").unwrap().unwrap().messages;
        let question = &messages[0];
        let answer = &messages[1];

        assert_eq!(answer.model.as_deref(), Some("claude-sonnet-5"));
        assert_eq!(answer.input_tokens, Some(40_500));
        assert_eq!(answer.output_tokens, Some(2_565));

        // Filing it against the student's own words would claim the model
        // wrote them.
        assert_eq!(question.model, None);
        assert_eq!(question.input_tokens, None);
    }

    /// A turn whose provider reported nothing has no model, and no model is
    /// what it stores. Anything else would look like a fact.
    #[test]
    fn an_answer_with_no_reported_model_stores_none() {
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "Q", "A")).unwrap();
        assert_eq!(db.session("s1").unwrap().unwrap().messages[1].model, None);
    }

    #[test]
    fn provenance_survives_an_export_and_reimport() {
        let source = StudyDb::in_memory();
        let mut input = turn("s1", "Q", "A");
        input.model = Some("gpt-5.2".into());
        input.output_tokens = Some(120);
        source.save_turn(input).unwrap();

        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        let answer = &target.session("s1").unwrap().unwrap().messages[1];
        assert_eq!(answer.model.as_deref(), Some("gpt-5.2"));
        assert_eq!(answer.output_tokens, Some(120));
    }

    // -- symptoms ----------------------------------------------------------

    fn symptom(case_id: &str, organ_id: &str, text: &str) -> SymptomInput {
        SymptomInput {
            case_id: case_id.into(),
            session_id: None,
            organ_id: organ_id.into(),
            organ_label: Some("Left upper limb".into()),
            symptom: text.into(),
            severity: Some(7),
        }
    }

    #[test]
    fn a_symptom_records_where_it_was_marked_not_where_the_cause_is() {
        // The point of the whole table. Pain marked on the left arm, a case
        // whose answer is cardiac: the two ids differing *is* the lesson.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();

        let marked = db
            .add_symptom(symptom("c1", "free_upper_limb_l", "Pain radiating down the arm"))
            .unwrap();

        assert_eq!(marked.organ_id, "free_upper_limb_l");
        assert_eq!(marked.severity, Some(7));
        assert!(db.case_answer("c1").unwrap().unwrap().contains("myocardial"));
    }

    #[test]
    fn symptoms_read_back_in_the_order_they_developed() {
        // A presentation is a sequence. Sorting by anything else would turn a
        // course of illness into a list.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.add_symptom(symptom("c1", "thorax", "Chest tightness")).unwrap();
        db.add_symptom(symptom("c1", "free_upper_limb_l", "Arm pain")).unwrap();

        let marked = db.symptoms("c1").unwrap();
        assert_eq!(
            marked.iter().map(|s| s.symptom.as_str()).collect::<Vec<_>>(),
            vec!["Chest tightness", "Arm pain"]
        );
    }

    #[test]
    fn a_symptom_needs_a_case_that_exists() {
        let db = StudyDb::in_memory();
        assert!(db.add_symptom(symptom("ghost", "thorax", "Pain")).is_err());
    }

    #[test]
    fn a_symptom_needs_something_written_on_it() {
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        assert!(db.add_symptom(symptom("c1", "thorax", "   ")).is_err());
    }

    #[test]
    fn a_severity_outside_the_scale_is_refused_with_the_bound() {
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        let mut wrong = symptom("c1", "thorax", "Pain");
        wrong.severity = Some(50);
        let message = db.add_symptom(wrong).unwrap_err().to_string();
        assert!(message.contains("0 and 10"), "unhelpful message: {message}");
    }

    #[test]
    fn the_digest_carries_the_presentation_as_it_developed() {
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.add_symptom(symptom("c1", "free_upper_limb_l", "Arm pain")).unwrap();

        let digest = db.case_digest("c1").unwrap().unwrap();
        assert_eq!(digest.symptoms.len(), 1);
        assert_eq!(digest.symptoms[0].organ_label.as_deref(), Some("Left upper limb"));
    }

    #[test]
    fn symptoms_go_when_their_case_goes() {
        // The one thing here that is not the reader's own work: a complaint
        // belongs to the invented patient and means nothing without them. The
        // visits still survive — that distinction is the whole reason the two
        // foreign keys differ.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        db.add_symptom(symptom("c1", "thorax", "Chest tightness")).unwrap();

        db.delete_case("c1").unwrap();

        assert!(db.symptoms("c1").unwrap().is_empty());
        assert!(db.session("s1").unwrap().is_some(), "the visit is the reader's work");
    }

    // -- the record that accrues -------------------------------------------

    fn entry(case_id: &str, body: &str) -> FindingInput {
        FindingInput {
            case_id: case_id.into(),
            body: body.into(),
        }
    }

    #[test]
    fn the_record_is_stamped_with_the_visit_it_was_learned_at() {
        // The whole point of v7. Something learned after visit 2 must not read
        // as though it had been on the file since the seal — a reader's answer
        // at visit 2 can only be judged against what visit 2 had been told.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();

        // Nothing filed yet: this is what is known going into the first visit.
        let opening = db.add_finding(entry("c1", "Reports the pain wakes him.")).unwrap();
        assert_eq!(opening.visit_no, 1);

        db.save_turn(visit("s1", "c1")).unwrap();
        db.save_turn(visit("s2", "c1")).unwrap();
        let later = db.add_finding(entry("c1", "Weight down 5 kg. BP 130/85.")).unwrap();

        assert_eq!(later.visit_no, 3, "counted from the visits actually filed");
    }

    #[test]
    fn the_record_accumulates_instead_of_overwriting() {
        // Appended, never edited. A record that can be rewritten backwards
        // grades nothing, which is the same reasoning the seal rests on.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.add_finding(entry("c1", "First")).unwrap();
        db.add_finding(entry("c1", "Second")).unwrap();

        let record = db.findings("c1").unwrap();
        let bodies: Vec<&str> = record.iter().map(|e| e.body.as_str()).collect();
        assert_eq!(bodies, ["First", "Second"], "oldest first, both kept");
    }

    #[test]
    fn the_opening_findings_are_left_exactly_as_sealed() {
        // There is still no method that edits `case_file.findings`, and adding
        // to the record must not become one by the back door.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.add_finding(entry("c1", "Weight down 5 kg.")).unwrap();

        let digest = db.case_digest("c1").unwrap().unwrap();
        assert_eq!(digest.case.findings, "BMI 26. BP 158/94. Smoker, 20/day.");
        assert_eq!(digest.record_updates.len(), 1);
    }

    #[test]
    fn an_empty_record_entry_is_refused() {
        // Same rule as a symptom with no description: a blank row in a medical
        // record is worse than none, because it reads as an observation.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();

        assert!(db.add_finding(entry("c1", "   ")).is_err());
        assert!(db.findings("c1").unwrap().is_empty());
    }

    #[test]
    fn the_record_cannot_be_added_to_a_case_that_is_not_there() {
        let db = StudyDb::in_memory();
        assert!(db.add_finding(entry("ghost", "Anything")).is_err());
    }

    #[test]
    fn the_record_goes_when_its_case_goes() {
        // CASCADE, like the complaints and unlike the visits: this describes
        // the invented patient and means nothing without them.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        db.add_finding(entry("c1", "Weight down 5 kg.")).unwrap();

        db.delete_case("c1").unwrap();

        assert!(db.findings("c1").unwrap().is_empty());
        assert!(db.session("s1").unwrap().is_some(), "the visit is the reader's work");
    }

    #[test]
    fn one_entry_can_be_removed_without_touching_the_rest() {
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        let first = db.add_finding(entry("c1", "Typo")).unwrap();
        db.add_finding(entry("c1", "Keep")).unwrap();

        db.delete_finding(first.id).unwrap();

        let record = db.findings("c1").unwrap();
        assert_eq!(record.len(), 1);
        assert_eq!(record[0].body, "Keep");
    }

    #[test]
    fn the_interval_history_travels_with_its_case() {
        // Backup and restore. The visit stamps are carried across rather than
        // recounted: recounting them against whichever visits happened to
        // travel would restamp the history onto the wrong ones.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        db.add_finding(entry("c1", "Weight down 5 kg. BP 130/85.")).unwrap();
        let backup = db.export().unwrap();

        let restored = StudyDb::in_memory();
        restored.import(backup).unwrap();

        let record = restored.findings("c1").unwrap();
        assert_eq!(record.len(), 1);
        assert_eq!(record[0].body, "Weight down 5 kg. BP 130/85.");
        assert_eq!(record[0].visit_no, 2, "the stamp it was written with");
    }

    #[test]
    fn a_deleted_case_comes_back_from_the_backup_with_its_visits() {
        // Exactly what a backup is for, and exactly what it failed to do:
        // export, delete the patient, restore. The case row came back, the
        // complaints came back, and every visit stayed orphaned — because
        // deleting a case sets `case_id` to NULL on its sessions and the
        // import only ever rewrote transcripts and grades.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        db.save_turn(visit("s2", "c1")).unwrap();
        db.add_symptom(symptom("c1", "thorax", "Chest tightness")).unwrap();
        db.add_finding(entry("c1", "Weight down 5 kg.")).unwrap();
        let backup = db.export().unwrap();

        db.delete_case("c1").unwrap();
        assert!(db.case_digest("c1").unwrap().is_none(), "the case is gone");
        assert!(db.session("s1").unwrap().is_some(), "the visits are not");

        let summary = db.import(backup).unwrap();

        assert_eq!(summary.cases_added, 1);
        let digest = db.case_digest("c1").unwrap().expect("the case is back");
        assert_eq!(
            digest.visits.iter().map(|v| v.visit_no).collect::<Vec<_>>(),
            vec![1, 2],
            "and so are its visits, in order"
        );
        assert_eq!(digest.symptoms.len(), 1);
        assert_eq!(digest.record_updates.len(), 1);
    }

    #[test]
    fn restoring_never_moves_a_visit_to_a_different_case() {
        // The other half of the COALESCE. A session that already belongs to a
        // case keeps it: an import is a merge, and silently re-parenting the
        // reader's own visits would be worse than losing the link.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        let mut backup = db.export().unwrap();

        // The same visit, arriving claiming a different patient.
        let mut other = case("c2");
        other.title = "Someone else".into();
        db.create_case(other).unwrap();
        backup.sessions[0].case_id = Some("c2".into());

        db.import(backup).unwrap();

        let detail = db.session("s1").unwrap().unwrap();
        assert_eq!(detail.session.case_id.as_deref(), Some("c1"));
    }

    #[test]
    fn a_visit_whose_case_never_travelled_stays_an_ordinary_session() {
        // A dangling foreign key would abort the whole restore over one loose
        // visit, which would cost somebody their entire history.
        let db = StudyDb::in_memory();
        db.create_case(case("c1")).unwrap();
        db.save_turn(visit("s1", "c1")).unwrap();
        let mut backup = db.export().unwrap();
        backup.cases.clear();

        let fresh = StudyDb::in_memory();
        fresh.import(backup).unwrap();

        let detail = fresh.session("s1").unwrap().unwrap();
        assert!(detail.session.case_id.is_none());
    }

    // -- cases in the backup -----------------------------------------------

    #[test]
    fn a_case_and_its_visits_survive_an_export_and_reimport() {
        // This is the reader's backup. A case that came back without its
        // visits, or visits that came back detached from their case, would be
        // a restore that quietly loses the thing the journal was kept for.
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        source.save_turn(visit("s1", "c1")).unwrap();
        source.save_turn(visit("s2", "c1")).unwrap();

        let target = StudyDb::in_memory();
        let summary = target.import(source.export().unwrap()).unwrap();

        assert_eq!(summary.cases_added, 1);
        let digest = target.case_digest("c1").unwrap().unwrap();
        assert_eq!(digest.case.sex, "female");
        assert_eq!(digest.case.age_years, Some(58));
        assert_eq!(
            digest.visits.iter().map(|v| v.visit_no).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn the_seal_travels_with_the_case() {
        // A restored case without its sealed answer could never be graded
        // against anything, which would make the backup worthless for the one
        // thing a case is for.
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        let sealed_at = source.list_cases().unwrap()[0].sealed_at;

        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        assert!(target.case_answer("c1").unwrap().unwrap().contains("myocardial"));
        assert_eq!(target.list_cases().unwrap()[0].sealed_at, sealed_at);
    }

    #[test]
    fn importing_the_same_backup_twice_adds_no_cases() {
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        source.save_turn(visit("s1", "c1")).unwrap();
        let backup = source.export().unwrap();

        let target = StudyDb::in_memory();
        target.import(backup).unwrap();
        let again = target.import(source.export().unwrap()).unwrap();

        assert_eq!(again.cases_added, 0);
        assert_eq!(target.list_cases().unwrap().len(), 1);
        assert_eq!(target.case_digest("c1").unwrap().unwrap().visits.len(), 1);
    }

    #[test]
    fn a_visit_whose_case_did_not_travel_lands_as_an_ordinary_session() {
        // A dangling foreign key would abort the whole restore over one loose
        // visit, losing an entire journal to save nothing. Without its case a
        // visit is an ordinary session, which is precisely what it is.
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        source.save_turn(visit("s1", "c1")).unwrap();

        let mut backup = source.export().unwrap();
        backup.cases.clear();

        let target = StudyDb::in_memory();
        target.import(backup).unwrap();

        let kept = target.session("s1").unwrap().expect("the visit should survive");
        assert_eq!(kept.messages.len(), 2);
        assert!(target.list_cases().unwrap().is_empty());
    }

    #[test]
    fn a_journal_written_before_cases_existed_still_restores() {
        // Every backup a released build has written so far has no `cases` key
        // at all. `#[serde(default)]` is what keeps those readable — the same
        // rule that was learned when a required field on an event silently
        // dropped every frame from an older engine.
        let older = r#"{
            "format": "anatria3d.journal",
            "version": 1,
            "exported_at": 1,
            "sessions": [{
                "id": "s1", "kind": "tutor", "title": "T",
                "profile": "student", "language": "es",
                "created_at": 1, "updated_at": 1,
                "messages": [{"role": "user", "content": "Q", "created_at": 1}]
            }],
            "notes": []
        }"#;

        let db = StudyDb::in_memory();
        let parsed: JournalExport = serde_json::from_str(older).unwrap();
        let summary = db.import(parsed).unwrap();

        assert_eq!(summary.sessions_added, 1);
        assert_eq!(summary.cases_added, 0);
        assert!(db.session("s1").unwrap().is_some());
    }

    #[test]
    fn marked_symptoms_survive_the_backup_attached_to_their_visit() {
        // Symptoms are written after the sessions, so the visit they were
        // reported at already exists to point at. Restored the other way round
        // they would all come back detached.
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        source.save_turn(visit("s1", "c1")).unwrap();
        let mut marked = symptom("c1", "free_upper_limb_l", "Arm pain");
        marked.session_id = Some("s1".into());
        source.add_symptom(marked).unwrap();

        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();

        let restored = target.symptoms("c1").unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].organ_id, "free_upper_limb_l");
        assert_eq!(restored[0].severity, Some(7));
        assert_eq!(restored[0].session_id.as_deref(), Some("s1"));
    }

    #[test]
    fn restoring_the_same_backup_twice_does_not_double_the_symptoms() {
        // They ride inside their case, and a case that is already present is
        // skipped whole — which is what makes this a no-op rather than a
        // presentation that grows every time the reader restores.
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        source.add_symptom(symptom("c1", "thorax", "Chest tightness")).unwrap();

        let target = StudyDb::in_memory();
        target.import(source.export().unwrap()).unwrap();
        target.import(source.export().unwrap()).unwrap();

        assert_eq!(target.symptoms("c1").unwrap().len(), 1);
    }

    #[test]
    fn a_symptom_whose_visit_did_not_travel_still_comes_back() {
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        source.save_turn(visit("s1", "c1")).unwrap();
        let mut marked = symptom("c1", "thorax", "Chest tightness");
        marked.session_id = Some("s1".into());
        source.add_symptom(marked).unwrap();

        let mut backup = source.export().unwrap();
        backup.sessions.clear();

        let target = StudyDb::in_memory();
        target.import(backup).unwrap();

        let restored = target.symptoms("c1").unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].session_id, None, "loose, but not lost");
    }

    #[test]
    fn a_case_with_an_impossible_sex_is_skipped_not_fatal() {
        // One bad row must not cost the reader the rest of their history.
        let source = StudyDb::in_memory();
        source.create_case(case("c1")).unwrap();
        let mut backup = source.export().unwrap();
        backup.cases[0].sex = "other".into();

        let target = StudyDb::in_memory();
        let summary = target.import(backup).unwrap();

        assert_eq!(summary.cases_added, 0);
        assert_eq!(summary.skipped, 1);
    }

    #[test]
    fn a_usage_record_needs_a_provider_and_a_model() {
        let db = StudyDb::in_memory();
        assert!(db.record_usage(spend(None, "  ", 10, 10)).is_err());

        let mut nameless = spend(None, "gpt-5.2", 10, 10);
        nameless.provider = "".into();
        assert!(db.record_usage(nameless).is_err());
    }

    #[test]
    fn negative_token_counts_are_refused() {
        let db = StudyDb::in_memory();
        assert!(db.record_usage(spend(None, "gpt-5.2", -1, 10)).is_err());
        assert!(db.record_usage(spend(None, "gpt-5.2", 10, -1)).is_err());
    }

    /// A journal written by 0.1.4 has to keep opening — and arrive with the
    /// consumption table it never had.
    #[test]
    fn a_version_two_journal_gains_the_usage_table() {
        let db = StudyDb::in_memory();
        db.record_usage(spend(None, "gpt-5.2", 10, 5)).unwrap();
        assert_eq!(db.usage(30).unwrap().len(), 1);
    }

    #[test]
    fn a_note_survives_a_conversation_that_was_never_filed() {
        // The bug this exists for, and it made the composer useless: the panel
        // sends the id of the conversation on screen, but a conversation only
        // reaches `study_session` once a turn is filed. Every note started in a
        // fresh chat therefore named a session that did not exist, and the
        // foreign key refused the insert outright -- while saving a note from
        // an answer worked, because that turn was already on disk. The reader
        // met a feature that failed for them and worked for the assistant.
        let db = StudyDb::in_memory();

        let note = db
            .create_note(NoteInput {
                organ_id: Some("left_ventricle".into()),
                organ_label: Some("Ventriculus sinister".into()),
                session_id: Some("never_filed".into()),
                body: "Thickest wall.".into(),
            })
            .unwrap();

        // Written, and honest about what it ended up attached to.
        assert_eq!(note.session_id, None);
        assert_eq!(note.organ_id.as_deref(), Some("left_ventricle"));
        assert_eq!(db.list_notes(None, None, 10).unwrap().len(), 1);
    }

    #[test]
    fn a_note_keeps_the_session_it_was_actually_written_in() {
        // The other half. Dropping the link whenever it was inconvenient would
        // quietly unpick what the link is for: reading a note back beside the
        // conversation that produced it.
        let db = StudyDb::in_memory();
        db.save_turn(turn("s1", "The heart?", "Yes.")).unwrap();

        let note = db
            .create_note(NoteInput {
                organ_id: Some("aorta".into()),
                organ_label: Some("Aorta".into()),
                session_id: Some("s1".into()),
                body: "Arch gives three branches.".into(),
            })
            .unwrap();

        assert_eq!(note.session_id.as_deref(), Some("s1"));
    }
}
