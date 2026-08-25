"""The search rule, and the guarantee that it stays one rule.

`atlas_search` is standard library only so that the MCP server can import it
without the sidecar's dependencies. These tests run in the repository venv like
every other engine test, which is the point: the module is shared, so it is
covered by the gates that already run.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from anatria_engine.atlas_search import (
    MIN_QUERY_LENGTH,
    children_of,
    load_atlas,
    search,
)
from anatria_engine.protocol import OrganMeta

MANIFEST = Path(__file__).resolve().parents[2] / "public" / "anatomy" / "manifest.json"


@pytest.fixture(scope="module")
def atlas():
    return load_atlas(MANIFEST)


def structure(organ_id: str, latin: str, english: str, path: tuple[str, ...] = ()):
    from anatria_engine.atlas_search import Structure

    return Structure(
        organ_id=organ_id, ta2_latin=latin, name_en=english, system="cardiovascular", path=path
    )


class TestSearch:
    def test_matches_latin_english_and_id(self):
        items = [
            structure("left_atrium", "Atrium sinistrum", "Left atrium"),
            structure("aorta", "Aorta", "Aorta"),
        ]
        assert [s.organ_id for s in search(items, "atrium")] == ["left_atrium"]
        assert [s.organ_id for s in search(items, "Left")] == ["left_atrium"]
        assert [s.organ_id for s in search(items, "left_at")] == ["left_atrium"]

    def test_shortest_name_first(self):
        # Searching "atrium" must not bury the atrium under every structure
        # whose name happens to contain the word.
        items = [
            structure("a", "x", "Atrioventricular node of the atrium"),
            structure("b", "y", "Left atrium"),
            structure("c", "z", "Atrium"),
        ]
        assert [s.organ_id for s in search(items, "atrium")] == ["c", "b", "a"]

    def test_refuses_a_query_too_short_to_mean_anything(self):
        items = [structure("aorta", "Aorta", "Aorta")]
        assert search(items, "a") == []
        assert len("a") < MIN_QUERY_LENGTH

    def test_is_case_insensitive_on_both_sides(self):
        items = [structure("aorta", "Aorta", "Aorta")]
        assert search(items, "AORTA")
        assert search(items, "aOrTa")


class TestOneRule:
    """`find_structures` in `scene_tools` must not drift from this module.

    The two search different corpora — the viewport's loaded structures against
    the whole manifest — but they must rank the same names the same way, or a
    reader gets one answer from the assistant and a different one from an
    external client asking the identical question.

    `OrganMeta` is passed in directly: the rule is structural, so anything
    carrying the three fields works, and that is what keeps the two callers on
    one implementation instead of two that merely resemble each other.
    """

    def test_ranks_organ_meta_identically(self):
        organs = [
            OrganMeta(
                organ_id="atrioventricular_node",
                ta2_latin="Nodus atrioventricularis",
                name_en="Atrioventricular node of the atrium",
                system="cardiovascular",
            ),
            OrganMeta(
                organ_id="left_atrium",
                ta2_latin="Atrium sinistrum",
                name_en="Left atrium",
                system="cardiovascular",
            ),
        ]
        ranked = search(organs, "atrium")
        assert [organ.organ_id for organ in ranked] == [
            "left_atrium",
            "atrioventricular_node",
        ]


@pytest.mark.skipif(not MANIFEST.is_file(), reason="the shipped manifest is not in this checkout")
class TestAgainstTheShippedManifest:
    """Loading is asserted against the real file, not a fixture.

    A fixture would keep passing after the export pipeline changes the manifest
    shape, which is exactly the change these tests exist to catch.
    """

    def test_loads_every_structure(self, atlas):
        raw = json.loads(MANIFEST.read_text(encoding="utf-8"))
        assert len(atlas.structures) == len(raw["organs"])

    def test_carries_the_licence_out_of_the_file(self, atlas):
        # This data leaves the application over MCP. Handing it to a third
        # party without its provenance is the failure to avoid.
        assert atlas.license
        assert atlas.credit

    def test_indexes_by_id(self, atlas):
        first = atlas.structures[0]
        assert atlas.by_id(first.organ_id) is first
        assert atlas.by_id("no_such_structure") is None

    def test_hierarchy_separates_headings_from_structures(self, atlas):
        headings, leaves = children_of(atlas.structures, ())
        assert headings, "the atlas root should have headings"
        assert all(isinstance(name, str) for name in headings)
        assert all(structure.path == () for structure in leaves)

    def test_descending_a_heading_narrows_the_result(self, atlas):
        headings, _ = children_of(atlas.structures, ())
        deeper_headings, deeper_leaves = children_of(atlas.structures, (headings[0],))
        assert deeper_headings or deeper_leaves
        for structure in deeper_leaves:
            assert structure.path == (headings[0],)
