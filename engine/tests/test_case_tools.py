"""Grading a case drill.

The property worth protecting: a score that reaches the study journal was
produced by a drill and passed the tool's own checks. Everything the journal
averages, charts and shows back to the student comes through here, so a grade
that is out of scale, unexplained, or emitted from an ordinary tutoring turn
must be turned back at this boundary rather than stored.

Run against a scripted model — no API key, no network.
"""

from __future__ import annotations

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from anatria_engine.case_tools import MIN_VERDICT_CHARS, register_case_tools
from anatria_engine.protocol import OrganMeta
from anatria_engine.scene_tools import SceneContext, register_scene_tools

ORGANS = [
    OrganMeta(
        organ_id="left_ventricle",
        ta2_latin="Ventriculus sinister",
        name_en="Left ventricle",
        system="cardiovascular",
    )
]

GOOD_VERDICT = (
    "Correctly identified the anterior wall and the LAD territory, but did not "
    "mention time-to-reperfusion, which is what changes the outcome here."
)


def make_scene(*, grading: bool = True) -> tuple[SceneContext, list[tuple[int, str]]]:
    verdicts: list[tuple[int, str]] = []
    scene = SceneContext(
        organs={organ.organ_id: organ for organ in ORGANS},
        systems={"cardiovascular"},
        profile="student",
        language="en",
        emit=lambda _command: None,
        emit_verdict=(lambda score, text: verdicts.append((score, text)))
        if grading
        else None,
    )
    return scene, verdicts


def scripted(*turns: list[ToolCallPart]) -> FunctionModel:
    remaining = list(turns)

    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if remaining:
            return ModelResponse(parts=list(remaining.pop(0)))
        return ModelResponse(parts=[TextPart("Done.")])

    return FunctionModel(respond)


async def run(scene: SceneContext, model: FunctionModel) -> str:
    agent: Agent[SceneContext, str] = Agent(model, deps_type=SceneContext, retries=1)
    register_scene_tools(agent)
    register_case_tools(agent)
    result = await agent.run("The patient is in pain.", deps=scene)
    return " ".join(
        str(part.content)
        for message in result.all_messages()
        for part in message.parts
        if getattr(part, "part_kind", "") in {"tool-return", "retry-prompt"}
    )


async def test_a_grade_reaches_the_journal() -> None:
    scene, verdicts = make_scene()
    await run(
        scene,
        scripted(
            [
                ToolCallPart(
                    "record_case_verdict", {"score": 68, "verdict": GOOD_VERDICT}
                )
            ]
        ),
    )
    assert verdicts == [(68, GOOD_VERDICT)]


@pytest.mark.parametrize("score", [-1, 101, 1000])
async def test_a_score_off_the_scale_is_refused(score: int) -> None:
    # The journal averages these. One 1000 would poison every figure it shows.
    scene, verdicts = make_scene()
    output = await run(
        scene,
        scripted(
            [
                ToolCallPart(
                    "record_case_verdict", {"score": score, "verdict": GOOD_VERDICT}
                )
            ]
        ),
    )
    assert verdicts == []
    assert "between 0 and 100" in output


async def test_an_unexplained_grade_is_refused() -> None:
    # A student revisiting this drill weeks later needs to see *why*. "Good
    # answer." does not survive that gap, so it never becomes a stored verdict.
    scene, verdicts = make_scene()
    output = await run(
        scene,
        scripted([ToolCallPart("record_case_verdict", {"score": 90, "verdict": "Good."})]),
    )
    assert verdicts == []
    assert "too short to be useful" in output


async def test_the_minimum_length_is_measured_after_collapsing_whitespace() -> None:
    # Otherwise a padded newline run passes a check about substance.
    scene, verdicts = make_scene()
    padded = "Good." + " " * (MIN_VERDICT_CHARS * 2)
    await run(
        scene,
        scripted([ToolCallPart("record_case_verdict", {"score": 90, "verdict": padded})]),
    )
    assert verdicts == []


async def test_a_tutoring_turn_cannot_write_a_grade() -> None:
    """The tool is registered per mode; the context refuses it a second time.

    Registration is the real gate — `register_case_tools` is simply not called
    for a lesson. This covers the case where that changes and the guard is all
    that is left.
    """
    scene, verdicts = make_scene(grading=False)
    output = await run(
        scene,
        scripted(
            [
                ToolCallPart(
                    "record_case_verdict", {"score": 80, "verdict": GOOD_VERDICT}
                )
            ]
        ),
    )
    assert verdicts == []
    assert "only be recorded during a case drill" in output


async def test_the_drill_keeps_the_scene_tools() -> None:
    # A case that cannot mark the anatomy it is asking about is just a quiz.
    scene, _verdicts = make_scene()
    await run(
        scene,
        scripted(
            [
                ToolCallPart(
                    "apply_pathology_overlay",
                    {
                        "organ_id": "left_ventricle",
                        "pathology": "Anterior infarction",
                        "severity": 0.8,
                    },
                )
            ]
        ),
    )
    assert [command.action for command in scene.emitted] == ["apply_pathology_overlay"]
