"""The local voice path: decoding, failure modes, and what reaches a log.

Deliberately no model is loaded here. Whisper and piper are hundreds of
megabytes and seconds to warm up, and none of what can actually go wrong in
this module needs them: the decode step, the "voice is off" degradation, and
the promise that audio never lands in a log are all testable with the engines
absent — which is also how a build without the wheels behaves.

Part of the local voice experiment (branch `experiment/voice`).
"""

from __future__ import annotations

import asyncio
import base64
from pathlib import Path

import pytest

from anatria_engine import handlers, voice
from anatria_engine.protocol import (
    VOICE_MAX_SPEED,
    VOICE_MIN_SPEED,
    SpeakRequest,
    TranscribeRequest,
)
from anatria_engine.transport import Transport


class Recorder(Transport):
    """Captures emitted frames instead of writing them to stdout."""

    def __init__(self) -> None:
        self.events: list = []
        self.logs: list[str] = []

    def emit(self, event) -> None:  # type: ignore[override]
        self.events.append(event)

    def log(self, message: str) -> None:  # type: ignore[override]
        self.logs.append(message)

    def kinds(self) -> list[str]:
        return [getattr(event, "type", "?") for event in self.events]


def test_a_clip_that_is_not_base64_is_refused_by_name() -> None:
    with pytest.raises(ValueError, match="valid base64"):
        voice._decode_audio("this is not base64 !!!")


def test_the_rejection_never_quotes_the_audio() -> None:
    """The error message reaches a log, so it must not carry the payload.

    A recording of somebody's voice in a log file is both useless and a thing
    nobody consented to keep.
    """
    payload = base64.b64encode(b"pretend this is a recording").decode() + "!!!"
    with pytest.raises(ValueError) as caught:
        voice._decode_audio(payload)
    message = str(caught.value)
    assert payload not in message
    # Not even a fragment: a prefix of a base64 clip is still a clip.
    assert payload[:16] not in message


def test_an_empty_clip_transcribes_to_nothing_without_loading_a_model() -> None:
    """Silence is not an error, and must not pay for a model load."""
    assert asyncio.run(voice.transcribe("", "audio/webm", "en")) == ""


def test_a_language_with_no_voice_says_so_rather_than_guessing() -> None:
    """No silent fallback: an answer spoken in the wrong language is worse."""
    with pytest.raises(voice.VoiceUnavailableError, match="No installed voice"):
        voice._load_piper("fr")


def test_voice_being_absent_is_reported_as_voice_unavailable(monkeypatch) -> None:
    """A build without the wheels degrades; it does not look broken.

    `voice_unavailable` rather than `internal_error` because the answer for the
    reader is "voice is off, the typed interface still works".
    """

    async def refuse(*_args, **_kwargs):
        raise voice.VoiceUnavailableError("Speech recognition is not installed.")

    monkeypatch.setattr(voice, "transcribe", refuse)
    recorder = Recorder()
    request = TranscribeRequest(
        request_id="r1",
        audio_b64=base64.b64encode(b"x").decode(),
        mime_type="audio/webm",
        language="en",
    )

    asyncio.run(handlers.handle_transcribe(request, recorder))

    assert recorder.kinds() == ["error"]
    assert recorder.events[0].code == "voice_unavailable"


def test_a_failed_transcription_still_ends_the_turn(monkeypatch) -> None:
    """Bad audio ends with an error, never with silence.

    A voice button that does nothing is indistinguishable from a broken one.
    """

    async def reject(*_args, **_kwargs):
        raise ValueError("The recorded audio was not valid base64.")

    monkeypatch.setattr(voice, "transcribe", reject)
    recorder = Recorder()
    request = TranscribeRequest(
        request_id="r2",
        audio_b64=base64.b64encode(b"x").decode(),
        mime_type="audio/webm",
        language="en",
    )

    asyncio.run(handlers.handle_transcribe(request, recorder))

    assert recorder.kinds() == ["error"]
    assert recorder.events[0].code == "invalid_request"


