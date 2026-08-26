"""Anatria3D's atlas, over MCP.

A read-only server that answers anatomical questions from the manifest the
application already ships — 3,478 structures in the male atlas and 264 in the
female trunk, each with its TA2 Latin term, its system and its place in the
hierarchy. It needs no running application, no API key and no network.

**It cannot change anything.** Every tool here reads. Driving the viewport is a
separate surface with a separate security model, and it is deliberately not in
this file.

Run it over stdio:

    tools/anatria_mcp/.venv/Scripts/python.exe tools/anatria_mcp/atlas.py  # Windows
    tools/anatria_mcp/.venv/bin/python tools/anatria_mcp/atlas.py          # POSIX

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
    belly_id,
    children_of,
    headings_at,
    load_atlas,
    search,
    systems_map,
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
    part: str = Field(
        default="structure",
        description=(
            "'structure' for the thing itself, or 'origin_marking' / "
            "'insertion_marking' for a mesh the source data files as one of a "
            "muscle's attachment areas. This repeats the upstream dataset's own "
            "naming — it is not an independent anatomical finding."
        ),
    )


class SearchOut(BaseModel):
    query: str
    total: int = Field(description="Matches found, before the result cap.")
    shown: list[StructureOut]
    truncated: bool = Field(
        description="True when matches were withheld; narrow the query to see them."
    )
    note: str | None = Field(
        default=None,
        description="Present only when nothing matched; explains what the index covers.",
    )


class DescribeOut(StructureOut):
    """One structure, plus what else the manifest files against it."""

    belongs_to: str | None = Field(
        default=None,
        description=(
            "For an attachment marking, the identifier of the muscle it is filed "
            "against — null for anything else, and null when the marking's muscle "
            "is not in this atlas, which is the case for 59 of them."
        ),
    )
    attachment_markings: list[StructureOut] = Field(
        default_factory=list,
        description=(
            "Meshes the source data names as this muscle's origin or insertion "
            "areas. Empty for anything that is not a muscle belly, and often "
            "incomplete where it is — 197 muscles in the male atlas carry only "
            "one of the two. An empty list means this dataset records none, not "
            "that the muscle has no attachments."
        ),
    )


class SystemOut(BaseModel):
    system: str
    structure_count: int


class SystemMapOut(SystemOut):
    """A system, and where in the tree to find it."""

    root_headings: list[str] = Field(
        default_factory=list,
        description="Top-level headings under which this system's structures are filed.",
    )
    unfiled: int = Field(
        default=0,
        description=(
            "Structures of this system with no hierarchy path at all — "
            "reachable by search, invisible to anyone walking the tree. It "
            "should be zero everywhere; 910 structures across five systems "
            "were once unreachable this way, and this is what makes a "
            "recurrence countable."
        ),
    )


class BrowseOut(BaseModel):
    path: list[str]
    headings: list[str] = Field(description="Sub-headings directly below this point.")
    structures: list[StructureOut] = Field(description="Structures that stop here.")
    structure_total: int = Field(
        description="Structures at this level in total, before the page was cut."
    )
    offset: int = Field(description="Where this page started.")
    truncated: bool = Field(
        description="True when structures were withheld; raise offset to see the rest."
    )


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
        part=structure.part,
    )


def _validated(loaded: Atlas, prefix: tuple[str, ...]) -> tuple[str, ...]:
    """Refuse a path that does not exist, rather than returning it empty.

    A heading that is merely childless and a heading that was never there look
    identical in the result — both are empty — so without this a caller walking
    from a typo is told the branch is empty and has no way to learn otherwise.
    Every other tool here errors on bad input and offers candidates; this one
    used to succeed, which made it the only place in the server that could
    mislead the reader.
    """
    for depth in range(len(prefix)):
        available = headings_at(loaded.structures, prefix[:depth])
        if prefix[depth] in available:
            continue
        close = difflib.get_close_matches(prefix[depth], available, n=SUGGESTIONS, cutoff=0.4)
        where = " at the atlas root" if depth == 0 else f" under {list(prefix[:depth])}"
        hint = (
            f" Did you mean: {', '.join(close)}?"
            if close
            else f" Available: {', '.join(available[:SUGGESTIONS])}."
        )
        raise ToolError(f"No heading {prefix[depth]!r}{where}.{hint}")
    return prefix


READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True)

#: Near-misses offered when an id is not found. `_resolve` in `scene_tools`
#: does the same for the internal agent, and for the same reason: a model that
#: is told only "no such structure" guesses again, while one handed three real
#: ids picks the right one on the next call.
SUGGESTIONS = 5

#: Attached to every empty search, and to nothing else.
#:
#: Keyed on the result rather than the characters. The first version fired on
#: non-ASCII input, which helped a Bulgarian query and missed `corazon` typed
#: without its accent — the ordinary case for a Spanish speaker on an English
#: keyboard, and one of the three languages this project ships in. A zero is
#: also a *correct* answer for a structure a human atlas genuinely lacks, so
#: this is a note beside the result and not an error in place of it.
NO_MATCH_NOTE = (
    "Nothing in the {gender} atlas matches. This index covers TA2 Latin terms, "
    "English names and identifiers only — a query in Bulgarian, Spanish or any "
    "other language finds nothing here even when the structure exists, so this "
    "is not evidence of absence. Search the Latin or English term. If you did "
    "search in English, the structure may genuinely not be in this atlas: "
    "check atlas_info, since the two atlases cover different systems."
)


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
            "change anything in the Anatria3D application. "
            "What it does NOT hold, so do not answer these from it: the index "
            "is Latin, English and identifiers only — a query in any other "
            "language returns nothing, and that is not evidence the structure "
            "is absent. The manifest records no relationships: nothing here "
            "says what supplies, innervates, drains or borders a structure. "
            "The two atlases are separate works under different licences and "
            "cover different systems; the female one has no muscular or "
            "nervous structures at all."
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
            note=None if found else NO_MATCH_NOTE.format(gender=gender),
        )

    @mcp.tool(annotations=READ_ONLY)
    def describe_structure(organ_id: str, gender: Gender = "male") -> DescribeOut:
        """One structure's record, plus any attachment areas filed against it.

        Use search_structures first to get an exact organ_id.

        For a muscle this returns the meshes the source data names as its origin
        and insertion areas; called on one of those markings, `belongs_to` names
        the muscle it is filed against, so the link works in both directions.
        **That is the upstream dataset's own naming, repeated — not an
        anatomical finding of this project.** Say so if you pass it on, and do
        not report an empty list as "this muscle has no attachments": it means
        the manifest records none.
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

        base = _out(structure)
        owner = belly_id(organ_id)
        return DescribeOut(
            **base.model_dump(),
            belongs_to=owner if owner and loaded.by_id(owner) else None,
            attachment_markings=[_out(mark) for mark in loaded.markings_for(organ_id)],
        )

    @mcp.tool(annotations=READ_ONLY)
    def list_systems(gender: Gender = "male") -> list[SystemMapOut]:
        """The atlas's systems: how big each is, and where in the tree it sits.

        The counts alone are also in `atlas_info`. What is here and nowhere else
        is the map — which top-level headings a system is filed under, and how
        much of it is filed nowhere and therefore only reachable by search.
        """
        loaded = atlas(gender)
        mapped = systems_map(loaded.structures)
        return [
            SystemMapOut(
                system=system,
                structure_count=count,
                root_headings=mapped.get(system, ([], 0))[0],
                unfiled=mapped.get(system, ([], 0))[1],
            )
            for system, count in sorted(loaded.systems.items())
        ]

    @mcp.tool(annotations=READ_ONLY)
    def browse_hierarchy(
        path: Annotated[
            list[str] | None,
            Field(description="Headings from the root down. Omit for the top level."),
        ] = None,
        gender: Gender = "male",
        limit: Annotated[int, Field(ge=1, le=MAX_RESULTS)] = MAX_RESULTS,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> BrowseOut:
        """Walk the atlas hierarchy one level at a time.

        Returns the sub-headings below a point and the structures that stop
        there, separately — the two are different things and a flat list of both
        cannot say which is which.

        Structures are paged, because one level can hold hundreds —
        `Muscular insertions` alone holds 451. `headings` is never paged, since
        that is the part a caller walks by.
        """
        loaded = atlas(gender)
        prefix = _validated(loaded, tuple(path or ()))
        headings, leaves = children_of(loaded.structures, prefix)
        page = leaves[offset : offset + limit]
        return BrowseOut(
            path=list(prefix),
            headings=headings,
            structures=[_out(structure) for structure in page],
            structure_total=len(leaves),
            offset=offset,
            truncated=offset + len(page) < len(leaves),
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
