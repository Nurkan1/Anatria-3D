# Local voice experiment — speech in, speech out

Branch `experiment/voice`. **Never pushed, never a PR.** `main` stays exactly as
released; this may be thrown away.

## Decisions taken with Nurcan

**Engine: local.** `faster-whisper` for speech-to-text, `piper` for speech-out.
No key, no network, so the application's central claim — the audio never leaves
the machine — stays intact. The alternative (OpenAI transcription + TTS) was
rejected for this experiment because sending microphone audio off the machine
is precisely what the demo is meant to show it does not do.

**Spoken regulatory notice: not added.** The notice stays visual only, as it is
today. Raised with Nurcan explicitly and decided by him — see "The open
question" below, which is not closed by this decision, only deferred.

## Size cost of the local engine — measured, reported, not decided

The frozen sidecar today is **97 MB**. Measured on disk in the virtualenv, the
voice engines add:

| Package | Size |
| --- | --- |
| `onnxruntime` (runs the piper voice) | 66 MB |
| `ctranslate2` (runs whisper) | 60 MB |
| `piper` | 46 MB |
| `numpy` | 43 MB |
| `av` (audio decode) | 32 MB |
| `tokenizers` | 11 MB |
| `faster_whisper` | 1.5 MB |
| **Total** | **~260 MB**, plus 9 smaller packages |

Model weights are downloaded at first use and are **not** in that total:

- the whisper `base` model — ~142 MB as cached here,
- each piper voice — ~61 MB for the one language tried so far, and there are
  three in `_PIPER_VOICES`.

So a build that shipped voice for all three languages would be roughly
**97 MB → 500 MB+**. That is not a rounding error on an installer.

`engine/pyproject.toml` is deliberately untouched, the imports in `voice.py`
are deferred inside functions, and `COLLECT_ALL` in `build_sidecar.py` does not
mention them.

**That is not enough to keep them out of a build, and assuming it was would
have been wrong.** PyInstaller ships hooks for these packages and collects them
from whatever virtualenv the freeze runs in, deferred imports or not. Measured,
not predicted:

    engine/dist/anatria-engine   97 MB  ->  434 MB

So installing the wheels into `.venv` is by itself enough to more than
quadruple the frozen sidecar, with no manifest change anywhere.

### And it breaks the AppImage

The bundle then fails outright:

    ERROR: Could not find dependency: libgomp-e985bcbb.so.1.0.0
    ERROR: Failed to deploy dependencies for existing files
    failed to bundle project: `failed to run linuxdeploy`

The library is present — twice, at `_internal/libgomp-e985bcbb.so.1.0.0` and
`_internal/ctranslate2.libs/` — but it is a hash-suffixed private copy that
`ctranslate2` carries for OpenMP, and `linuxdeploy` resolves dependencies
against the system linker path, where that name does not exist. **A .deb or an
AppImage cannot be built while the voice wheels are in the virtualenv**, unless
linuxdeploy is told about that directory.

The consequence for the release pipeline is the part that matters: this is not
a "voice is bigger" problem that can be deferred to a promotion decision. It
stops the existing Linux packaging from building at all, which is why the voice
wheels must not be installed into a virtualenv that also builds releases.

### Working locally without breaking packaging

Removing the wheels and rebuilding the sidecar restores a 99 MB engine, but
that alone is **not** enough — the stale AppDir is staged from a second
directory and keeps the old files:

    .venv/bin/pip uninstall -y faster-whisper piper-tts ctranslate2 onnxruntime av
    pnpm sidecar:build
    rm -rf src-tauri/target/release/bundle/appimage \
           src-tauri/target/release/bundle/appimage_deb
    NO_STRIP=true pnpm tauri build --bundles appimage

Clearing only `bundle/appimage/` reproduces the identical `libgomp` error from
a build that no longer has any voice code in it, which is a confusing hour if
you do not know to look in `appimage_deb/`. Verified: with both cleared the
AppImage bundles normally again.

The tests still pass with the engines gone — that is deliberate. `test_voice.py`
loads no model and is written to run either way, so the suite is green whether
or not voice is installed.

## The rule that decides the architecture

