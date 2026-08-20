#!/usr/bin/env bash
# ⚠️  DO NOT USE. Kept only as the record of a failed approach.
#
# Running this and repacking produced an AppImage that **broke the desktop**:
# the screen flickered, a second monitor went blue, and the app stopped
# responding. It has to be understood before anyone tries this again.
#
# The cause is the plugin path, not the plugins. `AppRun.wrapped` exports
#
#     GST_PLUGIN_SYSTEM_PATH_1_0=$APPDIR/usr/lib/gstreamer-1.0
#
# and that variable **replaces** GStreamer's entire search path rather than
# adding to it. Dropping 15 audio plugins into that directory therefore does
# not "add audio support" — it removes every other plugin GStreamer had,
# including the video and GL elements WebKit uses to render. The app then dies
# with
#
#     GStreamer element uritranscodebin not found
#
# after taking the compositor down with it.
#
# Bundling audio plugins into an AppImage is only safe alongside the *whole*
# plugin set WebKit expects, which is a much larger job than this script and
# needs testing on a machine whose display you can afford to lose.
#
# What did fix the microphone was none of this: switching the package target to
# `.deb`, which links against the system GStreamer and needs no bundling at
# all. `tauri://localhost` was never the problem either — wry already registers
# it as a secure scheme.
#
# See docs/experiments/voice.md.
# --------------------------------------------------------------------------
# What follows is the script as it was when it broke the desktop, kept intact
# rather than tidied: the reasoning below reads as sound, and that is the point.
# Every claim in it was true. The conclusion was still wrong.
# --------------------------------------------------------------------------
#
# Why this existed
# ----------------
# WebKitGTK captures audio through GStreamer. `linuxdeploy-plugin-gtk` bundles
# the GStreamer *core libraries* (libgstreamer-1.0.so.0, libgstaudio-…) but none
# of its *plugins*, and a source element lives in a plugin. Inside the AppImage
# WebKit therefore enumerates zero capture devices:
#
#     Audio capture was requested but no device was found amongst 0 devices
#
# which the interface reports, honestly and wrongly, as "No microphone was
# found" on a machine with a working one. The same gap is why every build logs
# `GStreamer element appsink not found`.
#
# Pointing GST_PLUGIN_SYSTEM_PATH at the host's plugins is a diagnosis, not a
# fix: it borrows libraries from the machine, which is the one thing a portable
# AppImage must not do, and it breaks when the host's GStreamer is a different
# version from the bundled core. So the plugins are copied in.
echo "REFUSING TO RUN: this script breaks the desktop. See the comment above." >&2
exit 1

set -euo pipefail

APPDIR="${1:-}"
if [[ -z "$APPDIR" || ! -d "$APPDIR" ]]; then
    echo "usage: $0 <path to Anatria3D.AppDir>" >&2
    exit 2
fi

ARCH_DIR="x86_64-linux-gnu"
SRC="/usr/lib/${ARCH_DIR}/gstreamer-1.0"
if [[ ! -d "$SRC" ]]; then
    echo "no GStreamer plugins at $SRC — install gstreamer1.0-plugins-base and -good" >&2
    exit 1
fi

# `$APPDIR/usr/lib/gstreamer-1.0`, and nowhere else.
#
# linuxdeploy's own AppRun.wrapped already exports
# GST_PLUGIN_SYSTEM_PATH_1_0=$APPDIR/usr/lib/gstreamer-1.0 — a directory it
# never creates. So WebKit is pointed at an empty path, finds no source
# element, and reports "0 devices" on a machine with a working microphone.
#
# This was the actual bug, and it is worth stating how many wrong turns it
# survived: the plugins were bundled (into the wrong directory), the hook was
# written (and not sourced), the hook was sourced (and then overridden by
# AppRun.wrapped, which runs after it), and the GStreamer core versions did
# differ (1.23.90 bundled vs 1.28.6 system) — which looked like a compelling
# root cause and was not one, since removing the bundled core entirely changed
# nothing. The environment of the *web process* is what finally showed it:
# GST_PLUGIN_SYSTEM_PATH_1_0 was set, and pointed somewhere empty.
DEST="$APPDIR/usr/lib/gstreamer-1.0"
mkdir -p "$DEST"

