"""Chat with a model running in Ollama on this computer — words only.

# What it is for

A reader with Ollama installed can talk anatomy with a model that runs on their
own machine: no key, no account, nothing leaving the computer. It is a
conversation and nothing more. It cannot move, isolate or light anything in the
atlas, and that is a property of this module rather than a request to the model:
there is no agent here and no tool to call. A small local model guesses at
structure ids; a guessed id that moved the viewport would teach something false
with the atlas's authority behind it.

# Why the native API and not the OpenAI-compatible one

Ollama's `/v1/chat/completions` ignores a requested context size and runs every
model in whatever window the server was started with — 8,192 tokens on the
machine this was built on. Past that it does not fail: it silently drops the
*beginning* of the prompt and keeps the end. Measured: a 20,000-token prompt
came back as 4,099 tokens evaluated, and a code word placed at the top was gone.
The top of our prompt is `SAFETY`. A long enough conversation would have been
answered by a model that never saw the rules that keep this application outside
medical-device regulation.

`/api/chat` accepts `options.num_ctx`, and the same 20,000 tokens came back
whole. So this module:

1. asks for a fixed window (`NUM_CTX`) on every request;
2. drops the oldest turns itself, before Ollama could, keeping the estimated
   prompt well inside that window (`fit_history`);
3. checks what Ollama reports it evaluated, and refuses an answer built on a
   prompt shorter than the one sent (`TruncatedPromptError`).

# Where it connects

Only to Ollama's default address on the loopback interface, fixed here. The
window cannot name another host: a renderer that could aim the engine at an
arbitrary URL would be a way to send the reader's conversation anywhere.
"""

from __future__ import annotations

import json
import math
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from anatria_engine.protocol import LocalModelInfo, TokenUsage, TranscriptTurn

#: Ollama's default address. Loopback only, and not configurable from the window.
OLLAMA_URL = "http://127.0.0.1:11434"

#: The context window asked for on every request, in tokens. Large enough for the
#: instructions and a long conversation; small enough that a 9B model's cache
#: still fits beside the atlas on an ordinary laptop GPU.
NUM_CTX = 16_384

#: The share of the window the prompt may fill, by estimate. The rest is room for
#: the answer and for the estimate being wrong.
PROMPT_SHARE = 0.6

#: Characters per token assumed when estimating. Deliberately pessimistic:
#: English runs nearer four, but Bulgarian in Cyrillic can fall below three, and
#: overestimating only drops an old turn sooner.
CHARS_PER_TOKEN = 2.5

#: A prompt is taken as truncated when Ollama evaluated fewer tokens than this
#: many characters each would produce — an estimate no tokenizer undercuts.
TRUNCATION_CHARS_PER_TOKEN = 6.0

_CONNECT_TIMEOUT_S = 3.0
#: Loading a model from disk can take tens of seconds before the first token.
_READ_TIMEOUT_S = 180.0


class LocalModelError(Exception):
    """Something the reader can act on: Ollama absent, a model missing, a refusal."""


class TruncatedPromptError(LocalModelError):
    """Ollama evaluated less of the prompt than was sent; the answer is not trusted."""


@dataclass(frozen=True)
class LocalText:
    text: str


@dataclass(frozen=True)
class LocalDone:
    usage: TokenUsage | None
    model: str


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / CHARS_PER_TOKEN)


def fit_history(
    system: str,
    history: list[TranscriptTurn],
    query: str,
    budget: int = int(NUM_CTX * PROMPT_SHARE),
) -> list[TranscriptTurn]:
    """The most recent turns that fit, with the system prompt and query, in `budget`.

    Oldest first in, oldest first out: the instructions and the question are
    never what gives way. A turn is dropped with its partner so the transcript
    never starts on an answer to a question that is no longer there.
    """
    fixed = estimate_tokens(system) + estimate_tokens(query)
    kept: list[TranscriptTurn] = []
    used = fixed
    for turn in reversed(history):
        cost = estimate_tokens(turn.content)
        if used + cost > budget:
            break
        kept.append(turn)
        used += cost
    kept.reverse()
    # Never open on an assistant turn whose question was dropped.
    while kept and kept[0].role == "assistant":
        kept.pop(0)
    return kept


