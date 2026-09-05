"""What a model can actually do, as opposed to what a catalogue lists.

# Why this file exists

`/v1/models` answers "can this key see it", which is not the question. The
question is whether a model can hold a **streaming, tool-driven** conversation
on the endpoint this engine speaks — and no provider exposes that. OpenAI's
listing returns an id, a timestamp and an owner. Nothing else.

So the signal available is the id, and the honest description of what follows is
pattern matching. The improvement over what was here before is not that the
patterns are principled — they are not — but that:

* there is **one** place to look when a provider ships a new family;
* the outcome is an *endpoint and a decision*, not a scattered boolean;
* an id nobody recognises is never silently recommended (see `_finish`);
* every pattern has a test naming the model that motivated it.

# Why unknown models are still offered

The tempting design is an allow-list: show only what we have driven. It is the
wrong one **for this application specifically**, because there is no
auto-updater. A model released next month would be invisible to every installed
copy until its owner noticed a new version existed and reinstalled by hand.
That trades "fails with a clear message" for "does not exist", which is worse,
because the second is silent.

So: known-bad is hidden, known-good is routed, and everything else is offered
and routed down the conservative path. If it cannot do the job the provider
says so, and `_classify` now turns that into a sentence with a next step.
"""

from __future__ import annotations

from typing import Literal

from anatria_engine.protocol import AiProvider

#: Which HTTP surface a model has to be driven through.
Endpoint = Literal["chat", "responses"]


#: Not conversational at all. Embeddings, speech, images, moderation.
#:
#: These would fail at the first message with something unreadable, so they are
#: absent from the picker rather than present and broken.
_NOT_CONVERSATIONAL = (
    "embedding",
    "embed",
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "image-",
    "-image",
    "audio",
    "realtime",
    "transcribe",
    "aqa",
    "veo",
    "imagen",
)

#: Conversational, but specialised in a way that cannot complete this flow.
#:
#: * `deep-research` and `search-preview` run their own agent loop and their own
#:   tools; they will not accept ours.
#: * `codex` is tuned for code, and nothing in an anatomy atlas wants it.
#: * `-pro` variants do not stream, and this application streams every answer.
#: * `chatgpt-` snapshots track the consumer product; OpenAI documents them as
#:   not for API use, and their tool support has moved without notice.
#: * `-instruct` is a completion model with no chat turn structure.
_SPECIALISED = (
    "deep-research",
    "search-preview",
    "codex",
    "-pro",
    "chatgpt-",
    "-instruct",
)

#: Families that will not be served function tools over Chat Completions.
#:
#: GPT-5.6 reasons by default, and OpenAI refuses that combination on
#: `/v1/chat/completions` — the rejection names `/v1/responses` as the fix. The
#: alternative it offers, `reasoning_effort='none'`, would throw away the reason
#: anybody picked one of these.
#:
#: GPT-6 arrived reasoning by default too and was refused the same way, which
#: says something about this list rather than about the model: it names families
#: that already exist, and a family released after a build cannot be on it.
#: There is no auto-updater here, so an installed copy stays wrong until its
#: owner reinstalls by hand. The whole family prefix is matched rather than the
#: exact id — `gpt-6-astra` should not have needed its own entry, and the next
#: variant of it will not get one.
_RESPONSES_ONLY = ("gpt-5.6", "gpt-6")


def _lower(model_id: str) -> str:
    return model_id.lower()


def is_offered(provider: AiProvider, model_id: str) -> bool:
    """Whether this model belongs in the picker.

    False only for ids matching something known to be unusable. An unfamiliar
    id is offered — see the module docstring for why hiding it would be worse.
    """
    lowered = _lower(model_id)
    if any(token in lowered for token in _NOT_CONVERSATIONAL):
        return False
    return not (
        provider == "openai" and any(token in lowered for token in _SPECIALISED)
    )


def endpoint_for(provider: AiProvider, model_id: str) -> Endpoint:
    """Which OpenAI surface to drive this model through.

    Conservative by default. `chat` is the path every shipped release has used
    and the one the default model is validated on, so a family we do not
    recognise goes down it rather than onto a newer endpoint on a guess.
    """
    if provider != "openai":
        return "chat"
    lowered = _lower(model_id)
    return "responses" if any(token in lowered for token in _RESPONSES_ONLY) else "chat"