# Only what audio capture and playback need. Copying all 275 plugins would add
# hundreds of megabytes of video codecs, network sources and hardware backends
# that this app never touches.
#
# coreelements   queue, tee, capsfilter — the pipeline itself
# app            appsrc/appsink, which is how WebKit hands buffers to the page
# audio*         convert, resample, parse, test source
# pulseaudio     pulsesrc: the actual microphone on a PipeWire/Pulse desktop
# alsa           fallback capture where there is no sound server
# opus/ogg/matroska/isomp4/wav  encode the clip MediaRecorder produces
WANTED=(
    libgstcoreelements.so
    libgstapp.so
    libgstaudioconvert.so
    libgstaudioresample.so
    libgstaudioparsers.so
    libgstaudiotestsrc.so
    libgstpulseaudio.so
    libgstalsa.so
    libgstopus.so
    libgstopusparse.so
    libgstogg.so
    libgstmatroska.so
    libgstisomp4.so
    libgstwavenc.so
    libgstwavparse.so
    libgsttypefindfunctions.so
)

copied=0
missing=()
for plugin in "${WANTED[@]}"; do
    if [[ -f "$SRC/$plugin" ]]; then
        cp -u "$SRC/$plugin" "$DEST/"
        copied=$((copied + 1))
    else
        missing+=("$plugin")
    fi
done

# The scanner is a helper *binary*, not a library, and GStreamer refuses to
# load plugins out of process without it ("External plugin loader failed").
#
# Take it from the arch-specific path, never from `find | head -1`.
#
# A multiarch machine has two of these, and i386 sorts before x86_64, so the
# naive search copies the **32-bit** scanner. It then fails to load every
# 64-bit plugin with
#     wrong ELF class: ELFCLASS64
# on stderr that nobody reads, GStreamer ends up with no elements, and WebKit
# reports "0 devices" — indistinguishable from having no microphone. That one
# wrong binary is what made the packaged AppImage look unfixable.
SCANNER="/usr/lib/${ARCH_DIR}/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
if [[ ! -f "$SCANNER" ]]; then
    SCANNER="$(find "/usr/lib/${ARCH_DIR}" -name gst-plugin-scanner -type f 2>/dev/null | head -1 || true)"
fi
if [[ -n "$SCANNER" ]]; then
    cp -f "$SCANNER" "$DEST/"
fi

# The hook runs before the app starts, in the same way the GTK one does.
# GST_PLUGIN_SYSTEM_PATH_1_0 rather than GST_PLUGIN_PATH: the former *replaces*
# the default search path, so the bundled plugins are used instead of whatever
# version the host happens to have, which is the whole point of a portable
# bundle.
# The plugin *path* is left to AppRun.wrapped, which sets it correctly and
# would override anything set here anyway — it runs after the hooks. What it
# does not provide is the scanner binary, without which GStreamer logs
# "External plugin loader failed" and loads nothing.
cat > "$APPDIR/apprun-hooks/anatria-gstreamer.sh" <<'HOOK'
#! /usr/bin/env bash
# Voice experiment: the scanner and a private registry for the bundled plugins.
export APPDIR="${APPDIR:-"$(dirname "$(realpath "$0")")"}"
export GST_PLUGIN_SCANNER_1_0="$APPDIR/usr/lib/gstreamer-1.0/gst-plugin-scanner"
# A stale registry from another build enumerates plugins that are not here.
export GST_REGISTRY_1_0="${XDG_CACHE_HOME:-$HOME/.cache}/anatria3d/gstreamer.registry"
HOOK
chmod +x "$APPDIR/apprun-hooks/anatria-gstreamer.sh"

# linuxdeploy's AppRun sources hooks by *explicit name*, not by globbing the
# directory — it contains exactly one `source .../linuxdeploy-plugin-gtk.sh`
# line. Dropping a script into apprun-hooks/ therefore does nothing at all,
# which cost an hour: the plugins were bundled correctly, the hook was present
# and executable, and the app still enumerated zero devices because nothing
# ever ran it.
APPRUN="$APPDIR/AppRun"
if ! grep -q "anatria-gstreamer.sh" "$APPRUN"; then
    sed -i 's|^exec "$this_dir"/AppRun.wrapped|source "$this_dir"/apprun-hooks/"anatria-gstreamer.sh"\n\nexec "$this_dir"/AppRun.wrapped|' "$APPRUN"
    echo "patched AppRun to source the hook"
fi

echo "bundled $copied GStreamer plugins into $DEST"
if [[ ${#missing[@]} -gt 0 ]]; then
    echo "not found on this system (may be fine): ${missing[*]}"
fi
