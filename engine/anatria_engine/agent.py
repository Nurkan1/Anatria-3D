"""The anatomy agent: streams an explanation while driving the viewport.

The interleaving is the point. Scene commands are written to stdout by the tool
itself, the moment the model calls it — not collected and flushed at the end —
so the camera has already moved by the time the sentence about that structure
reaches the reader. Asking "how does the heart pump blood?" produces a guided
tour, not a wall of text followed by a jump.
"""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass

# `AgentRunResultEvent` is re-exported at the package root but actually lives in
# `pydantic_ai.run`; it is not a member of `pydantic_ai.messages`. Importing it
# from there resolves under a normal interpreter through a module `__getattr__`
# and then fails in the PyInstaller bundle, whose static analysis cannot follow
# that indirection. Import from where things really are.
from pydantic_ai import Agent, AgentRunResultEvent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    UserPromptPart,
)

from anatria_engine.case_tools import register_case_tools
from anatria_engine.prompts import build_instructions
from anatria_engine.protocol import (
    AgentRequest,
    AnatomicalSystem,
    TokenUsage,
    TranscriptTurn,
)
from anatria_engine.providers import build_model, resolve_model_name
from anatria_engine.scene_tools import SceneContext, register_scene_tools

#: Tool retries per turn. Two is enough for the model to recover from a wrong
#: organ_id; more just burns tokens re-reading the same inventory.
TOOL_RETRIES = 2


@dataclass
class TextChunk:
    text: str


@dataclass
class ToolStarted:
    tool: str


@dataclass
class Completed:
    usage: TokenUsage | None
    #: The model id the turn actually ran on, defaults resolved.
    model: str


AgentEvent = TextChunk | ToolStarted | Completed


def build_agent(request: AgentRequest, scene: SceneContext) -> Agent[SceneContext, str]:
    model = build_model(request.provider, request.api_key, request.model)
    agent: Agent[SceneContext, str] = Agent(
        model,
        deps_type=SceneContext,
        instructions=build_instructions(
            profile=request.profile,
            language=request.language,
            organs=list(scene.organs.values()),
            selection=request.selection,
            mode=request.mode,
            patient=request.case,
        ),
        retries=TOOL_RETRIES,
    )
    register_scene_tools(agent)
    # Registered per mode, not per turn: a tutoring turn cannot write a grade
    # into the journal because the tool that would do it does not exist there.
    if request.mode == "case":
        register_case_tools(agent)
    return agent


def build_scene_context(request: AgentRequest, emit, emit_verdict=None) -> SceneContext:
    systems: set[AnatomicalSystem] = {organ.system for organ in request.available_organs}
    return SceneContext(
        organs={organ.organ_id: organ for organ in request.available_organs},
        systems=systems,
        profile=request.profile,
        language=request.language,
        emit=emit,
        emit_verdict=emit_verdict if request.mode == "case" else None,
    )


def build_history(turns: list[TranscriptTurn]) -> list[ModelMessage]:
    """Replay prior turns as alternating request/response messages.

    Only the prose is carried over, not the tool calls from earlier turns. The
    viewport has moved on since then, and replaying stale scene commands as
    context would invite the model to reason about a scene that no longer
    matches what the user is looking at.
    """
    messages: list[ModelMessage] = []
    for turn in turns:
        if not turn.content.strip():
            continue
        if turn.role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=turn.content)]))
        else:
            messages.append(ModelResponse(parts=[TextPart(content=turn.content)]))
    return messages


async def run_agent(
    request: AgentRequest, scene: SceneContext
) -> AsyncIterator[AgentEvent]:
    """Stream one turn, yielding text as it arrives and tool starts as they fire."""
    agent = build_agent(request, scene)
    history = build_history(request.history)
    model_name = resolve_model_name(request.provider, request.model)

    async with agent.run_stream_events(
        request.query, deps=scene, message_history=history
    ) as events:
        async for event in events:
            # A text part can arrive whole or in deltas depending on provider;
            # both paths have to be handled or some models stream nothing.
            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                if event.part.content:
                    yield TextChunk(event.part.content)

            elif isinstance(event, PartDeltaEvent) and isinstance(
                event.delta, TextPartDelta
            ):
                if event.delta.content_delta:
                    yield TextChunk(event.delta.content_delta)

            elif isinstance(event, FunctionToolCallEvent):
                # Surfaced so the chat panel can show "focusing left ventricle…".
                # The scene command itself was already written to stdout by the
                # tool body; this is only for the progress indicator.
                yield ToolStarted(event.part.tool_name)

            elif isinstance(event, AgentRunResultEvent):
                yield Completed(_usage_of(event), model_name)


def _usage_of(event: AgentRunResultEvent) -> TokenUsage | None:
    """Token accounting; a missing count must not fail the turn.

    # Why there is no `except Exception` here any more

    There was, and it hid a bug for the whole life of the feature. `usage` on
    an `AgentRunResult` is an **attribute**, not a method; the code called it,
    every single turn raised `TypeError: 'RunUsage' object is not callable`,
    and the blanket catch reported that as "the provider did not tell us what
    this cost". A total failure wearing the costume of a legitimately empty
    result — and nothing upstream could tell the difference, because the two
    are the same value.

    So every branch below is explicit and none of them can raise. A shape this
    function genuinely does not recognise says so on stderr instead of
    returning `None` with a shrug, because that is the difference between a
    provider that reports nothing and a library that moved its API again.
    """
    usage = getattr(event.result, "usage", None)
    # Tolerated because pydantic-ai exposed this as a method before 2.x, and a
    # turn is not the place to find out which one is installed.
    if callable(usage):
        usage = usage()
    if usage is None:
        return None

    input_tokens = _count(getattr(usage, "input_tokens", None))
    output_tokens = _count(getattr(usage, "output_tokens", None))
    if input_tokens is None or output_tokens is None:
        print(
            f"[engine] {type(usage).__name__} carries no readable token counts; "
            "this turn will be reported as uncosted",
            file=sys.stderr,
            flush=True,
        )
        return None

    return TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens)


def _count(value: object) -> int | None:
    """A non-negative token count, or `None` for anything that is not one."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if value >= 0 else None
