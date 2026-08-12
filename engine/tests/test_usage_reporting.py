"""A turn has to come back knowing what it cost.

This file exists because token accounting never worked once, in any released
build, and nothing noticed. `usage` on an `AgentRunResult` is an attribute, not
a method; the engine called it; every turn raised `TypeError: 'RunUsage' object
is not callable`; and a blanket `except Exception` reported that as "the
provider did not tell us what this cost".

That is the shape of failure worth writing tests against — not a crash, but a
total failure wearing the costume of a legitimately empty result. Nothing
downstream could tell the two apart, because they are the same value. So the
assertion that matters is not "this does not raise", it is **"this comes back
with a number"**.
"""

from __future__ import annotations

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from anatria_engine import agent as agent_module
from anatria_engine.agent import Completed, build_scene_context, run_agent
from anatria_engine.protocol import AgentRequest, OrganMeta


def reply(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    return ModelResponse(parts=[TextPart(content="The left ventricle pumps.")])


async def reply_stream(messages, info):
    yield "The left ventricle "
    yield "pumps."


def make_request(model: str | None = None) -> AgentRequest:
    return AgentRequest(
        request_id="r1",
        query="Explain the heart.",
        history=[],
        provider="google",
        api_key="unused-the-model-is-scripted",
        model=model,
        profile="student",
        language="en",
        gender_model="male",
        mode="tutor",
        selection=[],
        available_organs=[
            OrganMeta(
                organ_id="left_ventricle",
                ta2_latin="Ventriculus sinister",
                name_en="Left ventricle",
                system="cardiovascular",
            )
        ],
    )


async def run_to_completion(request: AgentRequest) -> Completed:
    scene = build_scene_context(request, lambda command: None)
    async for event in run_agent(request, scene):
        if isinstance(event, Completed):
            return event
    raise AssertionError("run_agent finished without ever completing the turn")


@pytest.fixture(autouse=True)
def scripted_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """Swap the provider for a scripted one, leaving the rest of the run real.

    Deliberately patched at `build_model` rather than by constructing an Agent
    by hand: the path under test is the one production uses, including the
    `AgentRunResultEvent` that carries the counts.
    """
    monkeypatch.setattr(
        agent_module,
        "build_model",
        lambda provider, api_key, model=None: FunctionModel(
            reply, stream_function=reply_stream
        ),
    )


@pytest.mark.anyio
async def test_a_finished_turn_reports_what_it_cost() -> None:
    completed = await run_to_completion(make_request())

    assert completed.usage is not None, (
        "usage came back as None — which is indistinguishable from a provider "
        "that reported nothing, and is how this broke silently before"
    )
    assert completed.usage.input_tokens > 0
    assert completed.usage.output_tokens > 0


@pytest.mark.anyio
async def test_a_finished_turn_names_the_model_that_ran_it() -> None:
    assert (await run_to_completion(make_request("gemini-3.1-pro"))).model == (
        "gemini-3.1-pro"
    )


@pytest.mark.anyio
async def test_a_turn_that_chose_no_model_still_names_the_default() -> None:
    """Otherwise every first turn files its spend against nothing."""
    from anatria_engine.providers import DEFAULT_MODELS

    completed = await run_to_completion(make_request(None))
    assert completed.model == DEFAULT_MODELS["google"]


# ---------------------------------------------------------------------------
# The reader itself, against shapes a provider or an SDK upgrade might hand it
# ---------------------------------------------------------------------------


class Result:
    def __init__(self, usage: object) -> None:
        self.usage = usage


class Event:
    def __init__(self, usage: object) -> None:
        self.result = Result(usage)


class Counts:
    def __init__(self, input_tokens: object, output_tokens: object) -> None:
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


def test_counts_are_read_from_the_attribute():
    usage = agent_module._usage_of(Event(Counts(800, 400)))
    assert usage is not None
    assert (usage.input_tokens, usage.output_tokens) == (800, 400)


def test_a_usage_exposed_as_a_method_still_works():
    """pydantic-ai exposed this as a method before 2.x. A turn is not the place
    to discover which one is installed."""
    counts = Counts(12, 3)
    usage = agent_module._usage_of(Event(lambda: counts))
    assert usage is not None
    assert usage.input_tokens == 12


def test_zero_is_a_count_and_not_an_absence():
    usage = agent_module._usage_of(Event(Counts(0, 0)))
    assert usage is not None
    assert usage.output_tokens == 0


@pytest.mark.parametrize(
    "counts",
    [
        Counts(None, 400),
        Counts(800, None),
        Counts("800", "400"),
        Counts(-1, 400),
        Counts(True, False),
    ],
)
def test_an_unreadable_count_is_reported_as_absent_not_as_zero(counts: Counts):
    """A zero would enter the reader's totals as a fact. Absence will not."""
    assert agent_module._usage_of(Event(counts)) is None


def test_no_usage_at_all_is_absence():
    assert agent_module._usage_of(Event(None)) is None
