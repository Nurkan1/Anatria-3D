//! Display settings that have to be decided before the window exists.
//!
//! # Stable display
//!
//! On some Windows machines — a particular monitor, driver and card together —
//! the window blinks black for an instant at irregular intervals. It was
//! measured on one: the page drew a steady 60 fps with no dark frame, no stall
//! and no lost GPU context while the screen blinked, so the blink is in how
//! Windows composites the window (DirectComposition and its hardware overlays),
//! not in anything the app draws. Relaunching the webview with DirectComposition
//! off made it go away.
//!
//! It is a switch, off by default, because that path is not free: the window is
//! then composited in software and every WebGL frame is read back to the CPU.
//! Unnoticeable on the machine that needed it, a real cost on a weak one — so
//! only the people who see the blink should pay for the cure.
//!
//! On Linux the webview is WebKitGTK, and its known cause of blinking and blank
//! windows — NVIDIA above all — is the DMA-BUF renderer. The same switch turns
//! that off. Not compositing as a whole, which is the other remedy usually
//! given: that would take hardware acceleration from WebGL and leave the
//! hologram crawling on exactly the modest machines this is meant to spare.
//!
//! The webview's arguments are fixed when it is created, which is before any
//! Tauri setup code runs. So the choice lives in a small file read at the very
//! start of `run`, and a change takes effect on the next launch.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DISPLAY_FILE: &str = "display.json";

/// The variable WebView2 reads its extra browser arguments from.
const WEBVIEW2_ARGS: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

/// What Tauri passes to WebView2 by default. The variable replaces those, so
/// they are carried over rather than silently dropped.
const TAURI_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

const STABLE_ARG: &str = "--disable-direct-composition";

/// WebKitGTK's switch for its DMA-BUF renderer.
const WEBKIT_DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// The platform's identifier folder name, as Tauri derives the data directory.
const IDENTIFIER: &str = "com.pysbg.anatria3d";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettings {
    #[serde(default)]
    pub stable_display: bool,
}

/// What the settings panel shows: the stored choice, and whether this running
/// window was started with it — they differ until the next launch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayStatus {
    pub supported: bool,
    pub stable_display: bool,
    pub active: bool,
}

/// Read the stored choice. A missing or unreadable file is the default, never
/// an error: a display preference must not be able to stop the app starting.
pub fn read(dir: &Path) -> DisplaySettings {
    std::fs::read_to_string(dir.join(DISPLAY_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn write(dir: &Path, settings: DisplaySettings) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(&settings).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(DISPLAY_FILE), text)
}

/// The browser arguments a choice asks for, or `None` to leave Tauri's own.
pub fn browser_args(settings: DisplaySettings) -> Option<String> {
    settings
        .stable_display
        .then(|| format!("{TAURI_DEFAULT_ARGS} {STABLE_ARG}"))
}

/// Whether the switch exists on this platform.
pub const SUPPORTED: bool = cfg!(any(windows, target_os = "linux"));

/// Whether this process's webview was started with stable display.
pub fn active() -> bool {
    if cfg!(windows) {
        std::env::var(WEBVIEW2_ARGS).is_ok_and(|args| args.split_whitespace().any(|arg| arg == STABLE_ARG))
    } else if cfg!(target_os = "linux") {
        std::env::var(WEBKIT_DMABUF).is_ok_and(|value| value == "1")
    } else {
        false
    }
}

/// The app data directory, found without Tauri: this runs before it exists.
/// Tauri puts it in the roaming AppData folder on Windows and in the XDG data
/// folder on Linux, named after the identifier either way.
fn data_dir_before_tauri() -> Option<PathBuf> {
    let root = if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        match std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
            Some(xdg) => PathBuf::from(xdg),
            None => PathBuf::from(std::env::var_os("HOME")?).join(".local").join("share"),
        }
    };
    Some(root.join(IDENTIFIER))
}

/// Apply the stored choice to the webview about to be created.
///
/// Must run first in `run`, while the process is still single-threaded:
/// changing the environment once other threads exist is unsound. A variable
/// someone set themselves is respected and left alone.
pub fn apply_before_window() {
    if !SUPPORTED {
        return;
    }
    let variable = if cfg!(windows) { WEBVIEW2_ARGS } else { WEBKIT_DMABUF };
    if std::env::var_os(variable).is_some() {
        return;
    }
    let Some(dir) = data_dir_before_tauri() else { return };
    let settings = read(&dir);
    if cfg!(windows) {
        if let Some(args) = browser_args(settings) {
            std::env::set_var(WEBVIEW2_ARGS, args);
        }
    } else if settings.stable_display {
        std::env::set_var(WEBKIT_DMABUF, "1");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("anatria3d-display-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn off_by_default_and_when_the_file_is_missing_or_broken() {
        let dir = scratch("missing");
        assert_eq!(read(&dir), DisplaySettings::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(DISPLAY_FILE), "{ not json").unwrap();
        assert!(!read(&dir).stable_display);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stored_choice_reads_back() {
        let dir = scratch("roundtrip");
        write(&dir, DisplaySettings { stable_display: true }).unwrap();
        assert!(read(&dir).stable_display);
        write(&dir, DisplaySettings { stable_display: false }).unwrap();
        assert!(!read(&dir).stable_display);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stable_display_keeps_tauris_defaults_and_adds_one_switch() {
        assert_eq!(browser_args(DisplaySettings::default()), None);
        let args = browser_args(DisplaySettings { stable_display: true }).unwrap();
        assert!(args.starts_with(TAURI_DEFAULT_ARGS));
        assert!(args.ends_with(STABLE_ARG));
    }
}
