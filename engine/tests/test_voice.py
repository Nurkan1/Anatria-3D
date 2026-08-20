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

import pytest

from anatria_engine import handlers, voice
from anatria_engine.protocol import SpeakRequest, TranscribeRequest
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