All network I/O lives in the Python sidecar; nothing else opens a socket. With
the local engine there is no network I/O at all, which is the strongest form of
that rule.

    microphone -> webview records -> audio over IPC -> Rust -> sidecar
    sidecar transcribes (faster-whisper) -> text back -> webview
    sidecar synthesises (piper) -> audio bytes back -> webview plays a Blob

Unchanged and not to be changed:

- **The CSP.** `media-src 'self' blob:` already permits playing synthesised
  audio from a Blob. `connect-src` has no external host and gains none. Wanting
  to edit the CSP means the design is wrong.
- **The keyring boundary.** `keyring_store::read` is `pub(crate)`; the exposed
  commands are `save_api_key` / `has_api_key` / `delete_api_key`. No command
  returns a key and none is added. The local engine needs no key at all.

## A real hazard found in the existing code

`src-tauri/src/sidecar.rs`, in `forward_frame`, logs the **entire raw line**
when a frame fails to parse:

    eprintln!("[engine] non-protocol stdout line ({err}): {line}");

Today that channel carries text. Once synthesised speech travels back as
base64, one malformed frame writes **a recording of somebody's voice into a log
file** — the thing the brief says must never happen. This is pre-existing and
harmless now; voice is what makes it real. It must be truncated before any
audio crosses that boundary.

The Python side is already clean: `_summarise_validation_error` emits only
Pydantic's `loc` and `msg`, never input values, and `api_key` carries
`repr=False`. Audio fields get the same `repr=False` treatment, following the
existing idiom.

## The microphone in a packaged AppImage — found the hard way

The brief predicted trouble here and was right, but not in the place it
expected. Two separate things had to be fixed, and only one of them is
permissions.

**1. WebKitGTK asks the embedder, and denies when nobody answers.** Tauri
installs no handler, so on Linux `getUserMedia` resolves with no audio track
and no error anywhere. `grant_microphone` in `src-tauri/src/lib.rs` answers it —
allowing audio-only `UserMedia` and explicitly denying everything else, so the
camera and geolocation are not swept in by a blanket "allow".

**2. The AppImage has no GStreamer element to open a microphone with.** This is
the one that actually bit. WebKitGTK captures audio through GStreamer, and
`linuxdeploy-plugin-gtk` bundles the GStreamer **core libraries** but none of
its **plugins**:

    AppDir:  libgstreamer-1.0.so.0, libgstaudio-1.0.so.0, libgstapp-1.0.so.0, … (13 core libs)
    Missing: libgstpulseaudio.so, libgstcoreelements.so, …

So the permission is granted, and then there is no `pulsesrc` to grant it to.
The symptom is indistinguishable from having no microphone — which is exactly
what the interface reported, honestly and wrongly: *"No microphone was found"*
on a laptop with a working ALC255.

The same gap is why `GStreamer element appsink not found` has been in the log
of every build for as long as anyone has looked.

**Verified, not guessed.** Running the identical AppImage with the system
plugins exposed makes the Speak button appear:

    GST_PLUGIN_SYSTEM_PATH=/usr/lib/x86_64-linux-gnu/gstreamer-1.0 \
    GST_PLUGIN_SCANNER=/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner \
    ./Anatria3D_0.2.0_amd64.AppImage

Both variables are needed; the path alone produces *"External plugin loader
failed"*.

That is a diagnosis, **not a shipping fix** — it borrows the host's plugins,
which is precisely what a portable AppImage is meant not to do. A real fix
bundles the plugins into the AppDir and points `GST_PLUGIN_SYSTEM_PATH` at them
from the AppRun, and it needs deciding rather than improvising: it grows the
bundle, and it is the sort of change that belongs on `main` behind its own
review, not smuggled in on an experiment.

**In `pnpm tauri dev` none of this applies** — the app runs against the system
GStreamer, so the microphone works there with no variables at all. That is the
sane way to demo this branch.

## A bug found by using it, not by testing it

Reported from a real build: *"you press Speak and it vanishes and does
nothing"*. Exactly right, and it was two mistakes in one line of layout.

