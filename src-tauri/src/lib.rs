mod commands;
// The control bridge. `control_bridge` is the only one of these the rest of the
// application names; the others are its parts and reach the app through it.
//
// It is off unless the reader turns it on, and what it admits is counted and
// dropped — the sink is supplied at the call site below and does nothing yet.
#[cfg(windows)]
mod control_acl;
mod control_bridge;
#[cfg(windows)]
mod control_frame;
#[cfg(windows)]
mod control_listener;
#[cfg(windows)]
mod control_pairing;
#[cfg(windows)]
mod control_pipe;
mod keyring_store;
pub(crate) mod sidecar;
mod study_db;

use tauri::{Manager, RunEvent, WindowEvent};

use control_bridge::ControlBridge;
use sidecar::EngineHandle;
use study_db::StudyDb;

/// Filename of the study journal inside the app data directory.
const STUDY_DB: &str = "study.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(EngineHandle::default())
        // Managed, not started. Constructing it opens nothing: there is no
        // pipe until `start_bridge` is called from the settings panel.
        .manage(ControlBridge::default())
        .invoke_handler(tauri::generate_handler![
            commands::save_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::ask_agent,
            commands::list_models,
            commands::engine_status,
            commands::restart_engine,
            commands::cancel_request,
            commands::save_study_turn,
            commands::record_case_result,
            commands::list_study_sessions,
            commands::get_study_session,
            commands::rename_study_session,
            commands::delete_study_session,
            commands::create_case,
            commands::list_cases,
            commands::reveal_case_answer,
            commands::case_digest,
            commands::delete_case,
            commands::add_case_symptom,
            commands::case_symptoms,
            commands::delete_case_symptom,
            commands::add_case_finding,
            commands::case_findings,
            commands::delete_case_finding,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::list_notes,
            commands::study_stats,
            commands::study_coverage,
            commands::record_token_usage,
            commands::token_usage,
            commands::export_journal,
            commands::import_journal,
            commands::save_view_image,
            commands::bridge_status,
            commands::start_bridge,
            commands::stop_bridge,
        ])
        .setup(|app| {
            // The journal is opened before anything else can ask for it, and
            // opening it cannot fail — an unusable database degrades to "saving
            // is broken", never to "the atlas will not start".
            let study_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join(STUDY_DB);
            app.manage(StudyDb::open(&study_path));

            // A failed engine start must not take the window down with it: the
            // 3D viewer, the anatomy tree and the i18n layer are all useful
            // without AI. The frontend learns about it through the error event.
            if let Err(err) = sidecar::spawn(app.handle()) {
                eprintln!("[engine] {err}");
                let _ = tauri::Emitter::emit(
                    app.handle(),
                    sidecar::ENGINE_EVENT,
                    serde_json::json!({
                        "type": "error",
                        "request_id": serde_json::Value::Null,
                        "code": "internal_error",
                        "message": err.to_string(),
                    }),
                );
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                window.app_handle().state::<EngineHandle>().shutdown();
                // The pipe would go with the process anyway. Closed here so
                // that "the window is gone" and "nothing is listening" are the
                // same moment rather than nearly the same one.
                window.app_handle().state::<ControlBridge>().stop();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Anatria3D")
        .run(|app, event| {
            // Belt and braces: `Destroyed` covers the normal close, this covers
            // the paths that skip it. Leaving a Python process behind after the
            // window is gone is the classic Tauri-sidecar failure mode.
            if matches!(event, RunEvent::Exit) {
                app.state::<EngineHandle>().shutdown();
                app.state::<ControlBridge>().stop();
            }
        });
}
