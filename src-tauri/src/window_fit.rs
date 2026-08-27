//! Bringing the window inside the desktop it opened on.
//!
//! # Why this exists
//!
//! A window larger than the screen is not a cosmetic problem in this
//! application. Everything the reader reaches for most is anchored to an edge —
//! the view controls at the foot of the left panel, the viewpoint bar bottom
//! right, the switch that splits the viewport, the line of keyboard hints. When
//! the lower edge of the window falls behind the taskbar, all of that goes with
//! it, and nothing on screen says so: there is no scrollbar, no clipped border,
//! no hint that the application continues below. From the reader's side the
//! controls have simply not been built.
//!
//! That happened. The window asked for a size that fits a 1080p desktop with
//! about a hundred pixels to spare and did not say where to open, so the
//! placement was left to the platform, which was free to put it low enough to
//! lose the bottom of the interface. `center: true` in the configuration is the
//! first half of the answer. This is the second, and the one that also covers
//! the case the configuration cannot: a screen too small for the requested size
//! at all, where centring alone would hang the window off both ends.
//!
//! # Why it only ever shrinks
//!
//! Growing a window to fill the work area would be a different decision — one
//! about how big the application ought to be, which belongs in the
//! configuration where the reader can see it. This has one job: make sure what
//! was asked for actually fits on the screen it landed on.

use tauri::{PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow};

/// Where a window should sit, and how big its content area should be.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Fit {
    /// The content size, excluding decorations.
    pub inner: PhysicalSize<u32>,
    pub position: PhysicalPosition<i32>,
}

/// Fit a window of content size `inner` into `area`, centred.
///
/// `chrome` is what the decorations add — title bar and borders — which is why
/// the caller measures it as the difference between the outer and inner sizes
/// rather than assuming a number: it varies by platform, by theme, and on
/// Windows by whether the window is using the modern frame.
///
/// The position is clamped to the top-left of the work area rather than being
/// allowed to go negative. When the window is still too large after shrinking —
/// because a minimum size forbids going smaller — something has to be lost, and
/// losing it off the bottom-right is recoverable by dragging or resizing. A
/// window centred off the top has its title bar out of reach, and on Windows
/// that is a window the reader cannot move at all.
pub(crate) fn fit(
    area: PhysicalRect<i32, u32>,
    chrome: PhysicalSize<u32>,
    inner: PhysicalSize<u32>,
) -> Fit {
    let room = PhysicalSize::new(
        area.size.width.saturating_sub(chrome.width),
        area.size.height.saturating_sub(chrome.height),
    );
    let inner = PhysicalSize::new(inner.width.min(room.width), inner.height.min(room.height));

    let outer = PhysicalSize::new(inner.width + chrome.width, inner.height + chrome.height);
    let position = PhysicalPosition::new(
        area.position.x + ((area.size.width as i64 - outer.width as i64) / 2).max(0) as i32,
        area.position.y + ((area.size.height as i64 - outer.height as i64) / 2).max(0) as i32,
    );

    Fit { inner, position }
}

/// Apply [`fit`] to a live window, on the monitor it opened on.
///
/// Every failure here is silent and harmless: a monitor the platform declines
/// to report, a size query that fails. The window is already on screen and
/// usable, and refusing to start over a placement detail would trade a small
/// problem for a total one.
pub(crate) fn fit_to_work_area(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) else {
        return;
    };

    let chrome = PhysicalSize::new(
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    let fitted = fit(*monitor.work_area(), chrome, inner);

    if fitted.inner != inner {
        let _ = window.set_size(fitted.inner);
    }
    let _ = window.set_position(fitted.position);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1080p desktop with a 48px taskbar, which is what this was found on.
    fn desktop_1080p() -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(1920, 1032),
        }
    }

    /// What a standard Windows frame adds around the content.
    fn chrome() -> PhysicalSize<u32> {
        PhysicalSize::new(16, 39)
    }

    #[test]
    fn a_window_that_fits_is_only_centred() {
        let asked = PhysicalSize::new(1440, 860);
        let got = fit(desktop_1080p(), chrome(), asked);

        assert_eq!(got.inner, asked, "a window that fits must not be resized");
        assert_eq!(got.position, PhysicalPosition::new(232, 66));
    }

    #[test]
    fn a_window_taller_than_the_work_area_is_shrunk_to_it() {
        // The configuration before this was found: 900 of content plus the
        // frame is 939, against 1032 of work area. It fits — but only if it is
        // placed within 93 pixels of the top, which nothing guaranteed.
        let got = fit(desktop_1080p(), chrome(), PhysicalSize::new(1440, 1200));

        assert_eq!(got.inner.height, 1032 - 39);
        assert_eq!(
            got.position.y, 0,
            "a window filling the height starts at it"
        );
    }

    /// The laptop this was really about: 1366x768 with a taskbar.
    #[test]
    fn a_small_laptop_keeps_the_whole_interface() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(1366, 728),
        };
        let got = fit(area, chrome(), PhysicalSize::new(1440, 860));

        assert_eq!(got.inner, PhysicalSize::new(1350, 689));
        assert_eq!(got.position, PhysicalPosition::new(0, 0));
    }

    /// A second monitor sitting left of the primary one has a negative origin,
    /// and the window belongs on *it*, not near the origin of the desktop.
    #[test]
    fn the_monitor_origin_is_respected() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(-1920, -200),
            size: PhysicalSize::new(1920, 1032),
        };
        let got = fit(area, chrome(), PhysicalSize::new(1440, 860));

        assert_eq!(got.position, PhysicalPosition::new(-1920 + 232, -200 + 66));
    }

    /// A work area smaller than the decorations themselves must not underflow.
    #[test]
    fn an_absurd_work_area_does_not_panic() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(8, 8),
        };
        let got = fit(area, chrome(), PhysicalSize::new(1440, 860));

        assert_eq!(got.inner, PhysicalSize::new(0, 0));
        assert_eq!(got.position, PhysicalPosition::new(0, 0));
    }
}
