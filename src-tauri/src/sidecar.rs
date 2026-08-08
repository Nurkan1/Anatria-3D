//! Ownership and lifecycle of the Python engine sidecar.
//!
//! Rust owns this process, not the frontend. That is what lets the API key be
//! read from the OS keyring and handed to the engine over stdin without ever
//! entering the webview's JavaScript context, and it means there is no
//! localhost port for another process on the machine to talk to.
//!
//! # Why `std::process` instead of Tauri's shell plugin
//!
//! Tauri's `externalBin`/sidecar mechanism copies a **single file**. PyInstaller
//! `--onedir` produces an executable plus an `_internal/` tree of shared
//! libraries, so it does not fit. The alternative, `--onefile`, is worse for us:
//! its bootloader unpacks to a temp directory and re-executes itself as a child
//! process, so killing the PID we know about can leave a live Python
//! interpreter behind — the classic orphaned-sidecar bug.
//!
//! Driving `std::process::Command` ourselves keeps `--onedir` (one process, one
//! PID, `kill` actually reaps it) and lets the app ship with **no shell
//! permission at all** — the webview cannot spawn anything, by construction.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

/// Directory name the engine build is staged under, in both the dev tree and
/// the bundled resource directory.
const ENGINE_DIR: &str = "anatria-engine";

#[cfg(windows)]
const ENGINE_EXE: &str = "anatria-engine.exe";
#[cfg(not(windows))]
const ENGINE_EXE: &str = "anatria-engine";

/// Single channel carrying every engine frame to the frontend. The frontend
/// validates each one with Zod and routes on `type`, so Rust does not need to
/// model the event union — one fewer place for the protocol to drift.
pub const ENGINE_EVENT: &str = "anatria://engine-event";

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("the analysis engine is not running")]
    NotRunning,
    #[error("the analysis engine binary was not found at {0}. Run `pnpm sidecar:build`.")]
    Missing(String),
    #[error("failed to start the analysis engine: {0}")]
    Spawn(String),
    #[error("failed to send request to the analysis engine: {0}")]
    Write(String),
    #[error("{0}")]
    Internal(String),
}

impl serde::Serialize for EngineError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Managed state holding the running child process and its stdin.
#[derive(Default)]
pub struct EngineHandle {
    inner: Mutex<Option<Running>>,
    /// Whether the engine has announced itself.
    ///
    /// `ready` is emitted once, the instant the sidecar finishes booting, and
    /// the webview may not have attached its listener yet — Rust spawns the
    /// process in `setup()`, long before the window has loaded a line of
    /// JavaScript. Whoever wins that race decided whether the app worked, and a
    /// lost frame left the composer disabled for ever with no way back.
    ///
    /// Remembering it turns a one-shot event into a fact that can be asked for.
    ready: AtomicBool,
    /// Why the engine is not running, for the same reason.
    ///
    /// A spawn failure is reported from `setup()`, before the window has loaded
    /// any JavaScript, so that event is *always* lost. Without this, a missing
    /// engine binary shows as a bare "offline" badge with nothing to act on.
    last_error: Mutex<Option<String>>,
}

/// What the frontend needs to render the engine's state honestly.
#[derive(Debug, Default, serde::Serialize)]
pub struct EngineStatus {
    pub ready: bool,
    pub error: Option<String>,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
}

impl EngineHandle {
    /// Whether the engine is up, and if not, why.
    pub fn status(&self) -> EngineStatus {
        EngineStatus {
            ready: self.ready.load(Ordering::Acquire),
            error: self.last_error.lock().ok().and_then(|held| held.clone()),
        }
    }

    fn set_ready(&self, ready: bool) {
        self.ready.store(ready, Ordering::Release);
        if ready {
            // A working engine clears whatever went wrong last time, so a
            // successful restart does not keep showing the crash that preceded it.
            self.note_failure(None);
        }
    }

    pub(crate) fn note_failure(&self, reason: Option<String>) {
        if let Ok(mut held) = self.last_error.lock() {
            *held = reason;
        }
    }