`VoiceButton` returned **only** a message when the recorder reported
`unavailable`, replacing the button. So a failed start made the control
disappear, leaving `text-slate-600` — near-invisible on a dark panel — under the
composer. Worse, it was one-way: with the button gone there was no way to try
again after plugging in a headset.

The failure was real (see the GStreamer section above), but the *reporting* of
it was the silent-failure mode this feature is supposed to avoid. The button now
stays, is labelled "Speak — unavailable", and explains itself in amber.

`VoiceButton.test.tsx` pins all three properties, and was checked against the
broken version first: all three tests fail on it and pass on the fix.

## Status: the microphone works from the `.deb`

Packaging pivoted from AppImage to `.deb` and the problem went away. The `.deb`
links against the system GStreamer: no bundled plugins, no rewritten
`GST_PLUGIN_SYSTEM_PATH_1_0`, no `AppRun`, no `linuxdeploy`. **Every failure in
the section below belongs to AppImage packaging alone.**

    pnpm tauri build --bundles deb

### The settings diff, measured rather than assumed

The open question was why `tauri dev` worked at all. Printing the live
`WebKitSettings` before touching them answers it, and **corrects the earlier
report**:

    [webkit] before: media_stream=true  webrtc=false media_capabilities=true
    [webkit] after:  media_stream=true  webrtc=true  media_capabilities=true

`enable-media-stream` was **already true in dev**, which is why dev always
worked. The earlier claim that it "defaults to false" was wrong — what is true
is that nothing in wry or Tauri *guarantees* it, `enable-webrtc` is genuinely
off, and setting both explicitly is what makes the packaged webview behave like
the dev one. The probe stays in `enable_media_stream` so the next person
measures instead of guessing.

### Recognition accuracy

Reported after real use: it records but mishears. Measured, and the cause is not
model size — `base` and `small` both get full sentences right and both fail the
*short* commands this feature invites:

| said | heard (before) | heard (after) |
| --- | --- | --- |
| "Show me the aorta" | "Show me the order" | "show me the aorta" |
| "The tibia" | "The tip here" | "the tibia" |
| "The trachea" | "The trickier" | "the trachea" |

Neither `beam_size=5` nor an `initial_prompt` helped. **`hotwords` did**, fully.
`_anatomy_hotwords` derives ~220 distinctive terms from the shipped manifest, so
the vocabulary tracks the atlas rather than drifting from a hand-written list.

One wrinkle worth knowing: the manifest is compiled into the *web* bundle and
the sidecar never receives it as a file, so `build_sidecar.py` stages it with
`--add-data` and `voice.py` resolves it through **`sys._MEIPASS`** — under
PyInstaller `Path(__file__).parent` is inside an archive and silently misses.
Without that the hotword list empties in exactly the build that needs it, and
nothing appears to be wrong.

All measurements above use piper's synthetic speech, which is a harsher test
than a human voice for words like "aorta".

## A bug only an *installed* build could show

Reported on first real use of the `.deb`: pressing *Read aloud* gave

    [Errno 13] Permission denied:
    '/usr/lib/Anatria3D/anatria-engine/_internal/voices'

`_VOICE_DIR` was `<package>/voices` — beside the frozen engine. From a source
checkout that is writable and everything passes; installed from a `.deb` it is
under `/usr`, owned by root, and the first voice download fails. An application
writing into its own installation directory would be wrong even with the
permission: voices are per-user data.

`_voice_dirs()` now returns the writable `XDG_DATA_HOME/anatria3d/voices` first
and keeps the bundled directory as a **read** fallback, so a build that ships
voices uses them instead of fetching a second copy. Pinned by two tests.

Worth noting what this says about testing: every gate was green, the sidecar
round-tripped audio, and the bug was still there — because everything ran from
a checkout the user owns. Nothing short of installing the package would have
found it.

## Why the microphone did not work in a packaged build

**The answer, after four wrong theories: WebKitGTK's media-stream support is
off by default and nothing in the stack turns it on.**

`enable-media-stream` and `enable-webrtc` are `WebKitSettings` properties, both
defaulting to `false`. While they are off WebKit does not expose
`navigator.mediaDevices` **at all** — no error, no permission prompt, nothing in
the log, because from the page's point of view the API does not exist. The
button appears to do nothing, which is exactly what was reported.

