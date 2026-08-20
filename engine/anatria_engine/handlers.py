"""Request handlers: bridge the agent to the NDJSON transport."""

from __future__ import annotations

import asyncio

from pydantic import BaseModel

from anatria_engine.agent import (
    Completed,
    TextChunk,
    ToolStarted,
    build_scene_context,
    run_agent,
)
from anatria_engine.model_discovery import list_models
from anatria_engine.protocol import (
    AgentRequest,
    CaseVerdictEvent,
    DoneEvent,
    ErrorEvent,
    ListModelsRequest,
    ModelsEvent,
    SceneCommandEvent,
    SpeakRequest,
    SpeechEvent,
    TextDeltaEvent,
    ToolStartedEvent,
    TranscribeRequest,
    TranscriptEvent,
)
from anatria_engine.providers import DEFAULT_MODELS, ProviderError
from anatria_engine.transport import Transport

#: A saturated model usually clears in seconds. Retried only while nothing has
#: been shown yet — see `handle_agent_request`.
_OVERLOAD_RETRIES = 2
_OVERLOAD_BACKOFF_SECONDS = (1.5, 4.0)


async def handle_agent_request(request: AgentRequest, transport: Transport) -> None:
    if not request.available_organs:
        transport.emit(
            ErrorEvent(
                request_id=request.request_id,
                code="invalid_request",
                message="No structures are loaded in the viewport.",
            )
        )
        return

    for attempt in range(_OVERLOAD_RETRIES + 1):
        # Whether this attempt has put anything on screen yet. A retry is only
        # safe before the first output: re-running afterwards would replay the
        # answer from the top, and the reader would watch it stutter.
        produced_output = False

        def emit_command(command: BaseModel) -> None:
            # Called synchronously from inside a tool, so the viewport moves the
            # instant the model decides to move it — before the sentence about
            # that structure has finished streaming.
            nonlocal produced_output
            produced_output = True
            transport.emit(
                SceneCommandEvent(request_id=request.request_id, command=command)  # type: ignore[arg-type]
            )

        def emit_verdict(score: int, verdict: str) -> None:
            # A grade is output too: once one is on its way to the journal, a
            # retry would replay the drill and double-count the attempt.
            nonlocal produced_output
            produced_output = True
            transport.emit(
                CaseVerdictEvent(
                    request_id=request.request_id, score=score, verdict=verdict
                )
            )

        scene = build_scene_context(request, emit_command, emit_verdict)

        try:
            async for event in run_agent(request, scene):
                if isinstance(event, TextChunk):
                    produced_output = True
                    transport.emit(
                        TextDeltaEvent(request_id=request.request_id, text=event.text)
                    )
                elif isinstance(event, ToolStarted):
                    produced_output = True
                    transport.emit(
                        ToolStartedEvent(request_id=request.request_id, tool=event.tool)
                    )
                elif isinstance(event, Completed):
                    transport.emit(
                        DoneEvent(
                            request_id=request.request_id,
                            usage=event.usage,
                            model=event.model,
                        )
                    )
            return

        except asyncio.CancelledError:
            raise
        except ProviderError as exc:
            transport.emit(
                ErrorEvent(
                    request_id=request.request_id,
                    code="provider_error",
                    message=str(exc),
                )
            )
            return
        except Exception as exc:  # provider faults must not kill the engine
            code = _classify(exc)
            retryable = (
                code == "service_unavailable"
                and not produced_output
                and attempt < _OVERLOAD_RETRIES
            )
            if retryable:
                transport.log(
                    f"{request.request_id}: model overloaded, retry "
                    f"{attempt + 1}/{_OVERLOAD_RETRIES}"
                )
                await asyncio.sleep(_OVERLOAD_BACKOFF_SECONDS[attempt])
                continue

            transport.emit(
                ErrorEvent(
                    request_id=request.request_id,
                    code=code,
                    message=_overload_hint(exc, code, request),
                )
            )
            return


def _overload_hint(exc: Exception, code: str, request: AgentRequest) -> str:
    """Turn a saturated-model failure into something the user can act on."""
    if code != "service_unavailable":
        return _readable(exc)
    model = request.model or DEFAULT_MODELS[request.provider]
    return (
        f"{model} is busy right now (the provider returned 503 after "
        f"{_OVERLOAD_RETRIES + 1} attempts). Pick a different model in Settings, "
        "or try again in a moment — your key is fine."
    )


async def handle_list_models(request: ListModelsRequest, transport: Transport) -> None:
    """Fill the model picker, and prove the key works while doing it."""
    try:
        models = await list_models(request.provider, request.api_key)
    except asyncio.CancelledError:
        raise
    except ProviderError as exc:
        transport.emit(
            ErrorEvent(
                request_id=request.request_id, code="provider_error", message=str(exc)
            )
        )
        return
    except Exception as exc:  # a bad key is the expected failure here
        transport.emit(
            ErrorEvent(
                request_id=request.request_id,
                code=_classify(exc),
                message=_readable(exc),
            )
        )
        return

    transport.emit(
        ModelsEvent(
            request_id=request.request_id, provider=request.provider, models=models
        )
    )
    # Listing a catalogue is not a turn: it ran on no model and cost nothing
    # attributable, so both fields are honestly empty rather than zeroed.
    transport.emit(DoneEvent(request_id=request.request_id, usage=None, model=None))


