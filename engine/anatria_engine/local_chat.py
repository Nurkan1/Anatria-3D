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

# Why the language is decided here and not by the model

The model answers in the language of the question, and in English when that
language is not one it can be trusted to write. It cannot be asked to do both:
told to follow the reader it keeps to whatever the instructions name, and told
it may fall back to English it does so for everything (`prompts._local_language_rule`
has the measurements). But asked only "what language is this?", all three models
on the machine this was built on got every question right in half a second, so
`detect_answer_language` asks that first and the answer is then named to it.

Whether it *can* write a language it does not know: gemma3:4b, qwen3.5:9b and
llama3.1:8b all answered a question in Gujarati fluently, and all three got the
anatomy wrong — one called the left ventricle "Thymus". A model that does not
know it is wrong cannot take the way out. So the decision is a list.

# Where it connects

Only to Ollama's default address on the loopback interface, fixed here. The
window cannot name another host: a renderer that could aim the engine at an
arbitrary URL would be a way to send the reader's conversation anywhere.

That is not enough on its own, because the loopback address is not always the
end of the road. Ollama's server forwards a cloud model to ollama.com: it has
the same shape of name, sits in the same `/api/tags` list and answers on the same
address, so a reader who has one would be told "nothing leaves this computer"
while their questions did. Such a model is left out of the picker, and refused
again before anything is sent, because a name can be remembered from before it
stopped being local (`RemoteModelError`).
"""

from __future__ import annotations

import json
import math
import re
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

#: The language an answer falls back to.
FALLBACK_LANGUAGE = "English"

#: Languages a local model is allowed to answer in. Anything else is answered in
#: English, because fluency is not evidence of being right: see the module notes.
#: Also a boundary: this is the only way a model's reply reaches the instructions
#: of the next request, so a question cannot talk its way into the prompt.
SUPPORTED_LANGUAGES = frozenset(
    {
        "Arabic", "Bulgarian", "Chinese", "Croatian", "Czech", "Danish", "Dutch",
        "English", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi",
        "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Macedonian",
        "Malay", "Mandarin", "Norwegian", "Persian", "Polish", "Portuguese",
        "Romanian", "Russian", "Serbian", "Slovak", "Slovenian", "Spanish",
        "Swedish", "Thai", "Turkish", "Ukrainian", "Vietnamese",
    }
)

#: Below this many bytes of letters a message says nothing about its language:
#: "ok", "и?". Bytes rather than characters so a short question in Japanese, where
#: four characters are a sentence, still counts.
_MIN_LANGUAGE_BYTES = 12

#: How many of the reader's messages to try, newest first, when the latest one is
#: too short or is only an anatomical term.
_DETECTION_TURNS = 3

#: How much of a message is enough to recognise its language.
_DETECTION_CHARS = 400

#: Bulgarian is spelled out because gemma3:4b took short Bulgarian questions for
#: Russian ("А белите дробове?") and then answered in neither. With the hint,
#: every Bulgarian question in the sample was named correctly by all three models.
_DETECT_PROMPT = (
    "Name the language this text is written in. Reply with only the English name "
    "of the language, one word. Bulgarian, Russian, Ukrainian and Serbian all use "
    "Cyrillic: tell them apart carefully. Bulgarian uses words like какво, къде, "
    "коя, колко, защо and definite endings such as -та, -то, -ът, -ят. Anatomical "
    "Latin terms alone count as Latin.\n\nText: "
)

_CONNECT_TIMEOUT_S = 3.0
#: Loading a model from disk can take tens of seconds before the first token.
_READ_TIMEOUT_S = 180.0


class LocalModelError(Exception):
    """Something the reader can act on: Ollama absent, a model missing, a refusal."""


class TruncatedPromptError(LocalModelError):
    """Ollama evaluated less of the prompt than was sent; the answer is not trusted."""


class RemoteModelError(LocalModelError):
    """The model runs on a server, which is what this screen promises not to use."""


@dataclass(frozen=True)
class LocalText:
    text: str


@dataclass(frozen=True)
class LocalDone:
    usage: TokenUsage | None
    model: str


@dataclass(frozen=True)
class AnswerLanguage:
    name: str
    #: The reader wrote in a language off the list, and is being told why this is
    #: in English. False when English is simply what there was to go on.
    unsupported: bool = False


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


def _is_cloud_name(name: str) -> bool:
    """A tag Ollama routes to its servers: `gemma4:cloud`, `gpt-oss:120b-cloud`."""
    tag = name.rpartition(":")[2].lower()
    return tag == "cloud" or tag.endswith("-cloud")


def _names_a_server(record: dict[str, object]) -> bool:
    """Whether an entry from `/api/tags` or `/api/show` is forwarded somewhere else."""
    return bool(record.get("remote_host") or record.get("remote_model"))


def _remote_model_error(name: str) -> RemoteModelError:
    return RemoteModelError(
        f"{name} runs on a server, not on this computer, so it is not available here. "
        "Pick a model you have downloaded."
    )


async def _capabilities(client: httpx.AsyncClient, name: str) -> list[str]:
    # Before the request: Ollama answers `/api/show` for a cloud name from its servers.
    if _is_cloud_name(name):
        raise _remote_model_error(name)
    response = await client.post("/api/show", json={"model": name})
    if response.status_code == 404:
        raise LocalModelError(
            f"Ollama has no model named {name!r}. Pull it first, or pick another."
        )
    response.raise_for_status()
    record = response.json()
    if _names_a_server(record):
        raise _remote_model_error(name)
    value = record.get("capabilities")
    return [str(item) for item in value] if isinstance(value, list) else []


async def list_local_models(
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[bool, list[LocalModelInfo]]:
    """Whether Ollama answers, and the chat models it has.

    Embedding-only models (an `bge-m3` pulled for retrieval) are left out: they
    cannot hold a conversation, and offering one would only produce an error.
    A model that does not report its capabilities is offered — older servers
    say nothing, and every model they serve can chat. Cloud models are left out
    too: see the module notes.
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
            if _is_cloud_name(name) or _names_a_server(entry):
                continue
            try:
                capabilities = await _capabilities(client, name)
            except RemoteModelError:
                continue
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


