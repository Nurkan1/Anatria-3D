"""Anatria3D's atlas, over MCP.

A read-only server that answers anatomical questions from the manifest the
application already ships — 3,478 structures in the male atlas and 264 in the
female trunk, each with its TA2 Latin term, its system and its place in the
hierarchy. It needs no running application, no API key and no network.

**It cannot change anything.** Every tool here reads. Driving the viewport is a
separate surface with a separate security model, and it is deliberately not in
this file.

Run it over stdio:

    tools/anatria_mcp/.venv/Scripts/python.exe tools/anatria_mcp/atlas.py

See `README.md` beside this file for client configuration.
"""

from __future__ import annotations

import difflib
import os
import sys
from pathlib import Path
from typing import Annotated, Literal

REPO_ROOT = Path(__file__).resolve().parents[2]

# The search rule is owned by the engine — see `atlas_search` for why it lives
# there rather than here. Only that module is imported, and it is standard
# library throughout, so this process never needs the sidecar's dependencies.
sys.path.insert(0, str(REPO_ROOT / "engine"))

from anatria_engine.atlas_search import (
    MAX_RESULTS,
    MIN_QUERY_LENGTH,
    Atlas,
    children_of,
    load_atlas,
    search,
)
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

Gender = Literal["male", "female"]

#: Where the manifests live. Defaults to the checkout; an installed copy of the
#: application sets this to its own resources directory, which is why it is an
#: environment variable rather than a constant.
ATLAS_DIR = Path(os.environ.get("ANATRIA_ATLAS_DIR", REPO_ROOT / "public" / "anatomy"))

MANIFESTS: dict[str, str] = {
    "male": "manifest.json",
    "female": "manifest_female.json",
}

_loaded: dict[str, Atlas] = {}


def atlas(gender: Gender) -> Atlas:
    """The requested manifest, read once and kept.

    Loading is deferred rather than done at import: a client that only ever asks
    about the male atlas should not pay for the female one, and a server that
    fails at startup because one file is missing is harder to diagnose than a
    tool that says which file it could not find.
    """
    if gender not in _loaded:
        path = ATLAS_DIR / MANIFESTS[gender]
        if not path.is_file():
            raise FileNotFoundError(
                f"No {gender} manifest at {path}. Set ANATRIA_ATLAS_DIR to the "
                "directory holding manifest.json."
            )
        _loaded[gender] = load_atlas(path)
    return _loaded[gender]


class StructureOut(BaseModel):
    """One structure, as a client sees it."""

    organ_id: str
    ta2_latin: str
    name_en: str
    system: str
    hierarchy: list[str] = Field(
        default_factory=list,
        description="Headings from the atlas root down to this structure.",
    )


class SearchOut(BaseModel):
    query: str
    total: int = Field(description="Matches found, before the result cap.")
    shown: list[StructureOut]
    truncated: bool = Field(
        description="True when matches were withheld; narrow the query to see them."
    )


class SystemOut(BaseModel):
    system: str
    structure_count: int


class BrowseOut(BaseModel):
    path: list[str]
    headings: list[str] = Field(description="Sub-headings directly below this point.")
    structures: list[StructureOut] = Field(description="Structures that stop here.")


class AtlasInfoOut(BaseModel):
    gender_model: str
    manifest_version: int
    structure_count: int
    systems: list[SystemOut]
    license: str
    credit: str
    attribution: str


def _out(structure) -> StructureOut:
    return StructureOut(
        organ_id=structure.organ_id,
        ta2_latin=structure.ta2_latin,
        name_en=structure.name_en,
        system=structure.system,
        hierarchy=list(structure.path),
    )


READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True)

#: Near-misses offered when an id is not found. `_resolve` in `scene_tools`
#: does the same for the internal agent, and for the same reason: a model that
#: is told only "no such structure" guesses again, while one handed three real
#: ids picks the right one on the next call.
SUGGESTIONS = 5


