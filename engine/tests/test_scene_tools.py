"""The guarantee these tests exist for: the assistant cannot invent anatomy.

Every scene tool validates against the structures actually loaded, so a
hallucinated identifier is turned back at the tool boundary and never becomes a
command the viewport acts on. These run against a scripted model — no API key,
no network.
"""

from __future__ import annotations

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from anatria_engine.protocol import (
    ApplyPathologyOverlay,
    ClearPathway,
    FocusOrgan,
    HighlightPathway,
    IlluminateStructures,
    IsolateStructures,
    OrganMeta,
    SetCrossSection,
    SetLayerOpacity,
    SetLayerVisibility,
)
from anatria_engine.scene_tools import (
    DEFAULT_STEP_SECONDS,
    MAX_ILLUMINATED,
    SceneContext,
    register_scene_tools,
)

ORGANS = [
    OrganMeta(
        organ_id="left_ventricle",
        ta2_latin="Ventriculus sinister",
        name_en="Left ventricle",
        system="cardiovascular",
    ),
    OrganMeta(
        organ_id="right_atrium",
        ta2_latin="Atrium dextrum",
        name_en="Right atrium",
        system="cardiovascular",
    ),
    OrganMeta(
        organ_id="left_atrium",
        ta2_latin="Atrium sinistrum",
        name_en="Left atrium",
        system="cardiovascular",
    ),
]


def make_scene() -> SceneContext:
    emitted: list = []
    scene = SceneContext(
        organs={organ.organ_id: organ for organ in ORGANS},
        systems={"cardiovascular"},
        profile="student",
        language="en",
        emit=emitted.append,
    )
    return scene


def scripted(*turns: list[ToolCallPart]) -> FunctionModel:
    """A model that plays a fixed sequence of tool calls, then answers."""
    remaining = list(turns)

    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if remaining:
            return ModelResponse(parts=list(remaining.pop(0)))
        return ModelResponse(parts=[TextPart("Done.")])

    return FunctionModel(respond)


def build(scene: SceneContext, model: FunctionModel) -> Agent[SceneContext, str]:
    agent: Agent[SceneContext, str] = Agent(model, deps_type=SceneContext, retries=1)
    register_scene_tools(agent)
    return agent


def retries(result) -> str:
    """Everything the tools handed back as a retry prompt, joined."""
    return " ".join(
        str(part.content)
        for message in result.all_messages()
        for part in message.parts
        if getattr(part, "part_kind", "") == "retry-prompt"
    )


async def test_ghosting_a_layer_keeps_it_on_screen() -> None:
    # The distinction the tool exists for: translucent is not hidden.
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "set_layer_opacity",
                    {"system": "cardiovascular", "opacity": 0.25},
                )
            ]
        ),
    )
    await agent.run("Show me what is under it.", deps=scene)

    assert scene.emitted == [SetLayerOpacity(system="cardiovascular", opacity=0.25)]


async def test_an_opacity_of_zero_is_refused_as_a_way_of_hiding() -> None:
    # Invisible but still present is a state the reader cannot interpret, and
    # there is already a tool that means "remove this layer".
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [ToolCallPart("set_layer_opacity", {"system": "cardiovascular", "opacity": 0.0})]
        ),
    )
    result = await agent.run("Hide it.", deps=scene)

    assert scene.emitted == []
    assert "set_layer_visibility" in retries(result)


async def test_ghosting_a_system_that_is_not_loaded_is_refused() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted([ToolCallPart("set_layer_opacity", {"system": "renal", "opacity": 0.3})]),
    )
    await agent.run("Fade the kidneys.", deps=scene)

    assert scene.emitted == []


async def test_xray_fades_the_others_and_leaves_the_subject_solid() -> None:
    scene = make_scene()
    scene.systems = {"cardiovascular", "muscular", "nervous"}
    agent = build(scene, scripted([ToolCallPart("xray_system", {"system": "nervous"})]))

    await agent.run("Trace the nerves.", deps=scene)

    # One call, not one per system: following a system through the body is a
    # single intention and should cost a single tool call.
    assert scene.emitted[0] == SetLayerOpacity(system="nervous", opacity=1.0)
    faded = {command.system for command in scene.emitted[1:]}
    assert faded == {"cardiovascular", "muscular"}
    assert all(command.opacity < 0.5 for command in scene.emitted[1:])


async def test_focus_emits_command_for_a_loaded_structure() -> None:
    scene = make_scene()
    agent = build(
        scene, scripted([ToolCallPart("focus_organ", {"organ_id": "left_ventricle"})])
    )

    await agent.run("Show the left ventricle.", deps=scene)

    assert scene.emitted == [FocusOrgan(organ_id="left_ventricle")]


async def test_hallucinated_organ_never_reaches_the_viewport() -> None:
    """The core safety property of the whole design."""
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [ToolCallPart("focus_organ", {"organ_id": "spleen_of_omelas"})],
            [ToolCallPart("focus_organ", {"organ_id": "left_ventricle"})],
        ),
    )

    await agent.run("Show me the spleen.", deps=scene)

    # The bogus call was rejected and retried; only the valid one got through.
    assert scene.emitted == [FocusOrgan(organ_id="left_ventricle")]


