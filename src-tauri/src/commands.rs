//! Tauri commands — the entire surface the webview can reach.
//!
//! Note what is *not* here: there is no command that returns an API key. The
//! frontend can store one, check whether one exists, and clear it. Reading is
//! a crate-private operation used only to fill in the frame we hand to the
//! sidecar over stdin.

use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::State;

use crate::app_log::{AppLog, LogEntry};
use crate::control_bridge::{BridgeError, BridgeStatus, ControlBridge};
use crate::keyring_store::{self, KeyringError, Provider};
use crate::sidecar::{EngineError, EngineHandle, EngineStatus};
use crate::study_db::{
    CaseDigest, CaseFile, CaseFinding, CaseInput, CaseSymptom, FindingInput, ImportSummary,
    JournalExport, Note, NoteInput, SessionDetail, SessionSummary, StudyCoverage, StudyDb,
    StudyError, StudyStats, SymptomInput, TurnInput, UsageBucket, UsageInput,
};

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Keyring(#[from] KeyringError),
    #[error(transparent)]
    Engine(#[from] EngineError),
    #[error(transparent)]
    Study(#[from] StudyError),
    #[error(transparent)]
    Bridge(#[from] BridgeError),
    #[error("{0}")]
    Invalid(String),
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type CommandResult<T> = Result<T, CommandError>;

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_api_key(provider: Provider, api_key: String) -> CommandResult<()> {
    keyring_store::store(provider, &api_key)?;
    Ok(())
}

#[tauri::command]
pub fn has_api_key(provider: Provider) -> bool {
    keyring_store::exists(provider)
}

#[tauri::command]
pub fn delete_api_key(provider: Provider) -> CommandResult<()> {
    keyring_store::delete(provider)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/// Rust models only the two fields it actually needs — `provider` to pick the
/// credential and `request_id` for correlation. Everything else rides along
/// opaquely in `rest` and is validated by Pydantic at the far end. Keeping
/// Rust out of the schema business means the protocol has two owners
/// (TypeScript and Python), not three.
#[derive(Debug, Deserialize)]
pub struct FrontendRequest {
    request_id: String,
    provider: Provider,
    #[serde(flatten)]
    rest: Map<String, Value>,
}

/// Fields the frontend is not permitted to set. `api_key` is the one that
/// matters: silently overwriting a smuggled value would hide a bug or an
/// injection attempt, so we reject the request instead.
const RESERVED_FIELDS: [&str; 2] = ["api_key", "kind"];

fn build_frame(kind: &str, request: FrontendRequest) -> CommandResult<String> {
    if let Some(field) = RESERVED_FIELDS
        .iter()
        .find(|field| request.rest.contains_key(**field))
    {
        return Err(CommandError::Invalid(format!(
            "request must not set the reserved field '{field}'"
        )));
    }

    let api_key = keyring_store::read(request.provider)?;

    let mut frame = request.rest;
    frame.insert("kind".into(), Value::String(kind.into()));
    frame.insert("request_id".into(), Value::String(request.request_id));
    frame.insert(
        "provider".into(),
        serde_json::to_value(request.provider)
            .map_err(|e| CommandError::Invalid(e.to_string()))?,
    );
    frame.insert("api_key".into(), Value::String(api_key));

    serde_json::to_string(&Value::Object(frame))
        .map_err(|e| CommandError::Invalid(e.to_string()))
}

#[tauri::command]
pub fn ask_agent(engine: State<'_, EngineHandle>, request: FrontendRequest) -> CommandResult<()> {
    let frame = build_frame("agent_request", request)?;
    engine.send_frame(&frame)?;
    Ok(())
}

#[tauri::command]
pub fn list_models(engine: State<'_, EngineHandle>, request: FrontendRequest) -> CommandResult<()> {
    let frame = build_frame("list_models", request)?;
    engine.send_frame(&frame)?;
    Ok(())
}

/// Is the engine up, and if not, why?
///
/// The companion to the `ready` event rather than a duplicate of it. That event
/// fires once, before the webview has necessarily attached a listener, so the
/// frontend asks this as soon as it *is* attached: an early `ready` is answered
/// here, a later one arrives as the event, and neither can be missed. The same
/// applies to a spawn failure, which is reported before any frontend exists.
#[tauri::command]
pub fn engine_status(engine: State<'_, EngineHandle>) -> EngineStatus {
    engine.status()
}

/// Restart the analysis engine after a crash.
#[tauri::command]
pub fn restart_engine(app: tauri::AppHandle) -> CommandResult<()> {
    crate::sidecar::restart(&app)?;
    Ok(())
}

#[tauri::command]
pub fn cancel_request(engine: State<'_, EngineHandle>, request_id: String) -> CommandResult<()> {
    let frame = serde_json::json!({ "kind": "cancel", "request_id": request_id });
    engine.send_frame(&frame.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Study journal
//
// Local-only, and the only way the webview can reach the SQLite file: there is
// no filesystem permission in the app, so a note is written through a typed
// command or not at all.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_study_turn(db: State<'_, StudyDb>, turn: TurnInput) -> CommandResult<()> {
    db.save_turn(turn)?;
    Ok(())
}

#[tauri::command]
pub fn record_case_result(
    db: State<'_, StudyDb>,
    session_id: String,
    score: i64,
    verdict: String,
) -> CommandResult<()> {
    db.record_case_result(&session_id, score, &verdict)?;
    Ok(())
}

#[tauri::command]
pub fn list_study_sessions(
    db: State<'_, StudyDb>,
    query: Option<String>,
    organ_id: Option<String>,
    case_id: Option<String>,
    limit: i64,
) -> CommandResult<Vec<SessionSummary>> {
    Ok(db.list_sessions(query.as_deref(), organ_id.as_deref(), case_id.as_deref(), limit)?)
}

#[tauri::command]
pub fn get_study_session(
    db: State<'_, StudyDb>,
    session_id: String,
) -> CommandResult<Option<SessionDetail>> {
    Ok(db.session(&session_id)?)
}

#[tauri::command]
pub fn rename_study_session(
    db: State<'_, StudyDb>,
    session_id: String,
    title: String,
) -> CommandResult<()> {
    db.rename_session(&session_id, &title)?;
    Ok(())
}

#[tauri::command]
pub fn delete_study_session(db: State<'_, StudyDb>, session_id: String) -> CommandResult<()> {
    db.delete_session(&session_id)?;
    Ok(())
}

#[tauri::command]
pub fn create_case(db: State<'_, StudyDb>, case: CaseInput) -> CommandResult<CaseFile> {
    Ok(db.create_case(case)?)
}

#[tauri::command]
pub fn list_cases(db: State<'_, StudyDb>) -> CommandResult<Vec<CaseFile>> {
    Ok(db.list_cases()?)
}

/// Reveal the sealed answer.
///
/// Its own command, and never folded into `list_cases`, so that opening a case
/// cannot spoil it. Revealing is something the reader does on purpose.
#[tauri::command]
pub fn reveal_case_answer(
    db: State<'_, StudyDb>,
    case_id: String,
) -> CommandResult<Option<String>> {
    Ok(db.case_answer(&case_id)?)
}

/// What the next visit carries forward. Read from the journal, never generated.
#[tauri::command]
pub fn case_digest(db: State<'_, StudyDb>, case_id: String) -> CommandResult<Option<CaseDigest>> {
    Ok(db.case_digest(&case_id)?)
}

#[tauri::command]
pub fn delete_case(db: State<'_, StudyDb>, case_id: String) -> CommandResult<()> {
    db.delete_case(&case_id)?;
    Ok(())
}

/// Mark a complaint where the reader points, not where the cause is.
#[tauri::command]
pub fn add_case_symptom(
    db: State<'_, StudyDb>,
    symptom: SymptomInput,
) -> CommandResult<CaseSymptom> {
    Ok(db.add_symptom(symptom)?)
}

#[tauri::command]
pub fn case_symptoms(db: State<'_, StudyDb>, case_id: String) -> CommandResult<Vec<CaseSymptom>> {
    Ok(db.symptoms(&case_id)?)
}

#[tauri::command]
pub fn delete_case_symptom(db: State<'_, StudyDb>, id: i64) -> CommandResult<()> {
    db.delete_symptom(id)?;
    Ok(())
}

/// Add to the record. The sealed answer has no equivalent and never will.
#[tauri::command]
pub fn add_case_finding(
    db: State<'_, StudyDb>,
    finding: FindingInput,
) -> CommandResult<CaseFinding> {
    Ok(db.add_finding(finding)?)
}

#[tauri::command]
pub fn case_findings(db: State<'_, StudyDb>, case_id: String) -> CommandResult<Vec<CaseFinding>> {
    Ok(db.findings(&case_id)?)
}

#[tauri::command]
pub fn delete_case_finding(db: State<'_, StudyDb>, id: i64) -> CommandResult<()> {
    db.delete_finding(id)?;
    Ok(())
}

#[tauri::command]
pub fn create_note(db: State<'_, StudyDb>, note: NoteInput) -> CommandResult<Note> {
    Ok(db.create_note(note)?)
}

#[tauri::command]
pub fn update_note(db: State<'_, StudyDb>, id: i64, body: String) -> CommandResult<()> {
    db.update_note(id, &body)?;
    Ok(())
}

#[tauri::command]
pub fn delete_note(db: State<'_, StudyDb>, id: i64) -> CommandResult<()> {
    db.delete_note(id)?;
    Ok(())
}

#[tauri::command]
pub fn list_notes(
    db: State<'_, StudyDb>,
    organ_id: Option<String>,
    query: Option<String>,
    limit: i64,
) -> CommandResult<Vec<Note>> {
    Ok(db.list_notes(organ_id.as_deref(), query.as_deref(), limit)?)
}

#[tauri::command]
pub fn study_stats(db: State<'_, StudyDb>) -> CommandResult<StudyStats> {
    Ok(db.stats()?)
}

/// Which structures the reader has actually worked on, and how much.
#[tauri::command]
pub fn study_coverage(db: State<'_, StudyDb>) -> CommandResult<Vec<StudyCoverage>> {
    Ok(db.coverage()?)
}

/// File what a finished turn cost.
#[tauri::command]
pub fn record_token_usage(db: State<'_, StudyDb>, usage: UsageInput) -> CommandResult<()> {
    Ok(db.record_usage(usage)?)
}

/// Spend over the last `days` days, one row per local day and model.
#[tauri::command]
pub fn token_usage(db: State<'_, StudyDb>, days: i64) -> CommandResult<Vec<UsageBucket>> {
    Ok(db.usage(days)?)
}

// ---------------------------------------------------------------------------
// Taking the journal with you
//
// **Rust picks the file, not the webview.** A command that accepted a path
// would be a general "write anywhere on this disk" capability handed to the
// renderer, which is precisely what this app has spent its whole design
// avoiding. The dialog is opened here; the frontend never learns a path and
// cannot name one.
//
// **Every command in this section is `async`, and that is not decoration.**
// Tauri runs a non-async command on the main thread. `blocking_save_file` and
// `blocking_pick_file` queue the dialog *onto* the main thread and then block
// the calling thread until it answers — so calling one from the main thread
// leaves it waiting for a message only it could deliver, and the window freezes
// with no dialog and no error. `async` moves the command onto the async
// runtime, which is what the plugin's own documentation prescribes:
//
//   > This is a blocking operation, and should *NOT* be used when running on
//   > the main thread.
//
// Windows tolerated the mistake and Linux did not, which is the worst shape a
// bug can have: it shipped looking tested. Do not drop the `async` back to `fn`
// because the body contains no `.await` — the keyword is load-bearing here for
// where the body runs, not for what it awaits.
// ---------------------------------------------------------------------------

const JOURNAL_EXTENSION: &str = "anatria-journal.json";

#[tauri::command]
pub async fn export_journal(
    app: tauri::AppHandle,
    db: State<'_, StudyDb>,
) -> CommandResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let journal = db.export()?;
    let body = serde_json::to_string_pretty(&journal)
        .map_err(|e| CommandError::Invalid(e.to_string()))?;

    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(JOURNAL_EXTENSION)
        .add_filter("Anatria3D journal", &["json"])
        .blocking_save_file()
    else {
        // Cancelled. Not an error — `None` lets the UI stay quiet.
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| CommandError::Invalid(e.to_string()))?;

    std::fs::write(&path, body).map_err(|e| CommandError::Invalid(e.to_string()))?;
    Ok(Some(path.display().to_string()))
}

/// Save a rendered view as a PNG the reader picks a home for.
///
/// Rust opens the dialog for the same reason it does for the journal: a command
/// that accepted a path would be a general write-anywhere capability handed to
/// the renderer. The extension is forced rather than trusted — this writes PNG
/// bytes, so the file has to be named like one however the dialog came back.
#[tauri::command]
pub async fn save_view_image(
    app: tauri::AppHandle,
    png_base64: String,
) -> CommandResult<Option<String>> {
    use base64::Engine as _;
    use tauri_plugin_dialog::DialogExt;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.as_bytes())
        .map_err(|_| CommandError::Invalid("The image could not be decoded.".into()))?;

    let Some(path) = app
        .dialog()
        .file()
        .set_file_name("anatria3d-view.png")
        .add_filter("PNG image", &["png"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = path
        .into_path()
        .map_err(|e| CommandError::Invalid(e.to_string()))?;
    if path.extension().is_none_or(|ext| !ext.eq_ignore_ascii_case("png")) {
        path.set_extension("png");
    }

    std::fs::write(&path, bytes).map_err(|e| CommandError::Invalid(e.to_string()))?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn import_journal(
    app: tauri::AppHandle,
    db: State<'_, StudyDb>,
) -> CommandResult<Option<ImportSummary>> {
    use tauri_plugin_dialog::DialogExt;

    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Anatria3D journal", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| CommandError::Invalid(e.to_string()))?;

    let body = std::fs::read_to_string(&path).map_err(|e| CommandError::Invalid(e.to_string()))?;
    let journal: JournalExport = serde_json::from_str(&body).map_err(|_| {
        CommandError::Invalid("That file is not an Anatria3D study journal.".into())
    })?;

    Ok(Some(db.import(journal)?))
}

// ---------------------------------------------------------------------------
// Control bridge
// ---------------------------------------------------------------------------

/// What the settings panel draws the switch from.
///
/// Includes this session's pairing token, which is the one credential in this
/// application that is meant to be read from the webview. It is not a secret
/// the way an API key is — it grants the ability to drive a viewport on this
/// machine, it dies when the bridge stops, and its whole purpose is to be
/// copied into another program's configuration by the person sitting here.
#[tauri::command]
pub fn bridge_status(bridge: State<'_, ControlBridge>) -> BridgeStatus {
    bridge.status()
}

/// Turn the bridge on, and connect it to the viewport.
///
/// The closure is the whole of the connection, and it deliberately does no
/// work of its own: it hands the admitted frame to the same function the
/// engine's stdout goes through. Everything that makes a scene command safe —
/// the Zod schema, the discriminated union that cannot match an action it does
/// not know, the single render path through `sceneStore` — is on the far side
/// of it and applies to both callers equally. See [`crate::sidecar::forward_frame`].
///
/// What arrives here has already been through `control_frame::admit`: it is a
/// `scene_command` and nothing else, rebuilt from three fields, carrying a
/// `request_id` the bridge chose rather than the client.
#[tauri::command]
pub fn start_bridge(
    app: tauri::AppHandle,
    bridge: State<'_, ControlBridge>,
) -> CommandResult<BridgeStatus> {
    Ok(bridge.start(move |frame| crate::sidecar::forward_frame(&app, &frame))?)
}

/// Turn it off, and invalidate this session's token with it.
///
/// Returns the new status rather than nothing, so the panel redraws from what
/// the bridge says about itself instead of from what it assumes stopping did.
#[tauri::command]
pub fn stop_bridge(bridge: State<'_, ControlBridge>) -> BridgeStatus {
    bridge.stop();
    bridge.status()
}

// ---------------------------------------------------------------------------
// The application's own record of what happened to it
// ---------------------------------------------------------------------------

/// The recent entries, oldest first.
#[tauri::command]
pub fn read_log(log: State<'_, AppLog>) -> Vec<LogEntry> {
    log.read()
}

/// Where the file lives, so the panel can show it and the reader can find it.
#[tauri::command]
pub fn log_location(log: State<'_, AppLog>) -> Option<String> {
    log.path().map(|path| path.display().to_string())
}

/// Empty it, at the reader's request.
///
/// Returns a result rather than swallowing: this one is a deliberate action
/// with a button behind it, and a clear that quietly did nothing would leave
/// the reader believing they had cleared it.
#[tauri::command]
pub fn clear_log(log: State<'_, AppLog>) -> CommandResult<()> {
    log.clear()
        .map_err(|err| CommandError::Invalid(format!("could not clear the log: {err}")))
}

/// Write a copy of the log wherever the reader chooses.
///
/// A copy rather than a move: the file stays where it is and keeps recording.
/// Given as text rather than by revealing the original, because the point is to
/// attach it to a message — and a path the reader has to go and find is a step
/// most people do not take.
#[tauri::command]
pub async fn save_log_copy(
    app: tauri::AppHandle,
    contents: String,
) -> CommandResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let Some(path) = app
        .dialog()
        .file()
        .set_file_name("anatria3d-log.txt")
        .add_filter("Text file", &["txt"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = path
        .into_path()
        .map_err(|e| CommandError::Invalid(e.to_string()))?;
    if path.extension().is_none_or(|ext| !ext.eq_ignore_ascii_case("txt")) {
        path.set_extension("txt");
    }

    std::fs::write(&path, contents).map_err(|e| CommandError::Invalid(e.to_string()))?;
    Ok(Some(path.display().to_string()))
}

/// Record something the window saw.
///
/// The webview is where most of what goes wrong is visible — storage refused,
/// a manifest that would not load, a scene command rejected — and none of it
/// reaches Rust otherwise. Deliberately infallible: a diagnostic that can fail
/// the caller is one that gets wrapped in a `try` and forgotten.
#[tauri::command]
pub fn log_event(log: State<'_, AppLog>, level: String, source: String, message: String) {
    log.append(&level, &source, &message);
}