def test_a_transcript_is_followed_by_a_done(monkeypatch) -> None:
    """The composer only clears on `done`, so it must always arrive."""

    async def heard(*_args, **_kwargs):
        return "where is the left ventricle"

    monkeypatch.setattr(voice, "transcribe", heard)
    recorder = Recorder()
    request = TranscribeRequest(
        request_id="r3",
        audio_b64=base64.b64encode(b"x").decode(),
        mime_type="audio/webm",
        language="en",
    )

    asyncio.run(handlers.handle_transcribe(request, recorder))

    assert recorder.kinds() == ["transcript", "done"]
    assert recorder.events[0].text == "where is the left ventricle"


def test_synthesised_speech_comes_back_with_its_type(monkeypatch) -> None:
    async def spoken(*_args, **_kwargs):
        return base64.b64encode(b"RIFF....WAVE").decode(), "audio/wav"

    monkeypatch.setattr(voice, "synthesise", spoken)
    recorder = Recorder()

    asyncio.run(
        handlers.handle_speak(
            SpeakRequest(request_id="r4", text="The aorta.", language="en"), recorder
        )
    )

    assert recorder.kinds() == ["speech", "done"]
    assert recorder.events[0].mime_type == "audio/wav"


def test_the_audio_field_stays_out_of_a_repr() -> None:
    """`repr=False`, the same guard `api_key` carries.

    A model dropped into a log line — a debug print, an exception rendering its
    arguments — is the likeliest way a recording escapes.
    """
    clip = base64.b64encode(b"a recognisable recording" * 50).decode()
    request = TranscribeRequest(
        request_id="r5", audio_b64=clip, mime_type="audio/webm", language="en"
    )
    assert clip not in repr(request)
    assert "r5" in repr(request)


def test_the_hotword_list_is_built_from_the_atlas() -> None:
    """Recognition of short commands depends on this list existing.

    "Show me the aorta" is three words of context, and without biasing whisper
    returns "Show me the order"; "The tibia" becomes "The tip here". The terms
    come from the shipped manifest rather than a hand-written list so they
    track the atlas.
    """
    hotwords = voice._anatomy_hotwords()
    if not hotwords:
        pytest.skip("manifest not readable from this checkout")

    words = hotwords.split()
    assert len(words) <= voice._MAX_HOTWORDS
    # Ordinary words carry no recognition value and would dilute the bias.
    assert "left" not in words
    assert "muscle" not in words
    # Something recognisably anatomical survived the filter.
    assert any(w in words for w in ("femoral", "bursa", "phalanx", "lung"))


def test_the_hotword_list_is_computed_once() -> None:
    """Read per utterance it would reparse a 1.2 MB manifest every time."""
    voice._hotwords = None
    first = voice._anatomy_hotwords()
    assert voice._anatomy_hotwords() is first


def test_voices_are_downloaded_under_a_per_user_cache(monkeypatch) -> None:
    """Never into the installation directory.

    The first version put voices beside the package. From a source checkout
    that works; installed from a `.deb` it is `/usr/lib/...`, owned by root,
    and the first "Read aloud" fails with

        [Errno 13] Permission denied:
        '/usr/lib/Anatria3D/anatria-engine/_internal/voices'

    An application writing into its own install directory would be wrong even
    with permission — and on a machine the user did not build themselves, it is
    not permitted at all.
    """
    monkeypatch.setattr(voice.sys, "platform", "linux")
    monkeypatch.setenv("XDG_CACHE_HOME", "/tmp/xdg-test")
    first, *rest = voice._voice_dirs()

    # The writable one is first, because that is where a download goes.
    assert first == Path("/tmp/xdg-test/anatria3d/voices")
    # The bundled directory is still read, so a build that ships voices uses
    # them instead of fetching a second copy.
    assert rest, "the bundled directory should remain a read fallback"
    assert not str(first).startswith("/usr")


def test_the_cache_dir_falls_back_to_the_home_default(monkeypatch) -> None:
    """`XDG_CACHE_HOME` is frequently unset; the spec's default applies."""
    monkeypatch.setattr(voice.sys, "platform", "linux")
    monkeypatch.delenv("XDG_CACHE_HOME", raising=False)
    assert voice._voice_cache_dir() == Path.home() / ".cache" / "anatria3d" / "voices"