async def test_rejection_names_close_matches() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [ToolCallPart("focus_organ", {"organ_id": "left_ventrical"})],  # typo
            [ToolCallPart("focus_organ", {"organ_id": "left_ventricle"})],
        ),
    )

    result = await agent.run("Left ventricle please.", deps=scene)

    retry_text = " ".join(
        part.content
        for message in result.all_messages()
        for part in message.parts
        if getattr(part, "part_kind", "") == "retry-prompt"
    )
    # A bare "not found" would leave the model guessing again.
    assert "left_ventricle" in retry_text


#: How many times the ordering test replays its walkthrough.
#:
#: One run is not a test of this property. The three calls arrive in a single
#: model response, so pydantic-ai dispatches them concurrently and the sync
#: tools land in a thread pool; a single pass agrees with the intended order by
#: luck often enough to look green while the behaviour is broken. Measured with
#: `sequential=True` removed, the intended order came up 21% of the time — which
#: this many replays turns into a certainty rather than a coin toss.
ORDER_REPLAYS = 25


async def test_sequential_focus_preserves_order() -> None:
    """A walkthrough is a sequence of focuses, and the order is the teaching.

    Guards `sequential=True` on the scene tools. Without it the camera visits
    the chambers in a shuffled order — every command individually valid, the
    lesson silently wrong.
    """
    walkthrough = ["right_atrium", "left_atrium", "left_ventricle"]
    expected = [FocusOrgan(organ_id=organ_id) for organ_id in walkthrough]

    for replay in range(ORDER_REPLAYS):
        scene = make_scene()
        agent = build(
            scene,
            scripted(
                [ToolCallPart("focus_organ", {"organ_id": organ_id}) for organ_id in walkthrough]
            ),
        )

        await agent.run("How does blood move through the heart?", deps=scene)

        assert scene.emitted == expected, f"order broke on replay {replay}"


async def test_isolation_validates_every_id() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "isolate_structures",
                    {"organ_ids": ["left_ventricle", "not_an_organ"]},
                )
            ],
            [ToolCallPart("isolate_structures", {"organ_ids": ["left_ventricle"]})],
        ),
    )

    await agent.run("Isolate those.", deps=scene)

    # One bad id in the list rejects the whole call — a partially-applied
    # isolation would silently hide structures the model meant to show.
    assert scene.emitted == [IsolateStructures(organ_ids=["left_ventricle"])]


async def test_unloaded_system_is_refused() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [ToolCallPart("set_layer_visibility", {"system": "renal", "visible": True})],
            [
                ToolCallPart(
                    "set_layer_visibility",
                    {"system": "cardiovascular", "visible": False},
                )
            ],
        ),
    )

    await agent.run("Show the kidneys.", deps=scene)

    assert scene.emitted == [
        SetLayerVisibility(system="cardiovascular", visible=False)
    ]


@pytest.mark.parametrize("severity", [-0.1, 1.5])
async def test_out_of_range_severity_is_refused(severity: float) -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "apply_pathology_overlay",
                    {
                        "organ_id": "left_ventricle",
                        "pathology": "Hypertrophy",
                        "severity": severity,
                    },
                )
            ],
            [
                ToolCallPart(
                    "apply_pathology_overlay",
                    {
                        "organ_id": "left_ventricle",
                        "pathology": "Hypertrophy",
                        "severity": 0.8,
                    },
                )
            ],
        ),
    )

    await agent.run("Show hypertrophy.", deps=scene)

    assert scene.emitted == [
        ApplyPathologyOverlay(
            organ_id="left_ventricle", pathology="Hypertrophy", severity=0.8
        )
    ]


async def test_cross_section_position_is_bounded() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [ToolCallPart("set_cross_section", {"plane": "axial", "position": 4.0})],
            [ToolCallPart("set_cross_section", {"plane": "axial", "position": 0.0})],
        ),
    )

    await agent.run("Cut it open.", deps=scene)

    assert scene.emitted == [SetCrossSection(plane="axial", position=0.0)]


async def test_pathway_emits_the_route_in_the_order_given() -> None:
    """The order *is* the lesson, so it must survive the tool unchanged."""
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "highlight_pathway",
                    {
                        "label": "Blood through the heart",
                        "organ_ids": ["right_atrium", "left_atrium", "left_ventricle"],
                        "step_seconds": 1.5,
                        "loop": True,
                    },
                )
            ]
        ),
    )

    await agent.run("Trace the blood.", deps=scene)

    assert scene.emitted == [
        HighlightPathway(
            label="Blood through the heart",
            organ_ids=["right_atrium", "left_atrium", "left_ventricle"],
            step_seconds=1.5,
            loop=True,
        )
    ]