    /// Write one NDJSON frame to the engine's stdin.
    ///
    /// `frame` contains the user's API key. It is never logged here, and the
    /// error paths surface only the transport failure, never the payload.
    pub fn send_frame(&self, frame: &str) -> Result<(), EngineError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| EngineError::Internal("engine handle poisoned".into()))?;
        let running = guard.as_mut().ok_or(EngineError::NotRunning)?;

        running
            .stdin
            .write_all(frame.as_bytes())
            .and_then(|()| running.stdin.write_all(b"\n"))
            .and_then(|()| running.stdin.flush())
            .map_err(|e| EngineError::Write(e.to_string()))
    }

    /// Terminate the child. Safe to call more than once.
    pub fn shutdown(&self) {
        self.set_ready(false);
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        let Some(mut running) = guard.take() else {
            return;
        };

        // Ask first so the engine can cancel in-flight work and exit cleanly,
        // then drop stdin so it sees EOF even if the write failed.
        let _ = running.stdin.write_all(b"{\"kind\":\"shutdown\"}\n");
        let _ = running.stdin.flush();
        drop(running.stdin);

        // `--onedir` means one process and one PID, so this reaps the whole
        // engine rather than just a bootloader.
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

/// Locate the engine executable: the dev build tree first, then the bundled
/// resource directory.
fn engine_path(app: &AppHandle) -> Result<PathBuf, EngineError> {
    let mut tried = Vec::new();

    if cfg!(debug_assertions) {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("engine")
            .join("dist")
            .join(ENGINE_DIR)
            .join(ENGINE_EXE);
        if dev.is_file() {
            return Ok(dev);
        }
        tried.push(dev.display().to_string());
    }

    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| EngineError::Internal(e.to_string()))?
        .join(ENGINE_DIR)
        .join(ENGINE_EXE);
    if bundled.is_file() {
        return Ok(bundled);
    }
    tried.push(bundled.display().to_string());

    Err(EngineError::Missing(tried.join(" | ")))
}

/// Stop any running engine and start a fresh one.
///
/// Without this a crashed or externally-killed engine leaves the app dead until
/// it is restarted — the window still works, but every question fails and there
/// is no way back. Recovery belongs in the app, not in the user's task manager.
pub fn restart(app: &AppHandle) -> Result<(), EngineError> {
    app.state::<EngineHandle>().shutdown();
    spawn(app)
}

/// Spawn the sidecar and pump its stdout into the frontend event channel.
pub fn spawn(app: &AppHandle) -> Result<(), EngineError> {
    // Cleared up front: a restart must not leave the previous engine's "ready"
    // standing while the new one is still booting.
    app.state::<EngineHandle>().set_ready(false);
    match start(app) {
        Ok(()) => Ok(()),
        Err(err) => {
            // Recorded rather than only returned, so the reason survives until
            // a frontend exists to ask for it.
            app.state::<EngineHandle>()
                .note_failure(Some(err.to_string()));
            Err(err)
        }
    }
}

fn start(app: &AppHandle) -> Result<(), EngineError> {
    let exe = engine_path(app)?;

    let mut command = Command::new(&exe);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // The engine loads its libraries relative to its own directory.
    if let Some(dir) = exe.parent() {
        command.current_dir(dir);
    }

    // Keep a console window from flashing up next to the app on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| EngineError::Spawn(format!("{} ({e})", exe.display())))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| EngineError::Spawn("engine stdin unavailable".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| EngineError::Spawn("engine stdout unavailable".into()))?;
    let stderr = child.stderr.take();

    {
        let handle = app.state::<EngineHandle>();
        let mut guard = handle
            .inner
            .lock()
            .map_err(|_| EngineError::Internal("engine handle poisoned".into()))?;
        *guard = Some(Running { child, stdin });
    }

    // stdout carries protocol frames, one JSON object per line.
    let frames_app = app.clone();
    std::thread::Builder::new()
        .name("engine-stdout".into())
        .spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => forward_frame(&frames_app, &line),
                    Err(err) => {
                        eprintln!("[engine] stdout read failed: {err}");
                        break;
                    }
                }
            }
            // Reaching here means the engine closed stdout — it has exited.
            let handle = frames_app.state::<EngineHandle>();
            handle.set_ready(false);
            handle.note_failure(Some("The analysis engine stopped unexpectedly.".into()));
            let _ = frames_app.emit(
                ENGINE_EVENT,
                serde_json::json!({
                    "type": "error",
                    "request_id": Value::Null,
                    "code": "internal_error",
                    "message": "The analysis engine stopped unexpectedly.",
                }),
            );
        })
        .map_err(|e| EngineError::Spawn(e.to_string()))?;

    // stderr is diagnostics only — logged, never forwarded to the UI.
    if let Some(stderr) = stderr {
        std::thread::Builder::new()
            .name("engine-stderr".into())
            .spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    eprintln!("[engine] {line}");
                }
            })
            .ok();
    }

    Ok(())
}

fn forward_frame(app: &AppHandle, line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }

    match serde_json::from_str::<Value>(line) {
        Ok(value) => {
            // Recorded before the emit, so a frontend that queries the moment
            // it receives the event never sees a stale `false`.
            if value.get("type").and_then(Value::as_str) == Some("ready") {
                app.state::<EngineHandle>().set_ready(true);
            }
            let _ = app.emit(ENGINE_EVENT, value);
        }
        Err(err) => {
            // A non-JSON line on stdout means something in the engine wrote
            // past the protocol (a stray print, a library banner). Log it and
            // keep going rather than tearing down a working session.
            eprintln!("[engine] non-protocol stdout line ({err}): {line}");
        }
    }
}
