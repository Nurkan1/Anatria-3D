mod commands;
// Declared so it compiles and its tests run. Nothing calls it: the control
// bridge's ACL is landed and proven before the pipe that will use it, so this
// module has no reachable call site and the application's behaviour is
// unchanged by its presence.
#[cfg(windows)]
mod control_acl;
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
            }
        });
}
