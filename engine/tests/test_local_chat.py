"""The local Ollama chat: words only, safety first, and never a truncated prompt."""

from __future__ import annotations

import json

import httpx
import pytest
from pydantic import ValidationError

from anatria_engine.local_chat import (
    NUM_CTX,
    LocalDone,
    LocalModelError,
    LocalText,
    TruncatedPromptError,
    estimate_tokens,
    fit_history,
    list_local_models,
    stream_local_chat,
)
from anatria_engine.prompts import LOCAL_SAFETY_REMINDER, SAFETY, build_local_instructions
from anatria_engine.protocol import (
    LocalChatRequest,
    LocalModelsEvent,
    TextDeltaEvent,
    TranscriptTurn,
)

PROFILES = ["layperson", "student", "clinician"]
LANGUAGES = ["auto", "bg", "es", "en"]


def turn(role: str, content: str) -> TranscriptTurn:
    return TranscriptTurn(role=role, content=content)  # type: ignore[arg-type]


# -- fitting the conversation ------------------------------------------------


def test_fits_everything_when_it_is_small() -> None:
    history = [turn("user", "hi"), turn("assistant", "hello")]
    assert fit_history("system", history, "next", budget=1000) == history


def test_drops_the_oldest_turns_first_and_keeps_the_newest() -> None:
    history = [turn("user", "a" * 400), turn("assistant", "b" * 400), turn("user", "c" * 40)]
    kept = fit_history("s", history, "q", budget=estimate_tokens("s" + "q" + "c" * 40 + "b" * 400))
    assert [t.content[0] for t in kept] == ["c"]


def test_never_opens_on_an_answer_whose_question_was_dropped() -> None:
    history = [turn("user", "x" * 1000), turn("assistant", "y" * 10), turn("user", "z" * 10)]
    kept = fit_history("s", history, "q", budget=estimate_tokens("s" + "q") + 20)
    assert kept and kept[0].role == "user"


def test_the_instructions_and_the_question_never_give_way() -> None:
    # Even with no room at all, nothing of the prompt itself is cut: the turns go.
    assert fit_history("s" * 10_000, [turn("user", "old")], "q", budget=10) == []


# -- the server ----------------------------------------------------------------


def ollama(handler):
    return httpx.MockTransport(handler)


def show(capabilities: list[str]):
    return httpx.Response(200, json={"capabilities": capabilities})


def test_reports_ollama_absent_rather_than_failing() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    running, models = __import__("asyncio").run(list_local_models(ollama(refuse)))
    assert running is False and models == []