wry builds the webview with default settings and Tauri exposes no config for
these, so they must be set on the live webview:

    settings.set_enable_media_stream(true);
    settings.set_enable_webrtc(true);

`enable_media_stream` in `src-tauri/src/lib.rs`, called from `setup()` before
the permission handler — a permission for an API that does not exist means
nothing.

### The theories that were wrong, and why they looked right

Recording them because each was plausible and each cost time.

**1. Wrong plugin directory.** Real, and fixed: `AppRun.wrapped` points
`GST_PLUGIN_SYSTEM_PATH_1_0` at `$APPDIR/usr/lib/gstreamer-1.0`, which
linuxdeploy never creates. Not the cause.

**2. The hook was never sourced.** Also real: linuxdeploy's `AppRun` sources
hooks *by name*, so a script dropped into `apprun-hooks/` does nothing. Fixed,
still not the cause.

**3. GStreamer core version mismatch.** The AppDir bundles 1.23.90 while the
system has 1.28.6, and GStreamer does refuse plugins built against a newer
core. Compelling — and disproved by removing the bundled core entirely, which
changed nothing.

**4. `tauri://localhost` is not a secure context.** The most convincing of the
four, because `getUserMedia` genuinely is a secure-context API and dev
(`http://localhost:1420`) genuinely does differ from a packaged build. **It is
false**: wry already calls `register_uri_scheme_as_secure` on the custom
protocol — `wry-0.55.1/src/webkitgtk/web_context.rs`, comment "Enable secure
context". The origin was always secure. Two different switches, one identical
silent symptom.

A 32-bit `gst-plugin-scanner` was also found and fixed along the way (`find
/usr/lib | head -1` returns the i386 build on a multiarch machine, which then
fails every 64-bit plugin with `wrong ELF class: ELFCLASS64`). Real bug, real
fix, and still not why the microphone was dead.

### ⚠️ What must not be repeated: bundling GStreamer plugins

`scripts/bundle-gstreamer.sh` is **disabled and refuses to run**. Running it
produced an AppImage that **broke the desktop** — screen flickering, a second
monitor going blue, the app unresponsive.

The reason is that `GST_PLUGIN_SYSTEM_PATH_1_0` **replaces** GStreamer's search
path rather than extending it. Putting 15 audio plugins in that directory does
not add audio support; it removes every other plugin WebKit had, including the
video and GL elements it renders with. The app dies with

    GStreamer element uritranscodebin not found

and takes the compositor with it. Bundling audio plugins is only safe alongside
the *whole* plugin set WebKit expects, and needs testing on a machine whose
display you can afford to lose.

The script is kept, refusing to execute, as the record of that.

## Two more bugs, both only findable by running it

**1. The frozen sidecar could not speak at all.** PyInstaller froze `piper`'s
code but not its *data*: espeak-ng's phoneme tables. The binary looked for them
at the absolute path they had on the machine that built the wheel —

    Error processing file '/project/_skbuild/.../espeak-ng-data/phontab'

— after it had already emitted `ready`, so from the outside a `speak` request
simply returned nothing. `build_sidecar.py` now `--collect-all`s the voice
packages when they are installed, which brings the data with them.

That inclusion is **conditional on installation, not declared in
`pyproject.toml`**: a machine without the wheels builds exactly the engine it
always did. Freezing 260 MB of engines into every release is a decision, and it
stays yours.

**2. Whisper mishears anatomy.** Round-tripping synthesised speech through the
`base` model:

    said:  "The aorta carries blood from the heart."
    heard: "The order carries blood from the heart."

Which is precisely why the transcript lands in the composer for the reader to
correct rather than being dispatched to the assistant. A larger model (`small`,
`medium`) would do better and costs more download and more CPU — another size
decision, not taken here.

## Speech out: how the answer gets read aloud

`SpeakAnswerButton` sits in the per-answer action row, next to *Copy answer*
and *Save as note*, and appears only once a turn is `complete`.

