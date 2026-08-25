"""End-to-end tests for the atlas MCP server.

These spawn the server the way a client does — a subprocess over stdio — rather
than calling the functions directly. Everything that breaks in practice breaks
in the wiring: a tool that raises on import, a schema Pydantic cannot build, a
stray `print` corrupting the stream. None of that is visible from in-process
calls.

Run them with this directory's own virtualenv, not the repository one:

    tools/anatria_mcp/.venv/Scripts/python.exe -m pytest tools/anatria_mcp -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

HERE = Path(__file__).resolve().parent
SERVER = HERE / "atlas.py"

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    """A live session against the server, spawned exactly as a client spawns it."""
    params = StdioServerParameters(command=sys.executable, args=[str(SERVER)])
    async with (
        stdio_client(params) as (read, write),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        yield session


async def call(session: ClientSession, name: str, **arguments):
    result = await session.call_tool(name, arguments)
    assert not result.is_error, result.content
    return result.structured_content


class TestSurface:
    async def test_exposes_the_five_read_tools_and_nothing_else(self, client):
        # The control surface is a separate server with a separate security
        # model. If a tool that writes ever appears here, that decision was
        # made by accident.
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert names == {
            "search_structures",
            "describe_structure",
            "list_systems",
            "browse_hierarchy",
            "atlas_info",
        }

    async def test_every_tool_declares_itself_read_only(self, client):
        for tool in (await client.list_tools()).tools:
            assert tool.annotations is not None, tool.name
            assert tool.annotations.read_only_hint is True, tool.name


class TestSearch:
    async def test_finds_a_structure_by_english_name(self, client):
        out = await call(client, "search_structures", query="atrium")
        assert out["total"] >= 1
        assert any("atrium" in item["name_en"].lower() for item in out["shown"])

    async def test_finds_a_structure_by_latin_term(self, client):
        out = await call(client, "search_structures", query="Atrium")
        assert out["shown"], "the TA2 Latin term must be searchable"

    async def test_reports_truncation_rather_than_silently_dropping(self, client):
        out = await call(client, "search_structures", query="muscle", limit=3)
        assert len(out["shown"]) <= 3
        if out["total"] > 3:
            assert out["truncated"] is True

    async def test_refuses_a_one_character_query(self, client):
        result = await client.call_tool("search_structures", {"query": "a"})
        assert result.is_error


class TestDescribe:
    async def test_returns_the_hierarchy_trail(self, client):
        found = await call(client, "search_structures", query="atrium", limit=1)
        organ_id = found["shown"][0]["organ_id"]

        out = await call(client, "describe_structure", organ_id=organ_id)
        assert out["organ_id"] == organ_id
        assert out["ta2_latin"]
        assert isinstance(out["hierarchy"], list)

    async def test_a_typo_is_answered_with_the_real_id(self, client):
        # A model told only "no such structure" guesses again. One handed the
        # near-misses calls the right id next. `_resolve` in `scene_tools` does
        # this for the internal agent; the external surface must not be worse.
        found = await call(client, "search_structures", query="atrium", limit=1)
        real = found["shown"][0]["organ_id"]
        typo = real[:-1]

        result = await client.call_tool("describe_structure", {"organ_id": typo})
        assert result.is_error
        assert real in str(result.content)

    async def test_an_unrecognisable_id_still_points_somewhere(self, client):
        result = await client.call_tool("describe_structure", {"organ_id": "zzzzzzzzzz"})
        assert result.is_error
        message = str(result.content)
        assert "zzzzzzzzzz" in message
        assert "search_structures" in message or "Did you mean" in message


class TestProvenance:
    async def test_atlas_info_carries_licence_and_credit(self, client):
        # The data leaves the application here. It does not leave without
        # saying where it came from.
        out = await call(client, "atlas_info")
        assert out["license"]
        assert out["credit"]
        assert out["structure_count"] > 3000

    async def test_the_female_atlas_is_reachable_and_distinct(self, client):
        male = await call(client, "atlas_info", gender="male")
        female = await call(client, "atlas_info", gender="female")
        assert female["structure_count"] != male["structure_count"]
        assert female["gender_model"] != male["gender_model"]


class TestHierarchy:
    async def test_the_root_lists_headings(self, client):
        out = await call(client, "browse_hierarchy")
        assert out["headings"]

    async def test_descending_returns_that_level_only(self, client):
        root = await call(client, "browse_hierarchy")
        first = root["headings"][0]

        out = await call(client, "browse_hierarchy", path=[first])
        assert out["path"] == [first]
        for structure in out["structures"]:
            assert structure["hierarchy"] == [first]


class TestSystems:
    async def test_lists_the_systems_with_counts(self, client):
        out = await call(client, "list_systems")
        systems = out["result"] if isinstance(out, dict) and "result" in out else out
        assert len(systems) >= 10
        assert all(entry["structure_count"] > 0 for entry in systems)


class TestRootIsReachable:
    """The entry point used to be unusable.

    An unpaged root returned every unfiled mesh in the atlas — about a quarter
    of it, roughly 140 KB — and blew the transport's token limit outright. The
    call succeeded and was still useless, which is the worst shape a failure
    can take.
    """

    async def test_the_root_fits_through_the_transport(self, client):
        out = await call(client, "browse_hierarchy")
        assert out["headings"], "headings are never paged; they are what you walk by"
        assert len(out["structures"]) <= 25
        assert out["structure_total"] > len(out["structures"])
        assert out["truncated"] is True

    async def test_offset_reaches_the_rest(self, client):
        first = await call(client, "browse_hierarchy", limit=5)
        second = await call(client, "browse_hierarchy", limit=5, offset=5)
        assert first["offset"] == 0
        assert second["offset"] == 5
        ids = {item["organ_id"] for item in first["structures"]}
        assert not ids & {item["organ_id"] for item in second["structures"]}

    async def test_a_leaf_reports_no_truncation(self, client):
        out = await call(client, "browse_hierarchy", path=["Heart"])
        assert out["headings"] == []
        assert out["structures"]
        assert out["truncated"] is False
        assert out["structure_total"] == len(out["structures"])


class TestAWrongPathFails:
    """A branch that never existed must not read as a branch that is empty."""

    async def test_a_typo_errors_with_candidates(self, client):
        result = await client.call_tool("browse_hierarchy", {"path": ["Hearts"]})
        assert result.is_error
        assert "Heart" in str(result.content)

    async def test_a_wrong_child_names_where_it_looked(self, client):
        result = await client.call_tool(
            "browse_hierarchy", {"path": ["Central nervous system", "Brian"]}
        )
        assert result.is_error
        message = str(result.content)
        assert "Brian" in message
        assert "Brain" in message

    async def test_a_real_path_still_succeeds(self, client):
        out = await call(client, "browse_hierarchy", path=["Central nervous system", "Brain"])
        assert out["headings"]


class TestAttachments:
    """451 meshes in the male atlas are muscle attachment areas.

    They carry the belly's English name and its TA2 term, so before `part`
    existed a caller saw three indistinguishable entries per side and could
    only conclude the data was duplicated.
    """

    async def test_a_muscle_reports_its_origin_and_insertion(self, client):
        out = await call(client, "describe_structure", organ_id="sartorius_muscle_l")
        assert out["part"] == "structure"
        parts = {mark["part"] for mark in out["attachment_markings"]}
        assert parts == {"origin_marking", "insertion_marking"}

    async def test_search_distinguishes_a_marking_from_the_muscle(self, client):
        out = await call(client, "search_structures", query="sartorius_muscle")
        parts = {item["organ_id"]: item["part"] for item in out["shown"]}
        assert parts["sartorius_muscle_l"] == "structure"
        assert parts["sartorius_muscle_ol"] == "origin_marking"
        assert parts["sartorius_muscle_el"] == "insertion_marking"

    async def test_a_structure_with_no_markings_returns_an_empty_list(self, client):
        out = await call(client, "describe_structure", organ_id="left_atrium")
        assert out["attachment_markings"] == []
        assert out["belongs_to"] is None

    async def test_a_marking_names_its_muscle(self, client):
        # Without this the link ran one way only, and since the markings are
        # most of the 910 unfiled entries at the root, anyone who reached one
        # by browsing was stranded on it.
        out = await call(client, "describe_structure", organ_id="sartorius_muscle_el")
        assert out["part"] == "insertion_marking"
        assert out["belongs_to"] == "sartorius_muscle_l"

    async def test_a_marking_whose_muscle_is_absent_says_so(self, client):
        # 59 markings derive a belly the atlas does not hold. Naming it anyway
        # would send the caller to an id that errors.
        out = await call(client, "describe_structure", organ_id="diaphragm_ol")
        assert out["belongs_to"] is None


class TestSystemsAreMapped:
    async def test_names_where_a_system_sits_in_the_tree(self, client):
        out = await call(client, "list_systems")
        systems = out["result"] if isinstance(out, dict) and "result" in out else out
        by_name = {entry["system"]: entry for entry in systems}
        assert "Systemic arteries" in by_name["cardiovascular"]["root_headings"]

    async def test_reports_what_browsing_cannot_reach(self, client):
        out = await call(client, "list_systems")
        systems = out["result"] if isinstance(out, dict) and "result" in out else out
        by_name = {entry["system"]: entry for entry in systems}
        assert by_name["muscular"]["unfiled"] > 0
        assert by_name["cardiovascular"]["unfiled"] == 0


class TestSaysWhatItDoesNotKnow:
    async def test_every_empty_search_explains_the_index(self, client):
        # Keyed on the result, not the characters. The first version fired on
        # non-ASCII input: it helped Bulgarian and missed `corazon` typed
        # without its accent, which is how a Spanish speaker on an English
        # keyboard actually types — and Spanish is one of the three languages
        # this project ships in.
        for query in ("сърце", "corazón", "corazon", "hueso", "rinon"):
            out = await call(client, "search_structures", query=query)
            assert out["total"] == 0, query
            assert out["note"] and "Latin" in out["note"], query

    async def test_an_absent_term_is_a_zero_with_a_note_not_an_error(self, client):
        # "gizzard" really is not in a human atlas. Refusing would misrepresent
        # a correct answer as a failure, so the note sits beside the result
        # rather than replacing it.
        out = await call(client, "search_structures", query="gizzard")
        assert out["total"] == 0
        assert out["note"]

    async def test_a_hit_carries_no_note(self, client):
        out = await call(client, "search_structures", query="atrium")
        assert out["note"] is None

    async def test_the_instructions_disclaim_relationships(self, client):
        # `add_supply` in the application answers this from live geometry. The
        # manifest holds no edges, and a model must not fill that in.
        instructions = (await client.initialize()).instructions or ""
        assert "no relationships" in instructions