def test_offers_chat_models_and_leaves_embedding_models_out() -> None:
    def server(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(
                200,
                json={
                    "models": [
                        {"name": "qwen3.5:9b", "size": 6_600_000_000,
                         "details": {"parameter_size": "9.0B"}},
                        {"name": "bge-m3:latest", "size": 1_200_000_000, "details": {}},
                        {"name": "gemma3:4b", "size": 3_300_000_000, "details": {}},
                    ]
                },
            )
        name = json.loads(request.content)["model"]
        return show(["embedding"] if name.startswith("bge") else ["completion"])

    running, models = __import__("asyncio").run(list_local_models(ollama(server)))
    assert running is True
    assert [m.name for m in models] == ["gemma3:4b", "qwen3.5:9b"]
    assert models[1].parameter_size == "9.0B"


def chat_server(*, capabilities: list[str], evaluated: int, seen: list[dict]):
    def server(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/show":
            return show(capabilities)
        body = json.loads(request.content)
        seen.append(body)
        lines = [
            {"message": {"content": "The heart "}, "done": False},
            {"message": {"content": "pumps."}, "done": False},
            {"message": {"content": ""}, "done": True,
             "prompt_eval_count": evaluated, "eval_count": 7},
        ]
        return httpx.Response(200, content="\n".join(json.dumps(x) for x in lines).encode())

    return ollama(server)


async def collect(**kwargs):
    return [event async for event in stream_local_chat(**kwargs)]


async def test_streams_the_answer_and_says_what_it_cost() -> None:
    seen: list[dict] = []
    events = await collect(
        model="gemma3:4b", system="rules", history=[], query="what does the heart do?",
        transport=chat_server(capabilities=["completion"], evaluated=50, seen=seen),
    )
    assert [e.text for e in events if isinstance(e, LocalText)] == ["The heart ", "pumps."]
    done = events[-1]
    assert isinstance(done, LocalDone)
    assert done.model == "ollama:gemma3:4b"
    assert done.usage is not None and done.usage.input_tokens == 50


async def test_always_asks_for_its_own_context_window() -> None:
    # Without it Ollama runs in the server's default window and drops the start
    # of a long prompt — which is where SAFETY is.
    seen: list[dict] = []
    await collect(
        model="gemma3:4b", system="rules", history=[], query="q",
        transport=chat_server(capabilities=["completion"], evaluated=10, seen=seen),
    )
    assert seen[0]["options"]["num_ctx"] == NUM_CTX
    assert seen[0]["messages"][0] == {"role": "system", "content": "rules"}


async def test_asks_a_thinking_model_not_to_stream_its_deliberation() -> None:
    seen: list[dict] = []
    await collect(
        model="qwen3.5:9b", system="rules", history=[], query="q",
        transport=chat_server(capabilities=["completion", "thinking"], evaluated=10, seen=seen),
    )
    assert seen[0]["think"] is False


async def test_does_not_send_think_to_a_model_that_cannot() -> None:
    seen: list[dict] = []
    await collect(
        model="gemma3:4b", system="rules", history=[], query="q",
        transport=chat_server(capabilities=["completion"], evaluated=10, seen=seen),
    )
    assert "think" not in seen[0]


async def test_refuses_an_answer_built_on_a_truncated_prompt() -> None:
    seen: list[dict] = []
    with pytest.raises(TruncatedPromptError, match="safety"):
        await collect(
            model="gemma3:4b", system="S" * 60_000, history=[], query="q",
            transport=chat_server(capabilities=["completion"], evaluated=4099, seen=seen),
        )


async def test_says_plainly_when_ollama_is_not_running() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(LocalModelError, match="not running"):
        await collect(
            model="gemma3:4b", system="s", history=[], query="q", transport=ollama(refuse)
        )


async def test_says_which_model_is_missing() -> None:
    def server(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "model not found"})

    with pytest.raises(LocalModelError, match="no model named"):
        await collect(model="nope:1b", system="s", history=[], query="q", transport=ollama(server))


# -- the request -----------------------------------------------------------------


def base_request(**overrides) -> dict:
    request = {
        "kind": "local_chat_request", "request_id": "local-1", "query": "hello",
        "model": "qwen3.5:9b", "profile": "student", "language": "es",
    }
    request.update(overrides)
    return request


@pytest.mark.parametrize(
    "model", ["qwen3.5:9b", "library/llama3.1:8b", "hf.co/user/repo:Q4_K_M", "gemma3:4b"]
)
def test_accepts_ollama_model_names(model: str) -> None:
    assert LocalChatRequest.model_validate(base_request(model=model)).model == model


@pytest.mark.parametrize(
    "model", ["", "a b", "x?y=1", "http://evil.example/model", "a\nb", "x" * 201]
)
def test_refuses_anything_that_is_not_a_model_name(model: str) -> None:
    with pytest.raises(ValidationError):
        LocalChatRequest.model_validate(base_request(model=model))


def test_carries_no_key_and_refuses_one_smuggled_in() -> None:
    with pytest.raises(ValidationError):
        LocalChatRequest.model_validate(base_request(api_key="sk-anything"))


# -- the instructions ------------------------------------------------------------


@pytest.mark.parametrize("profile", PROFILES)
@pytest.mark.parametrize("language", LANGUAGES)
def test_safety_comes_first_for_every_profile_and_language(profile: str, language: str) -> None:
    text = build_local_instructions(profile=profile, language=language, selection=[])  # type: ignore[arg-type]
    assert text.startswith(SAFETY)


@pytest.mark.parametrize("language", LANGUAGES)
def test_the_rules_are_restated_last_where_a_small_model_still_holds_them(language: str) -> None:
    # Measured: with SAFETY only at the top, llama3.1:8b named "the most likely
    # cause" of a reader's own headache. The rules stay first and are restated last.
    text = build_local_instructions(profile="layperson", language=language, selection=[])  # type: ignore[arg-type]
    assert text.startswith(SAFETY)
    assert text.endswith(LOCAL_SAFETY_REMINDER)


def test_tells_the_model_it_has_no_tools_and_teaches_none() -> None:
    text = build_local_instructions(profile="student", language="en", selection=[])
    assert "no tools" in text
    for tool in ("isolate_structures", "focus_organ", "highlight_pathway", "set_heart_rhythm"):
        assert tool not in text


# -- the handler -------------------------------------------------------------------


class Recorder:
    def __init__(self) -> None:
        self.events: list[object] = []

    def emit(self, event: object) -> None:
        self.events.append(event)

    def log(self, message: str) -> None:
        pass


async def test_the_handler_emits_text_and_never_a_scene_command(monkeypatch) -> None:
    from anatria_engine import handlers, local_chat

    async def fake_stream(**_kwargs):
        yield local_chat.LocalText("Hola.")
        yield local_chat.LocalDone(usage=None, model="ollama:gemma3:4b")

    monkeypatch.setattr(local_chat, "stream_local_chat", fake_stream)
    recorder = Recorder()
    await handlers.handle_local_chat(
        LocalChatRequest.model_validate(base_request()), recorder  # type: ignore[arg-type]
    )
    kinds = [type(event).__name__ for event in recorder.events]
    assert kinds == ["TextDeltaEvent", "DoneEvent"]
    assert isinstance(recorder.events[0], TextDeltaEvent)


async def test_listing_models_closes_its_request(monkeypatch) -> None:
    from anatria_engine import handlers, local_chat
    from anatria_engine.protocol import LocalModelsRequest

    async def fake_list():
        return True, []

    monkeypatch.setattr(local_chat, "list_local_models", fake_list)
    recorder = Recorder()
    await handlers.handle_local_models(
        LocalModelsRequest(request_id="local-models-1"), recorder  # type: ignore[arg-type]
    )
    assert isinstance(recorder.events[0], LocalModelsEvent)
    assert type(recorder.events[-1]).__name__ == "DoneEvent"
