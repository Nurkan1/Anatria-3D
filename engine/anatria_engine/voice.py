"""Local speech-to-text and text-to-speech.

Both engines run **in this process and offline**: `faster-whisper` transcribes,
`piper` synthesises. Nothing here opens a socket, which is the strongest form
of the rule that all network I/O lives in the sidecar — for voice there is no
network I/O at all, and the microphone audio never leaves the machine.

Two consequences shape the whole module:

**The imports are optional and deferred.** The wheels are large (see
`docs/experiments/voice.md`) and this is an experiment, so a build without them
must still start and serve the typed interface. Every entry point therefore
imports inside the function and turns an `ImportError` into `VoiceUnavailableError`,
which the handler reports as `voice_unavailable` — "voice is off", not
"something broke".

**Inference blocks.** Whisper and piper are synchronous, CPU-bound C++ under a
Python wrapper. Called directly they would stall the event loop and with it
every concurrent agent turn, cancel and shutdown frame. They run in a worker
thread instead.

Models are cached after first use: loading whisper takes seconds, and paying
that per utterance would make the feature feel broken.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import sys
import wave
from pathlib import Path
from typing import Any, Final

from anatria_engine.protocol import Language

#: Whisper size. `base` is the honest floor for medical vocabulary — `tiny`
#: mishears structure names often enough to be a bad demo — while still
#: transcribing a short utterance in about a second on a laptop CPU.
_WHISPER_MODEL: Final = "base"

#: int8 quantisation. Roughly halves memory and speeds inference up on a CPU
#: with no meaningful accuracy cost at this size; there is no GPU assumption
#: anywhere in this app.
_WHISPER_COMPUTE: Final = "int8"

#: Piper voices are per-language, so this map *is* the language support.
#:
#: Names verified against the published catalogue rather than guessed — there
#: is exactly one Bulgarian voice in it, and it is not the one an obvious guess
#: produces. A wrong name fails at download time with a 404, which is a
#: miserable way to discover a typo.
#:
#: Bulgarian is the primary target locale, and also the likeliest to be
#: missing. It gets an explicit error rather than a silent fallback to English:
#: an answer spoken in the wrong language is worse than no speech at all.
_PIPER_VOICES: Final[dict[str, str]] = {
    "en": "en_US-lessac-medium",
    "es": "es_ES-davefx-medium",
    "bg": "bg_BG-dimitar-medium",
}

#: Where downloaded voices live. Under the engine's own directory rather than
#: the user's data dir: they belong to this experimental build, and removing
#: the branch should not leave hundreds of megabytes orphaned somewhere the
#: user will never find.
_VOICE_DIR: Final = Path(__file__).resolve().parent.parent / "voices"

#: Cached across calls; loading is the expensive part.
_whisper_model: Any = None
_piper_voices: dict[str, Any] = {}


class VoiceUnavailableError(RuntimeError):
    """Voice cannot run: engine not installed, or model not downloaded.

    Distinct from a failure *during* recognition. This one means the feature is
    off and the typed interface is unaffected, which is what the UI must say.
    """


def _load_whisper() -> Any:
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on the build
        raise VoiceUnavailableError("Speech recognition is not installed in this build.") from exc
    try:
        _whisper_model = WhisperModel(_WHISPER_MODEL, compute_type=_WHISPER_COMPUTE)
    except Exception as exc:
        # First run downloads the weights. No network, or no disk, lands here.
        raise VoiceUnavailableError(
            f"The speech model ({_WHISPER_MODEL}) could not be loaded. "
            "The first use downloads it, which needs a connection once."
        ) from exc
    return _whisper_model


def _load_piper(language: str) -> Any:
    voice_name = _PIPER_VOICES.get(language)
    if voice_name is None:
        raise VoiceUnavailableError(f"No installed voice for language {language!r}.")
    cached = _piper_voices.get(voice_name)
    if cached is not None:
        return cached
    try:
        from piper import PiperVoice
        from piper.download_voices import download_voice
    except ImportError as exc:  # pragma: no cover - depends on the build
        raise VoiceUnavailableError("Speech synthesis is not installed in this build.") from exc

    # `PiperVoice.load` takes a path to the model file, not a voice name, so
    # the download has to happen first and be checked for.
    model_path = _VOICE_DIR / f"{voice_name}.onnx"
    if not model_path.exists():
        _VOICE_DIR.mkdir(parents=True, exist_ok=True)
        try:
            download_voice(voice_name, _VOICE_DIR)
        except Exception as exc:
            # The one moment voice touches the network, and it is a one-off
            # asset fetch, not the audio: the recording itself never leaves.
            raise VoiceUnavailableError(
                f"The voice {voice_name!r} could not be downloaded. "
                "The first use of each language fetches it once."
            ) from exc

    try:
        voice = PiperVoice.load(model_path)
    except Exception as exc:
        raise VoiceUnavailableError(f"The voice {voice_name!r} could not be loaded.") from exc
    _piper_voices[voice_name] = voice
    return voice


def _decode_audio(audio_b64: str) -> bytes:
    """base64 -> bytes, with a real error rather than a stack trace.

    `validate=True` so a payload with stray characters fails here, where it can
    be reported against the request, instead of silently decoding to noise that
    whisper would dutifully transcribe as nothing.
    """
    try:
        return base64.b64decode(audio_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        # The message deliberately says nothing about the content and does not
        # include the payload: this string reaches a log.
        raise ValueError("The recorded audio was not valid base64.") from exc


#: Ordinary English words that appear in structure names and carry no
#: recognition value — biasing towards "left" or "muscle" helps nothing and
#: dilutes the list.
_UNDISTINCTIVE = frozenset(
    [
        "left", "right", "bone", "muscle", "part", "artery", "vein", "nerve",
        "joint", "lateral", "medial", "anterior", "posterior", "superior",
        "inferior", "branch", "process", "head", "body", "neck", "tendon",
        "ligament", "margin", "surface", "border", "line", "area", "region",
        "nodes", "deep", "middle", "common", "external", "internal",
    ]
)

#: How many terms to pass. Whisper's hotword bias is a prompt, not a lexicon,
#: and a very long one starts to cost accuracy on ordinary words.
_MAX_HOTWORDS = 220

_hotwords: str | None = None

#: Where the atlas manifest is, in each of the two shapes this runs in.
#:
#: A source checkout has it at `<repo>/public/anatomy/manifest.json`. A frozen
#: build does **not**: the manifest is compiled into the web bundle and the
#: sidecar never receives it as a file, so `build_sidecar.py` copies it in
#: beside the package. Without that copy the vocabulary silently empties in
#: exactly the build where it matters most, and short commands go back to
#: being misheard — a failure that looks like nothing at all.
def _manifest_candidates() -> list[Path]:
    here = Path(__file__).resolve()
    candidates = [
        # Source checkout.
        here.parents[2] / "public" / "anatomy" / "manifest.json",
        # Frozen, if `__file__` happens to resolve on disk.
        here.parent / "manifest.json",
    ]
    # Frozen: PyInstaller serves modules from an archive, so `__file__` does
    # **not** point at a real directory and the path above silently misses.
    # `sys._MEIPASS` is the unpacked bundle root, which is where
    # `--add-data=…:anatria_engine` actually put it.
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass is not None:
        candidates.insert(0, Path(meipass) / "anatria_engine" / "manifest.json")
    return candidates


def _anatomy_hotwords() -> str:
    """Distinctive anatomical words, taken from the atlas the app ships.

    **This is what makes short commands work.** Whisper hears "Show me the
    aorta" with almost no context to disambiguate three words and returns "Show
    me the order"; "The tibia" becomes "The tip here", "The trachea" becomes
    "The trickier". Every one of those is correct once the vocabulary is
    supplied. Longer sentences were already fine — the failure is specific to
    the short commands this feature invites.

    Derived from the manifest rather than hand-written, so it tracks the atlas
    instead of drifting from it. Read once and cached; no manifest anywhere
    degrades to no biasing, never to an error.
    """
    global _hotwords
    if _hotwords is not None:
        return _hotwords

    import collections
    import json
    import re

    counts: collections.Counter[str] = collections.Counter()
    for manifest in _manifest_candidates():
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for organ in data.get("organs", []):
            for word in re.findall(r"[A-Za-z]{4,}", organ.get("name_en", "")):
                counts[word.lower()] += 1
        break

    if not counts:
        # No manifest anywhere. Degrade to no biasing rather than failing: the
        # recogniser still works, just less well on short commands.
        _hotwords = ""
        return _hotwords

    words = [w for w, _ in counts.most_common(_MAX_HOTWORDS * 2) if w not in _UNDISTINCTIVE]
    _hotwords = " ".join(words[:_MAX_HOTWORDS])
    return _hotwords


def _transcribe_blocking(audio: bytes, language: Language) -> str:
    model = _load_whisper()
    # faster-whisper accepts a file-like object, so the clip never touches
    # disk — writing a temporary file would leave a recording of somebody's
    # voice behind on a crash.
    segments, _info = model.transcribe(
        io.BytesIO(audio),
        # `auto` means "no choice made": let whisper detect rather than forcing
        # a wrong language, which mangles short utterances badly.
        language=None if language == "auto" else language,
        # A short clip has no context to condition on, and carrying it over
        # makes whisper repeat the previous utterance when it hears silence.
        condition_on_previous_text=False,
        vad_filter=True,
        # Bias towards the vocabulary this app is about. Without it a
        # three-word command naming one structure is unreliable — see
        # `_anatomy_hotwords`.
        hotwords=_anatomy_hotwords() or None,
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


def _synthesise_blocking(text: str, language: Language) -> bytes:
    # `auto` has no voice of its own: it means the reader never chose, so speak
    # the app's default rather than refusing.
    voice = _load_piper("en" if language == "auto" else language)
    buffer = io.BytesIO()
    # Piper emits raw PCM; wrapping it in a WAV container gives the webview
    # something it can play as a Blob without a decoder of our own.
    with wave.open(buffer, "wb") as wav:
        voice.synthesize_wav(text, wav)
    return buffer.getvalue()


async def transcribe(audio_b64: str, mime_type: str, language: Language) -> str:
    """Speech in. Returns what was heard, possibly empty.

    `mime_type` is accepted for the caller's clarity and deliberately not used
    to gate anything: WebKitGTK and WebView2 disagree on what MediaRecorder
    produces, and the decoder underneath (libav) sniffs the container anyway.
    Rejecting on a mime string would break one platform to satisfy a check that
    buys nothing.
    """
    audio = _decode_audio(audio_b64)
    if not audio:
        return ""
    return await asyncio.to_thread(_transcribe_blocking, audio, language)


async def synthesise(text: str, language: Language) -> tuple[str, str]:
    """Speech out. Returns `(base64 audio, mime type)`."""
    audio = await asyncio.to_thread(_synthesise_blocking, text, language)
    return base64.b64encode(audio).decode("ascii"), "audio/wav"