def test_windows_uses_local_appdata_rather_than_an_xdg_variable(monkeypatch) -> None:
    """`.deb` is this experiment's target, but the path must not be nonsense
    on the platform the project actually ships an installer for.

    `LOCALAPPDATA` rather than `APPDATA`: these are re-downloadable models, so
    they belong in the local (non-roaming) profile — nobody wants 600 MB of
    voices syncing to a domain server.
    """
    monkeypatch.setattr(voice.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\x\AppData\Local")
    assert voice._voice_cache_dir() == Path(r"C:\Users\x\AppData\Local") / "Anatria3D" / "voices"


def test_a_download_failure_names_the_directory(monkeypatch) -> None:
    """So a user reclaiming the space knows what to delete.

    The original design worried about orphaning hundreds of megabytes somewhere
    unfindable and answered that by writing into the install tree, where a user
    cannot write at all. A path in the message is worth more than a path nobody
    can write to.
    """
    monkeypatch.setattr(voice, "_piper_voices", {})
    # Both directories pointed at nothing, so the lookup misses and a download
    # is actually attempted. Without this the bundled `engine/voices/` copy is
    # found on a developer machine and the failure path never runs.
    monkeypatch.setattr(
        voice, "_voice_dirs", lambda: [Path("/tmp/xdg-named/anatria3d/voices")]
    )

    def explode(*_args, **_kwargs):
        raise OSError("no route to host")

    import piper.download_voices

    monkeypatch.setattr(piper.download_voices, "download_voice", explode)
    with pytest.raises(voice.VoiceUnavailableError) as caught:
        voice._load_piper("en")
    assert "/tmp/xdg-named/anatria3d/voices" in str(caught.value)


def test_a_speak_request_without_a_pace_speaks_normally() -> None:
    """The field is defaulted, not required.

    `extra="forbid"` makes every protocol addition a compatibility question: a
    frontend built before this field exists sends no `speed`, and must not be
    rejected for it. The value it would have meant is 1.0.
    """
    request = SpeakRequest(request_id="r6", text="The aorta.", language="en")
    assert request.speed == 1.0
    assert request.volume == 1.0


def test_an_impossible_pace_is_refused_at_the_boundary() -> None:
    """Clamped in the interface *and* here.

    The slider cannot produce these, but the slider is not the only thing that
    can send this frame, and `speed=0` becomes a division by zero one function
    later.
    """
    import pydantic

    for bad in (0, -1, 99):
        with pytest.raises(pydantic.ValidationError):
            SpeakRequest(request_id="r7", text="x", language="en", speed=bad)


def test_pace_is_inverted_into_piper_s_units() -> None:
    """**Larger `length_scale` is slower.** Getting this backwards is silent.

    Piper measures phoneme *duration*, so asking for 1.25x speech means holding
    each sound for 1/1.25 as long. Inverted the wrong way the slider would still
    work, still change the voice, and do the opposite of its label — a bug no
    stack trace would ever report.
    """
    config = voice._synthesis_config(1.25, 1.0)
    if config is None:
        pytest.skip("piper not installed in this environment")
    assert config.length_scale == pytest.approx(0.8)
    assert voice._synthesis_config(0.5, 1.0).length_scale == pytest.approx(2.0)


def test_the_default_pace_asks_piper_for_nothing() -> None:
    """No config object at all when nothing was changed.

    This is the path a build with an older piper takes — the import inside
    `_synthesis_config` can fail, and speaking at the natural pace is a far
    better outcome than refusing to speak. Keeping the untouched case free of
    that import means the default can never be broken by this function.
    """
    assert voice._synthesis_config(1.0, 1.0) is None


def test_the_bounds_are_the_ones_the_interface_offers() -> None:
    """Two owners, one range — the same rule the Zod/Pydantic contract enforces.

    `schemas.ts` draws the slider from its own copy of these numbers. If they
    drift, the slider's own extremes start being rejected by the engine, which
    reads to the user as speech failing at exactly the setting they wanted.
    """
    assert VOICE_MIN_SPEED == 0.5
    assert VOICE_MAX_SPEED == 2.0
