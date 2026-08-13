"""A model that cannot drive the scene tools must say so, and never be picked.

Two failures observed on an OpenAI key, both of which read to the user as "this
application is broken":

1. Selecting GPT-5.6 Terra produced `internal_error`. OpenAI had in fact
   answered precisely — the model reasons by default and will not be served
   function tools over `/v1/chat/completions` — but the classifier had no
   branch for it, so a provider saying "pick a different model" arrived looking
   like a fault in here.

2. If the tested default were ever absent from a key's catalogue, the engine
   promoted the first entry instead. The catalogue is sorted by id descending,
   so on a current OpenAI key the first entry is `gpt-5.6-terra`: the fallback
   for "the safe model is missing" was to recommend the broken one.
"""

from __future__ import annotations

import pytest

from anatria_engine.handlers import _classify, _readable
from anatria_engine.model_discovery import _finish
from anatria_engine.protocol import ModelInfo
from anatria_engine.providers import DEFAULT_MODELS


class ProviderRejectionError(Exception):
    """Shaped like the error the OpenAI SDK actually raises."""


#: Copied from the observed failure, not paraphrased.
TERRA = ProviderRejectionError(
    "status_code: 400, model_name: gpt-5.6-terra, body: {'message': \"Function "
    "tools with reasoning_effort are not supported for gpt-5.6-terra in "
    "/v1/chat/completions. To use function tools, use /v1/responses or set "
    "reasoning_effort to 'none'.\", 'type': 'invalid_request_error', 'param': "
    "'reasoning_effort', 'code': None}"
)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def test_an_incompatible_model_is_not_an_internal_error():
    """The regression. Restore the old classifier and this fails."""
    assert _classify(TERRA) == "invalid_request"


def test_the_message_leads_with_what_the_reader_can_press():
    readable = _readable(TERRA)
    assert readable.startswith("This model cannot be driven by Anatria3D")
    assert "Settings" in readable
    # The provider's own wording is kept: it names the model and the endpoint,
    # which is what a bug report needs.
    assert "gpt-5.6-terra" in readable


def test_the_message_still_fits_a_panel():
    assert len(_readable(TERRA)) <= 400


@pytest.mark.parametrize(
    "message",
    [
        "invalid_request_error: model gpt-9 does not support tools",
        "400 the model is not compatible with streaming",
        "Error code: 400 - model 'x' does not exist",
        "invalid_request_error: function calling is not supported for this model",
    ],
)
def test_the_whole_family_is_recognised(message: str):
    assert _classify(ProviderRejectionError(message)) == "invalid_request"


# A bare 400 can equally be a malformed request of ours, and calling that a
# model problem would send someone switching models to fix a bug in here.
@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("status_code: 400, body: malformed json in request", "internal_error"),
        ("status_code: 401, invalid api key provided", "invalid_api_key"),
        ("status_code: 429, rate limit exceeded", "rate_limited"),
        ("status_code: 503, the model is overloaded", "service_unavailable"),
        ("connection timeout while reaching the provider", "provider_error"),
        ("TypeError: object is not callable", "internal_error"),
    ],
)
def test_the_other_codes_are_unchanged(message: str, expected: str):
    assert _classify(ProviderRejectionError(message)) == expected


def test_an_ordinary_error_is_not_given_the_model_advice():
    assert not _readable(ProviderRejectionError("boom")).startswith("This model cannot")


# ---------------------------------------------------------------------------
# Recommendation
# ---------------------------------------------------------------------------


def catalogue(*ids: str) -> list[ModelInfo]:
    return [ModelInfo(id=model_id, label=model_id, recommended=False) for model_id in ids]


def test_the_tested_default_is_the_recommendation():
    ordered = _finish("openai", catalogue("gpt-4.1", DEFAULT_MODELS["openai"], "o3"))
    recommended = [model.id for model in ordered if model.recommended]
    assert recommended == [DEFAULT_MODELS["openai"]]


def test_nothing_is_recommended_when_the_default_is_absent():
    """The second regression, and the sharper one.

    Sorting is by id descending, so the entry that used to be promoted here is
    `gpt-5.6-terra` — the exact model that cannot be served function tools. The
    fallback for "the safe model is missing" recommended a broken one.
    """
    ordered = _finish("openai", catalogue("gpt-5.6-terra", "gpt-4.1", "o3"))
    assert ordered, "the catalogue itself must still come back"
    assert not any(model.recommended for model in ordered)


def test_an_empty_catalogue_recommends_nothing_and_does_not_raise():
    assert _finish("openai", []) == []


def test_duplicates_collapse_and_the_order_is_stable():
    ordered = _finish("google", catalogue("b", "a", "b"))
    assert [model.id for model in ordered] == ["b", "a"]


@pytest.mark.parametrize("provider", ["openai", "anthropic", "google"])
def test_every_provider_recommends_its_own_default(provider: str):
    ordered = _finish(provider, catalogue(DEFAULT_MODELS[provider], "zzz-unknown"))
    assert [model.id for model in ordered if model.recommended] == [
        DEFAULT_MODELS[provider]
    ]
