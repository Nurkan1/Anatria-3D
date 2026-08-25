"""Reading and searching the atlas, in one place.

Two callers need the same answer from the same names. `find_structures` in
`scene_tools` searches what the viewport currently has loaded; the MCP atlas
server searches the whole manifest with no viewport at all. Same rule, two
corpora — so the rule lives here and neither owns a copy of it.

**Standard library only, deliberately.** The MCP server runs in its own
virtualenv without `pydantic-ai` (see `tools/anatria_mcp/README.md` for why),
and this module is the seam between the two environments. A dependency added
here would have to be satisfied twice.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

#: Results returned by one search. Enough to disambiguate, small enough that a
#: vague query does not dump the atlas back into the caller's context window.
MAX_RESULTS = 25

#: One character matches most of the body and teaches nobody anything.
MIN_QUERY_LENGTH = 2


class Named(Protocol):
    """The three fields a search reads.

    Structural, not inherited: `OrganMeta` on the engine side and `Structure`
    below both satisfy it without knowing about each other.
    """

    organ_id: str
    ta2_latin: str
    name_en: str


def search(structures: list, query: str) -> list:
    """Every structure whose id, Latin or English name contains the query.

    Ordered shortest English name first, so an exact-ish term outranks the long
    compound names that merely contain it — searching "atrium" should not bury
    the atrium under every structure named after one.

    Returns all matches. Capping is the caller's decision, because the caller
    is the one that knows what it will do with the remainder.
    """
    needle = query.strip().lower()
    if len(needle) < MIN_QUERY_LENGTH:
        return []

    found = [
        structure
        for structure in structures
        if needle in structure.ta2_latin.lower()
        or needle in structure.name_en.lower()
        or needle in structure.organ_id
    ]
    found.sort(key=lambda structure: len(structure.name_en))
    return found


@dataclass(frozen=True)
class Structure:
    """One entry of the shipped manifest.

    Carries more than `OrganMeta` does — the hierarchy trail and the mesh it
    lives in — because a reader browsing the atlas without the application open
    has nothing else to orient by.
    """

    organ_id: str
    ta2_latin: str
    name_en: str
    system: str
    path: tuple[str, ...] = ()
    mesh_file: str = ""
    node: str = ""

    def describe(self) -> str:
        """Compact form: `organ_id — Latin (English)`.

        Deliberately identical to `OrganMeta.describe`. The two are read by the
        same models, and a structure that looks different depending on which
        door it came through invites the reader to think they are different
        structures.
        """
        return f"{self.organ_id} — {self.ta2_latin} ({self.name_en})"


@dataclass(frozen=True)
class Atlas:
    """A loaded manifest: what is in it, and where it came from.

    `license`, `credit` and `attribution` are carried rather than dropped
    because this data leaves the application now. Anatomical data handed to a
    third party without saying where it came from is precisely the failure this
    project should not commit.
    """

    version: int
    gender_model: str
    license: str
    credit: str
    attribution: str
    structures: list[Structure] = field(default_factory=list)
    systems: dict[str, int] = field(default_factory=dict)

    def by_id(self, organ_id: str) -> Structure | None:
        return self._index.get(organ_id)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "_index", {structure.organ_id: structure for structure in self.structures}
        )


def load_atlas(manifest_path: Path) -> Atlas:
    """Read one manifest from disk.

    Missing optional fields are tolerated — `path` is absent for structures that
    sit at the root of their system, and older manifests predate some of the
    credit fields. A malformed *required* field is not tolerated: it would
    surface later as a structure the reader cannot reach, which is worse than a
    refusal at load.
    """
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))

    structures = [
        Structure(
            organ_id=entry["organ_id"],
            ta2_latin=entry["ta2_latin"],
            name_en=entry["name_en"],
            system=entry["system"],
            path=tuple(entry.get("path", ())),
            mesh_file=entry.get("mesh_file", ""),
            node=entry.get("node", ""),
        )
        for entry in raw["organs"]
    ]

    return Atlas(
        version=raw.get("version", 0),
        gender_model=raw.get("gender_model", "unknown"),
        license=raw.get("license", ""),
        credit=raw.get("credit", ""),
        attribution=raw.get("attribution", ""),
        structures=structures,
        systems={
            entry["system"]: entry["organ_count"] for entry in raw.get("systems", [])
        },
    )


def children_of(
    structures: list[Structure], prefix: tuple[str, ...]
) -> tuple[list[str], list[Structure]]:
    """What sits directly under a point in the hierarchy.

    Returns the next level of headings and the structures that stop exactly
    here, separately — a reader browsing needs to know which of the two they are
    looking at, and a flat list of both cannot say.

    An empty prefix asks for the roots.
    """
    depth = len(prefix)
    headings: dict[str, None] = {}
    leaves: list[Structure] = []

    for structure in structures:
        if structure.path[:depth] != prefix:
            continue
        if len(structure.path) == depth:
            leaves.append(structure)
        else:
            headings[structure.path[depth]] = None

    leaves.sort(key=lambda structure: structure.name_en)
    return list(headings), leaves
