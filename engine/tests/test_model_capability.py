"""Which models are offered, and which endpoint each is driven through.

Every pattern in `model_capability` earns its place by naming a model. These
tests are that naming — when a provider ships a family that behaves differently,
this file is where the evidence goes.
"""

from __future__ import annotations

import pytest

from anatria_engine.model_capability import endpoint_for, is_offered
from anatria_engine.providers import DEFAULT_MODELS

# ---------------------------------------------------------------------------
# Which endpoint
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("model_id", ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"])
def test_the_reasoning_family_goes_through_responses(model_id: str):
    """OpenAI refuses function tools for these on Chat Completions.

    Its own rejection names `/v1/responses` as the fix. The alternative it
    offers — `reasoning_effort='none'` — would discard the reason anyone chose
    one of these models.
    """
    assert endpoint_for("openai", model_id) == "responses"


def test_the_validated_default_stays_on_the_endpoint_it_was_validated_on():
    """The blast-radius rule. A compatibility fix must not quietly move the one
    model every shipped release has run on."""
    assert endpoint_for("openai", DEFAULT_MODELS["openai"]) == "chat"


@pytest.mark.parametrize("model_id", ["gpt-4.1", "o3", "gpt-9-unheard-of"])
def test_an_unrecognised_model_takes_the_conservative_path(model_id: str):
    assert endpoint_for("openai", model_id) == "chat"


@pytest.mark.parametrize("provider", ["anthropic", "google"])
def test_the_other_providers_are_untouched(provider: str):
    assert endpoint_for(provider, DEFAULT_MODELS[provider]) == "chat"
    assert endpoint_for(provider, "gpt-5.6-terra") == "chat"


@pytest.mark.parametrize(
    "model_id",
    ["gpt-6-astra", "gpt-6", "gpt-6.1-mini", "gpt-5.6-terra"],
)
def test_a_family_that_reasons_by_default_goes_to_responses(model_id: str):
    """Reported: gpt-6-astra was refused with "Function tools with
    reasoning_effort are not supported ... in /v1/chat/completions". The whole
    family is matched, so a variant nobody has seen yet is routed too."""
    assert endpoint_for("openai", model_id) == "responses"


def test_case_does_not_decide_the_endpoint():
    assert endpoint_for("openai", "GPT-5.6-Terra") == "responses"


# ---------------------------------------------------------------------------
# What is offered
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "model_id",
    [
        "text-embedding-3-large",
        "whisper-1",
        "tts-1-hd",
        "dall-e-3",
        "omni-moderation-latest",
        "gpt-4o-audio-preview",
        "gpt-4o-realtime-preview",
        "imagen-3.0",
        "veo-2.0",
    ],
)
def test_models_that_cannot_hold_a_conversation_are_not_offered(model_id: str):
    assert not is_offered("openai", model_id)
    assert not is_offered("google", model_id)


@pytest.mark.parametrize(
    "model_id",
    [
        "o3-deep-research",
        "gpt-4o-search-preview",
        "codex-mini-latest",
        "gpt-5-pro",
        "chatgpt-4o-latest",
        "gpt-3.5-turbo-instruct",
    ],
)
def test_specialised_models_are_not_offered(model_id: str):
    """They are conversational, and still cannot complete this flow — their own
    agent loop, no streaming, or no reliable tool support."""
    assert not is_offered("openai", model_id)


@pytest.mark.parametrize(
    ("provider", "model_id"),
    [
        ("openai", "gpt-5.2"),
        ("openai", "gpt-5.6-terra"),
        ("openai", "o3"),
        ("anthropic", "claude-sonnet-5"),
        ("google", "gemini-3.1-flash-lite"),
    ],
)
def test_the_working_models_are_offered(provider: str, model_id: str):
    assert is_offered(provider, model_id)


def test_every_provider_default_is_offered():
    """Otherwise the picker would hide the one model that is recommended."""
    for provider, model_id in DEFAULT_MODELS.items():
        assert is_offered(provider, model_id), f"{provider} hides its own default"


