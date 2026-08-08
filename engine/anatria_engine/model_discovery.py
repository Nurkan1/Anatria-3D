"""Ask each provider which models a given key can actually use.

This is also how a key gets validated. Rather than a separate "test connection"
path that could drift from the real one, the call that populates the picker is
the call that proves the credential works: a bad key fails here exactly as it
would fail on the first question.

Listing is filtered to models that can hold a tool-using conversation. Every
provider's catalogue also contains embedding, speech and image models, and
offering one of those in a chat picker produces a confusing failure at the first
message instead of a clear absence at setup.
"""

from __future__ import annotations

import asyncio

from anatria_engine.protocol import AiProvider, ModelInfo
from anatria_engine.providers import DEFAULT_MODELS, ProviderError

#: Substrings that mark a model as unusable for tool-driven chat.
_EXCLUDED = (
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


def _is_chat_model(model_id: str) -> bool:
    lowered = model_id.lower()
    return not any(token in lowered for token in _EXCLUDED)


def _finish(provider: AiProvider, models: list[ModelInfo]) -> list[ModelInfo]:
    """Sort newest-looking first and mark the engine's default."""
    default = DEFAULT_MODELS[provider]

    unique: dict[str, ModelInfo] = {}
    for model in models:
        unique.setdefault(model.id, model)

    ordered = sorted(unique.values(), key=lambda m: m.id, reverse=True)
    for model in ordered:
        model.recommended = model.id == default

    # If the configured default is not in the catalogue — the provider retired
    # it, or this key has no access — say so by promoting the first real entry,
    # rather than leaving a picker with nothing marked.
    if ordered and not any(model.recommended for model in ordered):
        ordered[0].recommended = True
    return ordered


def _list_google(api_key: str) -> list[ModelInfo]:
    from google import genai

    client = genai.Client(api_key=api_key)
    models: list[ModelInfo] = []
    for model in client.models.list():
        actions = getattr(model, "supported_actions", None) or []
        # Google's catalogue mixes generation, embedding and tuning endpoints;
        # only the ones supporting generateContent can answer a question.
        if actions and "generateContent" not in actions:
            continue
        raw_id = (model.name or "").removeprefix("models/")
        if not raw_id or not _is_chat_model(raw_id):
            continue
        models.append(
            ModelInfo(
                id=raw_id,
                label=getattr(model, "display_name", None) or raw_id,
                description=getattr(model, "description", None),
            )
        )
    return models


def _list_anthropic(api_key: str) -> list[ModelInfo]:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    models: list[ModelInfo] = []
    for model in client.models.list(limit=100):
        if not _is_chat_model(model.id):
            continue
        models.append(
            ModelInfo(id=model.id, label=getattr(model, "display_name", None) or model.id)
        )
    return models


def _list_openai(api_key: str) -> list[ModelInfo]:
    import openai

    client = openai.OpenAI(api_key=api_key)
    models: list[ModelInfo] = []
    for model in client.models.list():
        model_id = model.id
        # OpenAI returns the whole account catalogue, including fine-tunes and
        # non-chat endpoints. Keep the generative families.
        if not model_id.startswith(("gpt-", "o1", "o3", "o4", "chatgpt-")):
            continue
        if not _is_chat_model(model_id):
            continue
        models.append(ModelInfo(id=model_id, label=model_id))
    return models


async def list_models(provider: AiProvider, api_key: str) -> list[ModelInfo]:
    """Fetch the usable models for a key.

    The provider SDKs expose synchronous list endpoints, so the call runs on a
    worker thread — blocking the event loop here would stall any answer that is
    streaming at the same time.
    """
    listers = {
        "google": _list_google,
        "anthropic": _list_anthropic,
        "openai": _list_openai,
    }
    try:
        models = await asyncio.to_thread(listers[provider], api_key)
    except ImportError as exc:  # pragma: no cover - packaging failure
        raise ProviderError(
            f"The {provider} integration is missing from this build: {exc}"
        ) from exc

    return _finish(provider, models)