def build_server() -> MCPServer:
    mcp = MCPServer(
        "anatria-atlas",
        title="Anatria3D Atlas",
        version="0.1.0",
        instructions=(
            "Anatomical reference from the Anatria3D atlas. Structures carry "
            "Terminologia Anatomica (TA2) Latin terms alongside English names. "
            "Use search_structures to find an organ_id, then describe_structure "
            "for its full record. This server reads only; it cannot move or "
            "change anything in the Anatria3D application."
        ),
    )

    @mcp.tool(annotations=READ_ONLY)
    def search_structures(
        query: Annotated[str, Field(description="Part of a Latin term, English name or id.")],
        gender: Gender = "male",
        limit: Annotated[int, Field(ge=1, le=MAX_RESULTS)] = MAX_RESULTS,
    ) -> SearchOut:
        """Search the atlas by name, in Latin or English.

        Matching is by substring across the TA2 Latin term, the English name and
        the identifier, ranked shortest name first so an exact-ish term outranks
        the compound names that merely contain it.
        """
        if len(query.strip()) < MIN_QUERY_LENGTH:
            raise ToolError(f"Search for at least {MIN_QUERY_LENGTH} characters.")

        found = search(atlas(gender).structures, query)
        shown = found[:limit]
        return SearchOut(
            query=query,
            total=len(found),
            shown=[_out(structure) for structure in shown],
            truncated=len(found) > len(shown),
        )

    @mcp.tool(annotations=READ_ONLY)
    def describe_structure(organ_id: str, gender: Gender = "male") -> StructureOut:
        """The full record for one structure, including its hierarchy trail.

        Use search_structures first to get an exact organ_id.
        """
        loaded = atlas(gender)
        structure = loaded.by_id(organ_id)
        if structure is None:
            close = difflib.get_close_matches(
                organ_id, [item.organ_id for item in loaded.structures], n=SUGGESTIONS, cutoff=0.5
            )
            hint = (
                f" Did you mean: {', '.join(close)}?"
                if close
                else " Use search_structures to find the exact id."
            )
            raise ToolError(f"No structure {organ_id!r} in the {gender} atlas.{hint}")
        return _out(structure)

    @mcp.tool(annotations=READ_ONLY)
    def list_systems(gender: Gender = "male") -> list[SystemOut]:
        """The anatomical systems in the atlas, with how many structures each holds."""
        return [
            SystemOut(system=system, structure_count=count)
            for system, count in sorted(atlas(gender).systems.items())
        ]

    @mcp.tool(annotations=READ_ONLY)
    def browse_hierarchy(
        path: Annotated[
            list[str] | None,
            Field(description="Headings from the root down. Omit for the top level."),
        ] = None,
        gender: Gender = "male",
    ) -> BrowseOut:
        """Walk the atlas hierarchy one level at a time.

        Returns the sub-headings below a point and the structures that stop
        there, separately — the two are different things and a flat list of both
        cannot say which is which.
        """
        prefix = tuple(path or ())
        headings, leaves = children_of(atlas(gender).structures, prefix)
        return BrowseOut(
            path=list(prefix),
            headings=headings,
            structures=[_out(structure) for structure in leaves],
        )

    @mcp.tool(annotations=READ_ONLY)
    def atlas_info(gender: Gender = "male") -> AtlasInfoOut:
        """What this atlas is, and who it belongs to.

        Read this before reproducing the data anywhere: the licence and
        attribution the atlas ships with apply to whatever you do with it.
        """
        loaded = atlas(gender)
        return AtlasInfoOut(
            gender_model=loaded.gender_model,
            manifest_version=loaded.version,
            structure_count=len(loaded.structures),
            systems=[
                SystemOut(system=system, structure_count=count)
                for system, count in sorted(loaded.systems.items())
            ],
            license=loaded.license,
            credit=loaded.credit,
            attribution=loaded.attribution,
        )

    return mcp


if __name__ == "__main__":
    build_server().run()