#: Phrases a provider uses when *this model* cannot do what we are asking of
#: it — tools, streaming, or a combination it refuses on this endpoint.
#:
#: Observed with GPT-5.6 Terra, which reasons by default and which OpenAI will
#: not serve function tools to over `/v1/chat/completions`:
#:
#:     Function tools with reasoning_effort are not supported for
#:     gpt-5.6-terra in /v1/chat/completions. To use function tools, use
#:     /v1/responses or set reasoning_effort to 'none'.
#:
#: The provider is being precise and helpful. We reported it as
#: `internal_error`, which sends the reader — and whoever supports them — to
#: look for a fault in this application that is not there.
_INCOMPATIBLE_MODEL = (
    "not supported for",
    "does not support",
    "is not supported",
    "unsupported",
    "not compatible",
    "does not exist",
)


def _model_is_incompatible(text: str) -> bool:
    """A 400 that means "not this model", rather than "not this request".

    Both halves are required. A bare 400 can equally be a malformed request of
    ours, and calling that a model problem would send someone switching models
    to fix a bug in here.
    """
    rejected = "invalid_request" in text or "400" in text
    return rejected and any(phrase in text for phrase in _INCOMPATIBLE_MODEL)


def _classify(exc: Exception) -> str:
    """Map a provider exception onto a code the UI can act on.

    The distinctions here are the ones that change what the user should do
    next: fix the key, wait, pick a different model, or report a bug. Lumping
    them together as "internal error" makes a saturated model look like our
    fault and leaves the user with no move.
    """
    text = f"{type(exc).__name__} {exc}".lower()
    if "api key" in text or "unauthorized" in text or "authentication" in text:
        return "invalid_api_key"
    if "401" in text or "403" in text or "permission" in text:
        return "invalid_api_key"
    if "rate limit" in text or "429" in text or "quota" in text:
        return "rate_limited"
    # Checked before the generic buckets: this text often also carries "400",
    # and it is the one 400 with a move the reader can make.
    if _model_is_incompatible(text):
        return "invalid_request"
    # A saturated model answers 503/UNAVAILABLE/overloaded. The provider is up;
    # this model is not. Retrying or switching model both work, so it must not
    # read as an internal fault.
    if any(
        token in text
        for token in ("503", "unavailable", "overloaded", "high demand", "try again")
    ):
        return "service_unavailable"
    if "connection" in text or "timeout" in text or "network" in text:
        return "provider_error"
    return "internal_error"


def _readable(exc: Exception) -> str:
    """Trim provider tracebacks to something a UI can show.

    An incompatible model gets a sentence in front of the provider's own text.
    The provider's wording is accurate and is kept — it names the model and the
    endpoint, which is what a bug report needs — but it opens by talking about
    `/v1/chat/completions`, and the reader is a medical student who wants to
    know what to press. Tell them that first.
    """
    message = str(exc).strip() or type(exc).__name__
    if _model_is_incompatible(f"{type(exc).__name__} {message}".lower()):
        message = (
            "This model cannot be driven by Anatria3D's scene tools. "
            "Choose another model under Settings — the one marked as the "
            "default is known to work. Provider said: " + message
        )
    return message if len(message) <= 400 else message[:397] + "…"


# ---------------------------------------------------------------------------
# Voice (local experiment — see docs/experiments/voice.md)
# ---------------------------------------------------------------------------


async def handle_transcribe(request: TranscribeRequest, transport: Transport) -> None:
    """Speech in: transcribe a clip and hand the text back.

    Both failure modes end the turn with an error rather than silence, because
    a voice button that does nothing is indistinguishable from a broken one and
    the reader has no way to tell which.
    """
    from anatria_engine import voice

    try:
        text = await voice.transcribe(
            request.audio_b64, request.mime_type, request.language
        )
    except voice.VoiceUnavailableError as exc:
        transport.emit(
            ErrorEvent(
                request_id=request.request_id,
                code="voice_unavailable",
                message=str(exc),
            )
        )
        return
    except ValueError as exc:
        # Bad base64. `str(exc)` is our own message from `_decode_audio` and
        # carries none of the payload — this string reaches a log.
        transport.emit(
            ErrorEvent(
                request_id=request.request_id,
                code="invalid_request",
                message=str(exc),
            )
        )
        return

    transport.emit(TranscriptEvent(request_id=request.request_id, text=text))
    transport.emit(DoneEvent(request_id=request.request_id, usage=None))


async def handle_speak(request: SpeakRequest, transport: Transport) -> None:
    """Speech out: synthesise an answer that has already been shown."""
    from anatria_engine import voice

    try:
        audio_b64, mime_type = await voice.synthesise(request.text, request.language)
    except voice.VoiceUnavailableError as exc:
        transport.emit(
            ErrorEvent(
                request_id=request.request_id,
                code="voice_unavailable",
                message=str(exc),
            )
        )
        return

    transport.emit(
        SpeechEvent(
            request_id=request.request_id,
            audio_b64=audio_b64,
            mime_type=mime_type,
        )
    )
    transport.emit(DoneEvent(request_id=request.request_id, usage=None))