def test_an_unfamiliar_model_is_offered_rather_than_hidden():
    """There is no auto-updater.

    Hiding an unrecognised id would make a model released next month invisible
    to every installed copy until its owner noticed a new version existed and
    reinstalled by hand — trading "fails with a clear message" for "does not
    exist", which is worse because it is silent.
    """
    assert is_offered("openai", "gpt-9-turbo-something")
    assert is_offered("anthropic", "claude-7-opus")


def test_specialised_is_an_openai_judgement_only():
    """`-pro` and the rest are OpenAI's naming. Applying them to another
    provider's catalogue would hide models on a coincidence of spelling."""
    assert is_offered("anthropic", "claude-pro-experimental")
    assert is_offered("google", "gemini-pro")


# ---------------------------------------------------------------------------
# The routing actually happens
# ---------------------------------------------------------------------------
#
# `endpoint_for` returning the right string proves nothing on its own — the
# question is whether `build_model` acts on it. These construct the real SDK
# objects with a throwaway key; nothing leaves the machine, because no request
# is made.


def test_the_default_is_built_as_a_chat_model():
    from pydantic_ai.models.openai import OpenAIChatModel

    from anatria_engine.providers import build_model

    model = build_model("openai", "sk-not-a-real-key", DEFAULT_MODELS["openai"])
    assert isinstance(model, OpenAIChatModel)


def test_terra_is_built_as_a_responses_model():
    """The fix, at the point where it has an effect."""
    from pydantic_ai.models.openai import OpenAIResponsesModel

    from anatria_engine.providers import build_model

    model = build_model("openai", "sk-not-a-real-key", "gpt-5.6-terra")
    assert isinstance(model, OpenAIResponsesModel)


def test_the_responses_route_does_not_leave_the_conversation_on_the_server():
    """Anatria3D owns its history. A second copy held by the provider would be
    somewhere this application does not manage and cannot delete."""
    from anatria_engine.providers import build_model

    model = build_model("openai", "sk-not-a-real-key", "gpt-5.6-terra")
    assert model.settings is not None
    assert model.settings.get("openai_store") is False


def test_an_unchosen_model_still_resolves_to_the_default_route():
    from pydantic_ai.models.openai import OpenAIChatModel

    from anatria_engine.providers import build_model

    assert isinstance(build_model("openai", "sk-not-a-real-key", None), OpenAIChatModel)


# ---------------------------------------------------------------------------
# Anthropic is the one provider that caches nothing unless asked
# ---------------------------------------------------------------------------


def test_anthropic_asks_for_its_prompt_cache():
    """Measured, not assumed: a real journal recorded 44 Anthropic turns and
    775,199 input tokens at 0% cached, while OpenAI on the same journal ran at
    74-97%. Anthropic caches only where `cache_control` is sent, and nothing
    sent it."""
    from anatria_engine.providers import build_model

    model = build_model("anthropic", "sk-not-a-real-key", "claude-haiku-4-5")
    settings = model.settings or {}
    assert settings.get("anthropic_cache_tool_definitions") is True
    assert settings.get("anthropic_cache_instructions") is True


def test_anthropic_does_not_cache_the_growing_half():
    """The messages block grows every turn, so a breakpoint there writes a new
    and larger entry each time — paying the write premium over and over for a
    prefix that has already changed."""
    from anatria_engine.providers import build_model

    model = build_model("anthropic", "sk-not-a-real-key", "claude-haiku-4-5")
    assert "anthropic_cache_messages" not in (model.settings or {})


def test_the_other_providers_are_left_alone():
    """OpenAI caches any prompt over 1,024 tokens by itself and Gemini caches
    implicitly. Neither needs asking, and a setting invented for them here
    would be a guess this file has no way to check."""
    from anatria_engine.providers import build_model

    for provider, model_id in [("openai", "gpt-5.2"), ("google", "gemini-3.7-flash")]:
        settings = build_model(provider, "not-a-real-key", model_id).settings or {}
        assert not any(key.startswith("anthropic_") for key in settings)
