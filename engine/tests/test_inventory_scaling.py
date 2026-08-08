"""The prompt must not carry the whole atlas.

Listing every structure is roughly 53,000 tokens on *every* turn once the full
body is loaded — unaffordable per question, and past the context window of the
cheaper models the app offers. Above a threshold the prompt switches to a
per-system summary and the agent reaches the rest through `find_structures`.
"""

from __future__ import annotations

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from anatria_engine.prompts import INLINE_INVENTORY_LIMIT, build_instructions
from anatria_engine.protocol import OrganMeta
from anatria_engine.scene_tools import MAX_SEARCH_RESULTS, SceneContext, register_scene_tools


def organs(count: int, system: str = "cardiovascular") -> list[OrganMeta]:
    return [
        OrganMeta(
            organ_id=f"structure_{index}",
            ta2_latin=f"Structura {index}",
            name_en=f"Structure {index}",
            system=system,  # type: ignore[arg-type]
        )
        for index in range(count)
    ]


def test_small_scene_is_listed_in_full() -> None:
    text = build_instructions(
        profile="student", language="en", organs=organs(10), selection=[], mode="tutor"
    )
    assert "structure_0" in text
    assert "Structura 9" in text


def test_large_scene_summarises_instead_of_listing() -> None:
    many = organs(INLINE_INVENTORY_LIMIT + 1)
    text = build_instructions(
        profile="student", language="en", organs=many, selection=[], mode="tutor"
    )

    assert "structure_0" not in text
    assert f"{len(many)} structures are loaded" in text
    assert "find_structures" in text
    # Left to guess an id, a model will invent one and burn a retry.
    assert "Never guess an organ_id" in text


def test_summary_counts_each_system() -> None:
    mixed = organs(200) + organs(50, system="nervous")
    text = build_instructions(
        profile="clinician", language="bg", organs=mixed, selection=[], mode="tutor"
    )
    assert "cardiovascular: 200" in text
    assert "nervous: 50" in text


def test_full_atlas_prompt_stays_affordable() -> None:
    # ~2,400 structures is the real full-body figure. A rough 4-chars-per-token
    # estimate keeps this honest without pulling in a tokeniser.
    text = build_instructions(
        profile="student", language="en", organs=organs(2400), selection=[], mode="tutor"
    )
    assert len(text) / 4 < 4000


# ---------------------------------------------------------------------------
# find_structures
# ---------------------------------------------------------------------------


def scene(count: int) -> SceneContext:
    catalogue = organs(count)
    return SceneContext(
        organs={organ.organ_id: organ for organ in catalogue},
        systems={"cardiovascular"},
        profile="student",
        language="en",
        emit=lambda _command: None,
    )


def scripted(*calls: ToolCallPart) -> FunctionModel:
    remaining = list(calls)

    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if remaining:
            return ModelResponse(parts=[remaining.pop(0)])
        return ModelResponse(parts=[TextPart("Done.")])

    return FunctionModel(respond)


async def run_search(context: SceneContext, query: str) -> str:
    agent: Agent[SceneContext, str] = Agent(
        scripted(ToolCallPart("find_structures", {"query": query})),
        deps_type=SceneContext,
        retries=1,
    )
    register_scene_tools(agent)
    result = await agent.run("find it", deps=context)
    # A rejected argument comes back as a retry prompt rather than a tool
    # return, so both have to be collected or the guard-rail cases look empty.
    return " ".join(
        str(part.content)
        for message in result.all_messages()
        for part in message.parts
        if getattr(part, "part_kind", "") in {"tool-return", "retry-prompt"}
    )


async def test_search_finds_a_structure_by_name() -> None:
    assert "structure_7" in await run_search(scene(50), "Structure 7")


async def test_search_caps_its_results() -> None:
    # An over-broad query must not dump the atlas back into the context window
    # that the summary exists to protect.
    output = await run_search(scene(500), "structura")
    assert output.count("Structura") <= MAX_SEARCH_RESULTS
    assert "narrow the query" in output


async def test_search_explains_an_empty_result() -> None:
    output = await run_search(scene(20), "pancreas")
    # The likeliest cause is a system that is switched off, and the model can
    # act on that — so say it rather than just "no matches".
    assert "switched off" in output


@pytest.mark.parametrize("query", ["", "x"])
async def test_search_rejects_a_query_too_short_to_mean_anything(query: str) -> None:
    output = await run_search(scene(20), query)
    assert "two characters" in output