def _client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=OLLAMA_URL,
        timeout=httpx.Timeout(_READ_TIMEOUT_S, connect=_CONNECT_TIMEOUT_S),
        transport=transport,
    )


_NOT_RUNNING = (
    "Ollama is not running on this computer. Start Ollama, then try again — "
    "nothing here is sent anywhere else."
)


async def _capabilities(client: httpx.AsyncClient, name: str) -> list[str]:
    response = await client.post("/api/show", json={"model": name})
    if response.status_code == 404:
        raise LocalModelError(
            f"Ollama has no model named {name!r}. Pull it first, or pick another."
        )
    response.raise_for_status()
    value = response.json().get("capabilities")
    return [str(item) for item in value] if isinstance(value, list) else []


async def list_local_models(
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[bool, list[LocalModelInfo]]:
    """Whether Ollama answers, and the chat models it has.

    Embedding-only models (an `bge-m3` pulled for retrieval) are left out: they
    cannot hold a conversation, and offering one would only produce an error.
    A model that does not report its capabilities is offered — older servers
    say nothing, and every model they serve can chat.
    """
    async with _client(transport) as client:
        try:
            response = await client.get("/api/tags")
        except httpx.TransportError:
            return False, []
        response.raise_for_status()
        models: list[LocalModelInfo] = []
        for entry in response.json().get("models", []):
            name = entry.get("name") or entry.get("model")
            if not isinstance(name, str) or not name:
                continue
            capabilities = await _capabilities(client, name)
            if capabilities and "completion" not in capabilities:
                continue
            details = entry.get("details") or {}
            size = entry.get("size")
            models.append(
                LocalModelInfo(
                    name=name,
                    parameter_size=details.get("parameter_size") or None,
                    size_bytes=size if isinstance(size, int) and size >= 0 else None,
                )
            )
        models.sort(key=lambda model: model.name)
        return True, models


async def stream_local_chat(
    *,
    model: str,
    system: str,
    history: list[TranscriptTurn],
    query: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[LocalText | LocalDone]:
    """Stream one answer from `model`, then a `LocalDone` with what it evaluated."""
    kept = fit_history(system, history, query)
    messages = [{"role": "system", "content": system}]
    messages += [{"role": turn.role, "content": turn.content} for turn in kept]
    messages.append({"role": "user", "content": query})
    sent_chars = sum(len(message["content"]) for message in messages)

    async with _client(transport) as client:
        try:
            capabilities = await _capabilities(client, model)
        except httpx.TransportError as exc:
            raise LocalModelError(_NOT_RUNNING) from exc
        body: dict[str, object] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {"num_ctx": NUM_CTX},
        }
        # A reasoning model would otherwise stream its private deliberation as
        # if it were the answer. Asked only of models that can think: the
        # server refuses the field from one that cannot.
        if "thinking" in capabilities:
            body["think"] = False

        evaluated: int | None = None
        generated: int | None = None
        try:
            async with client.stream("POST", "/api/chat", json=body) as response:
                if response.status_code >= 400:
                    detail = (await response.aread()).decode("utf-8", "replace")
                    raise LocalModelError(_server_message(detail, response.status_code))
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    frame = json.loads(line)
                    if frame.get("error"):
                        raise LocalModelError(str(frame["error"]))
                    text = (frame.get("message") or {}).get("content") or ""
                    if text:
                        yield LocalText(text)
                    if frame.get("done"):
                        evaluated = frame.get("prompt_eval_count")
                        generated = frame.get("eval_count")
        except httpx.TransportError as exc:
            raise LocalModelError(_NOT_RUNNING) from exc

    if isinstance(evaluated, int) and evaluated < sent_chars / TRUNCATION_CHARS_PER_TOKEN:
        raise TruncatedPromptError(
            "Ollama dropped the start of the conversation, which is where the safety "
            "rules are, so this answer was not shown. Start a new conversation."
        )
    usage = (
        TokenUsage(input_tokens=evaluated, output_tokens=generated)
        if isinstance(evaluated, int) and isinstance(generated, int)
        else None
    )
    yield LocalDone(usage=usage, model=f"ollama:{model}")


def _server_message(detail: str, status: int) -> str:
    try:
        message = json.loads(detail).get("error")
    except (ValueError, AttributeError):
        message = None
    return str(message) if message else f"Ollama refused the request (HTTP {status})."
