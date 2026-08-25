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
from typing import Literal, Protocol

#: Results returned by one search. Enough to disambiguate, small enough that a
#: vague query does not dump the atlas back into the caller's context window.
MAX_RESULTS = 25

#: One character matches most of the body and teaches nobody anything.
MIN_QUERY_LENGTH = 2

#: What an entry is, read from the identifier's suffix.
#:
#: **This is what the source data marks, not an anatomical finding.** Z-Anatomy
#: names a muscle's attachment meshes `.ol`/`.or` and `.el`/`.er` beside the
#: belly's `.l`/`.r`, and the asset pipeline documents the convention — see the
#: comment at `tools/asset-pipeline/build-manifest.mjs`. Reporting it is
#: repeating what the upstream dataset asserts; a caller that turns it into
#: "the origin of this muscle is here" has gone one step further than the
#: evidence, and the tool descriptions say so.
Part = Literal["belly", "origin_marking", "insertion_marking"]

_PART_BY_SUFFIX: dict[str, Part] = {
    "ol": "origin_marking",
    "or": "origin_marking",
    "el": "insertion_marking",
    "er": "insertion_marking",
}


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


def part_of(organ_id: str) -> Part:
    """Whether an identifier names a muscle belly or one of its attachment meshes.

    Suffix-driven, because that is the only place the distinction is recorded:
    `sartorius_muscle_ol` and `sartorius_muscle_l` carry the same English name
    and the same TA2 term, and nothing else separates them. Without this a
    caller sees three identical-looking entries per side and cannot tell which
    to offer a reader — which is exactly what happened the first time a model
    was pointed at this data.
    """
    return _PART_BY_SUFFIX.get(organ_id.rsplit("_", 1)[-1], "belly")


def belly_id(organ_id: str) -> str | None:
    """The muscle an attachment marking belongs to, by identifier.

    `sartorius_muscle_ol` → `sartorius_muscle_l`. Returns `None` for anything
    that is not a marking. **The muscle may not exist** — 59 markings in the
    male atlas have no belly under the derived id, the diaphragm and erector
    spinae among them — so the caller checks before trusting it.
    """
    suffix = organ_id.rsplit("_", 1)[-1]
    if suffix not in _PART_BY_SUFFIX:
        return None
    return f"{organ_id[: -len(suffix) - 1]}_{suffix[-1]}"


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

    @property
    def part(self) -> Part:
        return part_of(self.organ_id)

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
    project should not commit — and the two atlases do **not** share a licence,
    so the field cannot be a constant.
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

    def markings_for(self, organ_id: str) -> list[Structure]:
        """The attachment meshes the source data files against a muscle.

        Empty for anything that is not a muscle belly, and **routinely
        incomplete** where it is: 197 muscles in the male atlas carry only one
        of the two markings. An empty result is therefore not evidence that a
        muscle has no attachments, only that this dataset records none.
        """
        return self._markings.get(organ_id, [])

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "_index", {structure.organ_id: structure for structure in self.structures}
        )

        markings: dict[str, list[Structure]] = {}
        for structure in self.structures:
            owner = belly_id(structure.organ_id)
            if owner is not None:
                markings.setdefault(owner, []).append(structure)
        for group in markings.values():
            group.sort(key=lambda structure: structure.organ_id)
        object.__setattr__(self, "_markings", markings)


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
        systems={entry["system"]: entry["organ_count"] for entry in raw.get("systems", [])},
    )


def headings_at(structures: list[Structure], prefix: tuple[str, ...]) -> list[str]:
    """The heading names directly below a point, in manifest order."""
    depth = len(prefix)
    seen: dict[str, None] = {}
    for structure in structures:
        if structure.path[:depth] == prefix and len(structure.path) > depth:
            seen[structure.path[depth]] = None
    return list(seen)


def children_of(
    structures: list[Structure], prefix: tuple[str, ...]
) -> tuple[list[str], list[Structure]]:
    """What sits directly under a point in the hierarchy.

    Returns the next level of headings and the structures that stop exactly
    here, separately — a reader browsing needs to know which of the two they are
    looking at, and a flat list of both cannot say.

    An empty prefix asks for the roots. **26% of the male atlas has no path at
    all** — the attachment markings and other unfiled meshes — so the root's
    structure list is enormous and callers must page it rather than take it
    whole.
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