def _chat_body(
    model: str, capabilities: list[str], messages: list[dict[str, str]], **options: float
) -> dict[str, object]:
    body: dict[str, object] = {
        "model": model,
        "messages": messages,
        # The same window every time: Ollama reloads a model for a different one.
        "options": {"num_ctx": NUM_CTX, **options},
    }
    # A reasoning model would otherwise stream its private deliberation as
    # if it were the answer. Asked only of models that can think: the
    # server refuses the field from one that cannot.
    if "thinking" in capabilities:
        body["think"] = False
    return body


def _language_named(reply: str) -> str | None:
    """The language a model's reply names, or None if it names nothing usable.

    Latin is None too: "Arteria femoralis" says what the atlas calls a structure,
    not what its author reads, and left alone two of three models answered it in
    Latin. A single unknown word is taken as a language off the list; a sentence
    with no listed language in it is not taken as anything.
    """
    words = [word.capitalize() for word in re.findall(r"[^\W\d_]+", reply)]
    for word in words:
        if word in SUPPORTED_LANGUAGES:
            return word
    return words[0] if len(words) == 1 and words[0] != "Latin" else None


async def detect_answer_language(
    *,
    model: str,
    history: list[TranscriptTurn],
    query: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AnswerLanguage:
    """The language to answer in, from what the reader wrote.

    Newest message first, passing over one too short to tell or that is only
    Latin, so "ok" stays in the language of the conversation. English when
    nothing can be told. This never fails a turn: if Ollama is down, the request
    for the answer comes straight after and reports it in the reader's terms.
    """
    said = [query, *(turn.content for turn in reversed(history) if turn.role == "user")]
    async with _client(transport) as client:
        try:
            capabilities = await _capabilities(client, model)
            for text in said[:_DETECTION_TURNS]:
                letters = "".join(character for character in text if character.isalpha())
                if len(letters.encode("utf-8")) < _MIN_LANGUAGE_BYTES:
                    continue
                prompt = _DETECT_PROMPT + text[:_DETECTION_CHARS]
                body = _chat_body(
                    model,
                    capabilities,
                    [{"role": "user", "content": prompt}],
                    num_predict=12,
                    temperature=0,
                )
                response = await client.post("/api/chat", json={**body, "stream": False})
                response.raise_for_status()
                name = _language_named((response.json().get("message") or {}).get("content") or "")
                if name in SUPPORTED_LANGUAGES:
                    return AnswerLanguage(name)
                if name is not None:
                    return AnswerLanguage(FALLBACK_LANGUAGE, unsupported=True)
        except (httpx.HTTPError, LocalModelError, ValueError):
            pass
    return AnswerLanguage(FALLBACK_LANGUAGE)


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
        body = {**_chat_body(model, capabilities, messages), "stream": True}

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