**Opt-in per answer, never automatic**, and that is a design decision rather
than an unfinished one. A voice starting unprompted is intrusive in a library,
in a lecture, or next to somebody else working — and it keeps the written
answer, the copy that carries the on-screen notice, as the thing that always
happens.

**The Markdown has to be cleaned first.** `speakableText` strips what the
assistant actually emits — headings, bullets, emphasis, links, code fences,
table pipes and the `[[organ_id]]` markers the viewport consumes. Handing the
raw answer to piper produces a voice saying *"hash hash Left ventricle asterisk
asterisk"*, which is worse than no speech. It is not a Markdown parser and does
not need to be.

It also caps what is spoken (`MAX_SPOKEN_CHARS = 700`), cutting at a sentence
boundary so it sounds finished rather than broken. Piper is roughly realtime,
so a long answer is minutes of audio nobody waits for, arriving as one base64
blob on one NDJSON line.

Playback is a Blob through `URL.createObjectURL`, revoked on every path —
these are megabytes each, and `media-src 'self' blob:` was already in the CSP.
**Nothing about the policy changed for any of this**, which is the sign the
design was right.

Verified in the frozen sidecar, all three languages:

| Language | Result |
| --- | --- |
| `en` | 84 KB WAV |
| `es` | 134 KB WAV |
| `bg` | 107 KB WAV |

Each language downloads its voice on first use (~60 MB), so the first *Read
aloud* in a new language pauses while it fetches.

## Where this actually stands

Working, verified by running it:

- the protocol, both owners, and the contract test that compares them
- the sidecar over real NDJSON: speak -> WAV, transcribe -> text, bad base64 ->
  a clean error that quotes none of the payload
- graceful degradation with the engines absent (`voice_unavailable`)
- the frozen sidecar doing the same round trip
- the microphone **in `pnpm tauri dev`**
- the UI: recording, the cap, and the failure states
- **speech out**: a finished answer read aloud on request, en/es/bg

Not working:

- **the microphone inside a packaged AppImage.** WebKit reports
  `0 devices` there and nothing tried so far has changed it. See the GStreamer
  section: bundling the plugins where `AppRun.wrapped` points was necessary and
  not sufficient. Since it works in dev, the app code is not the problem — the
  bundle is. **Demo this branch with `pnpm tauri dev`.**

## What a packaged build actually costs

Measured while building the installable AppImage with voice included:

| | Size |
| --- | --- |
| sidecar, no voice | 97 MB |
| sidecar, voice engines | 434 MB |
| sidecar, voice + the three voice models | **661 MB** |
| staged AppDir | **1.2 GB** |

The voice models land *inside* the frozen sidecar rather than beside it: the
frozen binary resolves `_VOICE_DIR` relative to its own `_internal/`, so
`piper` downloads each voice there on first use and it is then part of the
build. Convenient for a demo — no first-use download for the reader — and the
reason the sidecar grew from 434 MB to 661 MB.

`linuxdeploy` also needs the voice wheels' private libraries on its search path
or it fails on `libgomp-e985bcbb.so.1.0.0`:

    LD_LIBRARY_PATH="$PWD/engine/dist/anatria-engine/_internal:\
    $PWD/engine/dist/anatria-engine/_internal/ctranslate2.libs" \
    NO_STRIP=true pnpm tauri build --bundles appimage

Bundling at this size takes many minutes rather than the ~40 seconds a
voice-free build takes.

**None of this is a recommendation.** An installer of this size for a study
tool is a real decision, and the alternative — fetching the engines and models
on first use, outside the installer — is the one worth costing before voice is
ever promoted.

## The open question, recorded rather than designed around

Anatria3D's regulatory position is carried **visually** — the notice is on every
screen and at the foot of every export. **A spoken answer is a channel where
that notice does not appear.** Somebody listening while looking away receives
the medical content and not the boundary.

Nurcan's decision for this experiment is to leave it visual-only, which is
reasonable for a local demo to colleagues who know what they are looking at.

**It is not resolved for a release.** If voice is ever promoted to a real
feature, this must be decided deliberately and not inherited by default from an
experiment. Recording it here so that promotion has to confront it.
