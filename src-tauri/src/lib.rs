mod commands;
mod keyring_store;
pub(crate) mod sidecar;
mod study_db;

use tauri::{Manager, RunEvent, WindowEvent};

use sidecar::EngineHandle;
use study_db::StudyDb;

/// Filename of the study journal inside the app data directory.
const STUDY_DB: &str = "study.db";

/// Grant the microphone, on Linux only.
///
/// WebKitGTK routes every permission request to the embedder and **denies by
/// default when nobody answers**. Tauri installs no handler, so on Linux
/// `getUserMedia` resolves with no audio track and no error anywhere — the
/// silent failure the voice experiment would otherwise start from. WebView2 on
/// Windows grants from its own settings and needs none of this.
///
/// Only `UserMedia` for audio is granted. Every other request — video,
/// geolocation, notifications — is refused explicitly rather than falling
/// through to a default, because this app has no business asking for any of
/// them and a blanket "allow" would be a far larger permission surface than
/// the feature needs.
///
/// Part of the local voice experiment (branch `experiment/voice`).
/// Switch on WebKitGTK's media-stream support, on Linux only.
///
/// **This is the block that stops the microphone in a packaged build.**
///
/// `enable-media-stream` and `enable-webrtc` are WebKitSettings properties and
/// both default to **false**. While they are off, WebKit does not expose
/// `navigator.mediaDevices` at all — there is no error, no permission prompt
/// and nothing in the log, because from the page's point of view the API
/// simply does not exist. The button appears to do nothing.
///
/// Nothing in the stack turns them on: wry creates the webview with default
/// settings, and Tauri exposes no configuration for them. They have to be set
/// on the live `WebView`'s settings after it is built.
///
/// Note this is **not** the secure-context problem it first looks like. wry
/// already calls `register_uri_scheme_as_secure` for the custom protocol (see
/// `wry/src/webkitgtk/web_context.rs`), so `tauri://localhost` is already a
/// secure origin. Two different switches, the same silent symptom.
///
/// Part of the local voice experiment (branch `experiment/voice`).
#[cfg(target_os = "linux")]
fn enable_media_stream(window: &tauri::WebviewWindow) {
    use webkit2gtk::{SettingsExt, WebViewExt};

    let _ = window.with_webview(|webview| {
        if let Some(settings) = WebViewExt::settings(&webview.inner()) {
            // Read before writing, and say so: this is how the dev/packaged
            // difference was finally measured rather than assumed. In `tauri
            // dev` on this machine `media_stream` reads back **true before it
            // is set**, which is why dev worked all along and the packaged
            // build did not. Cheap, one line at startup, and the next person
            // to chase a silent microphone will want it.
            eprintln!(
                "[webkit] media_stream={} webrtc={} media_capabilities={}",
                settings.enables_media_stream(),
                settings.enables_webrtc(),
                settings.enables_media_capabilities(),
            );
            settings.set_enable_media_stream(true);
            settings.set_enable_webrtc(true);
        }
    });
}

/// Belt-and-braces: assert that `tauri://` is a secure origin, on Linux only.
///
/// **Redundant, and kept deliberately.** wry already does this when it
/// registers the custom protocol — `register_uri_scheme_as_secure`, under the
/// comment "Enable secure context", in `wry/src/webkitgtk/web_context.rs`. So
/// the origin is already trustworthy and this changes nothing today.
///
/// It stays because it is idempotent, costs nothing, and pins an assumption
/// this feature depends on: `getUserMedia` and `MediaRecorder` are
/// secure-context APIs, and if a future wry dropped that registration the
/// microphone would break with no error and no log line. Cheaper to state than
/// to rediscover.
///
/// It is **not** what fixed the packaged build — that is
/// `enable_media_stream` above. This function was written on the theory that
/// the origin was insecure, which reading wry's source disproved; the comment
/// is corrected rather than the code deleted.
///
/// Part of the local voice experiment (branch `experiment/voice`).
#[cfg(target_os = "linux")]
fn register_tauri_scheme_as_secure(window: &tauri::WebviewWindow) {
    use webkit2gtk::{SecurityManagerExt, WebContextExt, WebViewExt};

    let _ = window.with_webview(|webview| {
        if let Some(context) = webview.inner().context() {
            if let Some(manager) = context.security_manager() {
                manager.register_uri_scheme_as_secure("tauri");
            }
        }
    });
}

#[cfg(target_os = "linux")]
fn grant_microphone(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::prelude::Cast;
    use webkit2gtk::{
        PermissionRequestExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt,
        WebViewExt,
    };

    let _ = window.with_webview(|webview| {
        let view = webview.inner();
        view.connect_permission_request(|_view, request| {
            // Downcast rather than match: the audio-only check is what keeps
            // this from also handing over the camera.
            if let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() {
                if media.is_for_audio_device() && !media.is_for_video_device() {
                    request.allow();
                    return true;
                }
            }
            request.deny();
            true
        });
    });
}

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
            commands::transcribe_audio,
            commands::speak_text,
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

            // Voice experiment: WebKitGTK denies the microphone unless the
            // embedder answers. Failing to find the window must not take the
            // app down — voice degrades to the typed interface, which is the
            // rule for every part of this feature.
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                // Order matters only in that both must run before the page
                // asks: the scheme registration is what makes the API exist at
                // all, the permission handler is what answers when it is used.
                // Order matters: the API has to exist before a permission
                // for it means anything.
                enable_media_stream(&window);
                register_tauri_scheme_as_secure(&window);
                grant_microphone(&window);
            }

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
