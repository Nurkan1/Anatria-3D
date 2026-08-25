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
    belly_id,
    children_of,
    headings_at,
    load_atlas,
    part_of,
    search,
    systems_map,
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


class TestAttachmentMarkings:
    """The suffixes are the only record that these meshes are not the muscle.

    A quarter of the male atlas is unfiled, and 451 of those are muscle
    attachment areas carrying the *same* English name and the *same* TA2 term
    as the belly. Pointed at that without this distinction, a model reads six
    sartorius entries and concludes the data is duplicated rubbish — which is
    what happened. The convention is Z-Anatomy's, documented in
    `tools/asset-pipeline/build-manifest.mjs`.
    """

    def test_reads_the_part_from_the_suffix(self):
        assert part_of("sartorius_muscle_l") == "structure"
        assert part_of("sartorius_muscle_ol") == "origin_marking"
        assert part_of("sartorius_muscle_er") == "insertion_marking"

    def test_anything_unsuffixed_is_the_structure_itself(self):
        # Not "belly": most of the atlas is not muscle, and calling the left
        # atrium a belly borrows anatomical vocabulary for a filing
        # distinction that has nothing to do with it.
        assert part_of("aorta") == "structure"
        assert part_of("third_ventricle") == "structure"
        assert part_of("left_atrium") == "structure"

    def test_names_the_muscle_a_marking_belongs_to(self):
        assert belly_id("sartorius_muscle_ol") == "sartorius_muscle_l"
        assert belly_id("sartorius_muscle_er") == "sartorius_muscle_r"
        assert belly_id("sartorius_muscle_l") is None

    def test_the_muscle_may_not_exist(self, atlas):
        # 59 markings in the male atlas have no belly under the derived id —
        # the diaphragm and erector spinae among them. `belly_id` derives a
        # name; it does not promise the atlas holds it.
        assert belly_id("diaphragm_ol") == "diaphragm_l"
        assert atlas.by_id("diaphragm_l") is None

    def test_a_muscle_reports_its_markings(self, atlas):
        markings = atlas.markings_for("sartorius_muscle_l")
        assert {mark.organ_id for mark in markings} == {
            "sartorius_muscle_el",
            "sartorius_muscle_ol",
        }
        assert {mark.part for mark in markings} == {"origin_marking", "insertion_marking"}

    def test_a_marking_is_never_filed_against_itself(self, atlas):
        assert atlas.markings_for("sartorius_muscle_ol") == []

    def test_most_muscles_carry_only_one_marking(self, atlas):
        # Recorded because the tool description promises it: an empty or
        # half-empty list is this dataset's coverage, not an anatomical claim
        # that the muscle has no second attachment.
        bellies = {
            structure.organ_id
            for structure in atlas.structures
            if structure.system == "muscular" and structure.part == "structure"
        }
        with_both = sum(
            1
            for organ_id in bellies
            if len({mark.part for mark in atlas.markings_for(organ_id)}) == 2
        )
        with_any = sum(1 for organ_id in bellies if atlas.markings_for(organ_id))
        assert 0 < with_both < with_any


class TestSystemsMap:
    """`list_systems` would otherwise be a wrapper around `atlas_info`.

    The counts are already in the info call. What is only here is where in the
    tree a system sits, and how much of it sits nowhere.
    """

    def test_names_the_root_headings_a_system_is_filed_under(self, atlas):
        mapped = systems_map(atlas.structures)
        roots, _ = mapped["cardiovascular"]
        assert "Systemic arteries" in roots

    def test_counts_what_browsing_cannot_reach(self, atlas):
        # The muscular system's unfiled structures are its 451 attachment
        # markings: reachable by search, invisible to anyone walking the tree.
        _, unfiled = mapped_muscular = systems_map(atlas.structures)["muscular"]
        assert unfiled == sum(
            1
            for structure in atlas.structures
            if structure.system == "muscular" and not structure.path
        )
        assert mapped_muscular[1] > 0

    def test_a_fully_filed_system_reports_none_unfiled(self, atlas):
        _, unfiled = systems_map(atlas.structures)["cardiovascular"]
        assert unfiled == 0


class TestHeadings:
    def test_lists_only_the_next_level(self, atlas):
        roots = headings_at(atlas.structures, ())
        assert "Central nervous system" in roots
        assert "Brain" not in roots, "Brain sits deeper and must not surface at the root"

    def test_descends(self, atlas):
        assert "Brain" in headings_at(atlas.structures, ("Central nervous system",))

    def test_a_leaf_has_no_headings(self, atlas):
        assert headings_at(atlas.structures, ("Heart",)) == []
