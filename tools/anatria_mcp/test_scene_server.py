"""End-to-end tests for the control half of the MCP server.

Spawned as a client spawns it, and pointed at a real named pipe with a fake
application behind it. So a single test covers the whole chain: an MCP tool
call, the schema the SDK built from the signature, the protocol model, the
identifier check against the manifest and the bytes on the wire. Every one of
those is a place this could break, and none is visible from an in-process
call.

The application's own end of the pipe is Rust and is tested there. What stands
in for it here only has to hold a pipe open and record what arrived.

Run them with this directory's own virtualenv, not the repository one:

    tools/anatria_mcp/.venv/Scripts/python.exe -m pytest tools/anatria_mcp -q
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

HERE = Path(__file__).resolve().parent
SERVER = HERE / "atlas.py"

#: A structure that is certainly in the male manifest.
#:
#: Read out of the atlas rather than guessed. The first identifier written here
#: was `heart_l`, which sounds right and does not exist — the manifest names the
#: heart's parts, not a mesh called "heart". A test built on an invented id
#: passes for the wrong reason: the command is refused by the check under test,
#: and the refusal looks like the assertion succeeding.
REAL_ID = "corpus_callosum"
#: A second one, for routes, which need at least two distinct stops.
OTHER_ID = "coronary_sinus"

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(
        sys.platform != "win32", reason="the control bridge is a Windows transport"
    ),
]


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def app():
    """A fake Anatria3D: a real pipe that records what arrives."""
    from pipe_server import FakePipeServer

    with FakePipeServer() as server:
        yield server


@pytest.fixture
async def driving(app):
    """A session against a server configured to drive `app`."""
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(SERVER)],
        env=os.environ
        | {
            "ANATRIA3D_BRIDGE": "1",
            # The one thing a reader never sets. Here it points the server at a
            # fake application instead of the real one this account would have.
            "ANATRIA3D_BRIDGE_PIPE": app.full_name,
        },
    )
    async with (
        stdio_client(params) as (read, write),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        yield session


async def drive(session: ClientSession, name: str, **arguments):
    result = await session.call_tool(name, arguments)
    assert not result.is_error, result.content
    return result


async def refuse(session: ClientSession, name: str, **arguments) -> str:
    result = await session.call_tool(name, arguments)
    assert result.is_error, f"{name} was accepted: {result.content}"
    return " ".join(str(block.text) for block in result.content if hasattr(block, "text"))


def commands(app) -> list[dict]:
    """Every scene command the fake application received."""
    return [
        json.loads(line)["command"]
        for line in app.lines()
        if json.loads(line).get("type") == "scene_command"
    ]


class TestSurface:
    async def test_asking_for_the_bridge_adds_the_fifteen(self, driving):
        names = {tool.name for tool in (await driving.list_tools()).tools}
        assert names >= {
            "focus_organ",
            "illuminate_structures",
            "isolate_structures",
            "isolate_region",
            "isolate_group",
            "show_all_structures",
            "add_supply",
            "set_layer_visibility",
            "set_layer_opacity",
            "xray_system",
            "apply_pathology_overlay",
            "clear_pathology_overlays",
            "highlight_pathway",
            "clear_pathway",
            "set_cross_section",
        }

    async def test_it_is_the_same_surface_the_assistant_has(self, driving):
        # Parity is the requirement, not a round number. The read tools stay,
        # and the fifteen are added to them.
        names = {tool.name for tool in (await driving.list_tools()).tools}
        assert len(names) == 20

    async def test_the_control_tools_do_not_claim_to_be_read_only(self, driving):
        # A client that trusts the annotation would otherwise call these
        # speculatively, and each one changes what a person is looking at.
        tools = {tool.name: tool for tool in (await driving.list_tools()).tools}
        for name in ("focus_organ", "isolate_structures", "set_cross_section"):
            assert tools[name].annotations.read_only_hint is False, name

    async def test_the_instructions_say_the_session_can_move_the_viewport(self, app):
        # The model reads these before it reads any tool, so a stale read-only
        # sentence here would tell it the opposite of the truth. Its own
        # session, because the instructions arrive from `initialize` and the
        # shared fixture has already consumed that.
        params = StdioServerParameters(
            command=sys.executable,
            args=[str(SERVER)],
            env=os.environ
            | {
                "ANATRIA3D_BRIDGE": "1",
                "ANATRIA3D_BRIDGE_PIPE": app.full_name,
            },
        )
        async with (
            stdio_client(params) as (read, write),
            ClientSession(read, write) as session,
        ):
            said = (await session.initialize()).instructions or ""

        assert "reads only" not in said
        assert "connected to a running Anatria3D" in said


class TestItReachesTheApplication:
    async def test_a_command_arrives_whole_and_alone(self, driving, app):
        await drive(driving, "focus_organ", organ_id=REAL_ID)

        (line,) = app.wait_for_lines(1)
        sent = json.loads(line)
        assert sent["type"] == "scene_command"
        assert sent["command"] == {"action": "focus_organ", "organ_id": REAL_ID}

    async def test_nothing_travels_but_the_commands(self, driving, app):
        await drive(driving, "focus_organ", organ_id=REAL_ID)
        await drive(driving, "clear_pathway")
        await drive(driving, "show_all_structures")

        lines = app.wait_for_lines(3)
        assert [json.loads(line)["type"] for line in lines] == ["scene_command"] * 3

    async def test_an_xray_expands_to_one_command_per_system(self, driving, app):
        await drive(driving, "xray_system", system="nervous")

        # The count comes from the same manifests the server validates
        # against, so this waits for exactly what should arrive rather than
        # reading whatever happened to have been processed by now.
        from atlas import available_atlases

        systems = {
            structure.system
            for loaded in available_atlases()
            for structure in loaded.structures
        }
        app.wait_for_lines(len(systems))  # one per system, and nothing else
        sent = commands(app)
        assert all(command["action"] == "set_layer_opacity" for command in sent)
        # The chosen system is set solid explicitly, because it may already be
        # ghosted from an earlier x-ray.
        assert sent[0] == {
            "action": "set_layer_opacity",
            "system": "nervous",
            "opacity": 1.0,
        }
        assert len(sent) > 1, "nothing was faded back"
        assert {command["opacity"] for command in sent[1:]} == {0.16}


class TestItChecksBeforeItSends:
    async def test_an_invented_identifier_never_reaches_the_application(
        self, driving, app
    ):
        # The case this validation exists for: the bridge cannot report that an
        # action was refused, so a bad id reaches the viewport and empties it
        # with no error at all.
        message = await refuse(driving, "focus_organ", organ_id="spleen_of_omelas")

        assert "spleen_of_omelas" in message
        assert commands(app) == []

    async def test_a_near_miss_is_answered_with_real_identifiers(self, driving):
        # Told only "no such structure" a model guesses again; handed real ids
        # it picks the right one on the next call.
        message = await refuse(driving, "focus_organ", organ_id="heart_")
        assert "Did you mean" in message

    async def test_a_route_longer_than_the_protocol_allows_is_refused(
        self, driving, app
    ):
        message = await refuse(
            driving,
            "highlight_pathway",
            label="Too far",
            organ_ids=[REAL_ID, OTHER_ID] * 20,
            step_seconds=1.0,
            loop=False,
        )
        assert "organ_ids" in message
        assert commands(app) == []

    async def test_a_route_that_stops_twice_in_one_place_is_refused(self, driving, app):
        # A repeated stop is a zero-length segment, which leaves the viewer's
        # curve with an undefined tangent and corrupts the whole route.
        message = await refuse(
            driving,
            "highlight_pathway",
            label="Standing still",
            organ_ids=[REAL_ID, REAL_ID],
            step_seconds=1.0,
            loop=False,
        )
        assert "twice in a row" in message
        assert commands(app) == []

    async def test_an_opacity_outside_the_protocol_is_refused(self, driving, app):
        message = await refuse(
            driving, "set_layer_opacity", system="skeletal", opacity=4.0
        )
        assert "opacity" in message
        assert commands(app) == []

    async def test_a_system_no_atlas_has_is_named_as_such(self, driving, app):
        # `AnatomicalSystem` is a closed set, so an unknown name is refused by
        # the schema before this can even be asked — which is the point: the
        # tool cannot be called with a system that does not exist.
        message = await refuse(driving, "set_layer_visibility", system="nonsense", visible=False)
        assert message
        assert commands(app) == []

    async def test_a_pathology_with_no_name_is_refused(self, driving, app):
        message = await refuse(
            driving,
            "apply_pathology_overlay",
            organ_id=REAL_ID,
            pathology="   ",
            severity=0.5,
        )
        assert "pathology" in message
        assert commands(app) == []


class TestWhenTheApplicationIsNotThere:
    async def test_a_dead_pipe_is_reported_rather_than_swallowed(self):
        """A tool that silently does nothing is the worst answer here.

        The reader is looking at a viewport that did not move, and the model
        has been told the command succeeded.
        """
        params = StdioServerParameters(
            command=sys.executable,
            args=[str(SERVER)],
            env=os.environ
            | {
                "ANATRIA3D_BRIDGE": "1",
                "ANATRIA3D_BRIDGE_PIPE": "anatria3d-control-nothing-is-here",
            },
        )
        async with (
            stdio_client(params) as (read, write),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
            message = await refuse(session, "focus_organ", organ_id=REAL_ID)

        assert "Anatria3D" in message