async def test_pathway_with_one_bad_id_is_rejected_whole() -> None:
    # A partially-applied route would draw a journey that skips a step, which
    # teaches the wrong anatomy rather than merely looking wrong.
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "highlight_pathway",
                    {
                        "label": "Nonsense",
                        "organ_ids": ["right_atrium", "spleen_of_omelas"],
                    },
                )
            ],
            [
                ToolCallPart(
                    "highlight_pathway",
                    {
                        "label": "Blood through the heart",
                        "organ_ids": ["right_atrium", "left_ventricle"],
                    },
                )
            ],
        ),
    )

    await agent.run("Trace it.", deps=scene)

    assert len(scene.emitted) == 1
    assert scene.emitted[0].organ_ids == ["right_atrium", "left_ventricle"]


async def test_single_structure_pathway_is_refused_and_points_at_focus() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "highlight_pathway",
                    {"label": "Just the one", "organ_ids": ["left_ventricle"]},
                )
            ]
        ),
    )
    result = await agent.run("Trace the ventricle.", deps=scene)

    assert scene.emitted == []
    # A bare refusal would leave the model retrying the same shape of call.
    assert "focus_organ" in retries(result)


async def test_repeated_consecutive_stop_is_refused() -> None:
    # Two identical points in a row give the viewer's curve a zero-length
    # segment and an undefined tangent, which corrupts the whole route.
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "highlight_pathway",
                    {
                        "label": "Stuck",
                        "organ_ids": ["right_atrium", "right_atrium", "left_atrium"],
                    },
                )
            ]
        ),
    )
    await agent.run("Trace it.", deps=scene)

    assert scene.emitted == []


@pytest.mark.parametrize("step_seconds", [0.0, 45.0])
async def test_out_of_range_step_seconds_is_refused(step_seconds: float) -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "highlight_pathway",
                    {
                        "label": "Too fast or too slow",
                        "organ_ids": ["right_atrium", "left_ventricle"],
                        "step_seconds": step_seconds,
                    },
                )
            ]
        ),
    )
    await agent.run("Trace it.", deps=scene)

    assert scene.emitted == []


async def test_pathway_defaults_are_supplied_when_the_model_omits_them() -> None:
    # `step_seconds` and `loop` are required on the wire, so a model that gives
    # only the route must still produce a valid command.
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "highlight_pathway",
                    {
                        "label": "Blood through the heart",
                        "organ_ids": ["right_atrium", "left_ventricle"],
                    },
                )
            ]
        ),
    )
    await agent.run("Trace it.", deps=scene)

    assert len(scene.emitted) == 1
    assert scene.emitted[0].step_seconds == DEFAULT_STEP_SECONDS
    assert scene.emitted[0].loop is True


async def test_clearing_the_pathway_emits_the_command() -> None:
    scene = make_scene()
    agent = build(scene, scripted([ToolCallPart("clear_pathway", {})]))

    await agent.run("Stop tracing.", deps=scene)

    assert scene.emitted == [ClearPathway()]


async def test_pathology_label_is_truncated_not_rejected() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "apply_pathology_overlay",
                    {
                        "organ_id": "left_ventricle",
                        "pathology": "H" * 400,
                        "severity": 0.5,
                    },
                )
            ]
        ),
    )

    await agent.run("Overlay it.", deps=scene)

    # The protocol caps the label at 120 chars. Truncating keeps a verbose model
    # from failing a turn over a cosmetic field.
    assert len(scene.emitted) == 1
    assert len(scene.emitted[0].pathology) == 120


async def test_illumination_emits_the_structures_being_named() -> None:
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "illuminate_structures",
                    {"organ_ids": ["left_ventricle", "left_atrium"]},
                )
            ]
        ),
    )

    await agent.run("Point at the left side.", deps=scene)

    assert scene.emitted == [
        IlluminateStructures(organ_ids=["left_ventricle", "left_atrium"])
    ]


async def test_an_empty_illumination_turns_the_light_off() -> None:
    # No second command for it: the light is always exactly the last list
    # given, so an empty list is the whole of "stop pointing".
    scene = make_scene()
    agent = build(
        scene, scripted([ToolCallPart("illuminate_structures", {"organ_ids": []})])
    )

    await agent.run("That is all.", deps=scene)

    assert scene.emitted == [IlluminateStructures(organ_ids=[])]


async def test_illuminating_a_structure_that_is_not_loaded_is_refused() -> None:
    # The same guard as every other tool: a hallucinated id must never reach
    # the viewport, whatever the tool is.
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "illuminate_structures",
                    {"organ_ids": ["left_ventricle", "spleen_of_omelas"]},
                )
            ]
        ),
    )

    result = await agent.run("Light these.", deps=scene)

    assert scene.emitted == []
    assert "spleen_of_omelas" in retries(result)


async def test_lighting_the_whole_body_is_refused() -> None:
    # Past a couple of dozen a lit set is a lit body, and the reader learns
    # nothing from being told that everything is important.
    scene = make_scene()
    agent = build(
        scene,
        scripted(
            [
                ToolCallPart(
                    "illuminate_structures",
                    {"organ_ids": ["left_ventricle"] * (MAX_ILLUMINATED + 1)},
                )
            ]
        ),
    )

    result = await agent.run("Light everything.", deps=scene)

    assert scene.emitted == []
    assert str(MAX_ILLUMINATED) in retries(result)
