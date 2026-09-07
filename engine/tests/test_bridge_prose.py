"""The wire accepts bounded external prose, not an assistant tool."""

import pytest
from pydantic import TypeAdapter, ValidationError
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel

from anatria_engine.protocol import Say, SceneCommand


@pytest.mark.parametrize("character", ["x", "🫀"])
def test_say_preserves_4000_unicode_characters_and_refuses_4001(character):
    wire = TypeAdapter(SceneCommand)
    text = character * 4000
    assert wire.validate_python({"action": "say", "text": text}) == Say(text=text)
    with pytest.raises(ValidationError, match="at most 4000 characters"):
        wire.validate_python({"action": "say", "text": text + character})


@pytest.mark.asyncio
async def test_say_is_not_an_internal_assistant_tool():
    from anatria_engine.scene_tools import SceneContext, register_scene_tools

    names = set()

    def respond(messages, info):
        names.update(tool.name for tool in info.function_tools)
        return ModelResponse(parts=[TextPart("Local answer")])

    emitted = []
    scene = SceneContext(
        organs={}, systems=set(), profile="student", language="en", emit=emitted.append,
    )
    agent = Agent(FunctionModel(respond), deps_type=SceneContext)
    register_scene_tools(agent)
    await agent.run("List the tools", deps=scene)
    assert "focus_organ" in names
    assert "say" not in names
