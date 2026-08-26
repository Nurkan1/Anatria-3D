"""The classification stays level with the protocol, and answers correctly.

`scene_contract` says which scene actions name the atlas. That claim is only
worth anything while it covers every action there is — a fifteenth arriving
unclassified would reach the control bridge unchecked, which is the exact hole
the module exists to close.

So the first two tests here are not about behaviour at all. They compare the
classification against the `SceneCommand` union itself, and fail the build when
the two drift. The union is the source of truth; this module is a claim about
it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, get_args, get_origin

import pytest

from anatria_engine.atlas_search import load_atlas
from anatria_engine.protocol import SceneCommand
from anatria_engine.scene_contract import (
    ATLAS_REFERENCES,
    XRAY_OPACITY,
    UnclassifiedActionError,
    unknown_references,
)

MANIFEST = Path(__file__).resolve().parents[2] / "public" / "anatomy" / "manifest.json"


@pytest.fixture(scope="module")
def atlas():
    return load_atlas(MANIFEST)


def command_models():
    """Every member of the `SceneCommand` discriminated union."""
    inner = get_args(SceneCommand)[0] if get_origin(SceneCommand) is Annotated else SceneCommand
    members = get_args(inner)
    assert members, "SceneCommand is not a union any more — this test needs rewriting."
    return members


def action_of(model) -> str:
    return get_args(model.model_fields["action"].annotation)[0]


class TestItStaysLevelWithTheProtocol:
    def test_every_action_is_classified(self):
        assert {action_of(model) for model in command_models()} == set(ATLAS_REFERENCES)

    def test_every_named_field_exists_on_its_model(self):
        """Catches a renamed field, which the coverage test above cannot see.

        `organ_id` becoming `structure_id` would leave the action classified and
        the classification pointing at nothing, so every command would validate
        clean while naming a structure nobody checked.
        """
        for model in command_models():
            reference = ATLAS_REFERENCES[action_of(model)]
            if reference is None:
                continue
            field, _ = reference
            assert field in model.model_fields, f"{action_of(model)} has no field {field!r}"


class TestWhatItAnswers:
    def test_a_real_identifier_resolves(self, atlas):
        real = atlas.structures[0].organ_id
        assert unknown_references(atlas, {"action": "focus_organ", "organ_id": real}) == []

    def test_an_invented_identifier_is_named_back(self, atlas):
        problems = unknown_references(
            atlas, {"action": "focus_organ", "organ_id": "sternum_of_lies"}
        )
        assert problems == ["sternum_of_lies"]

    def test_a_list_reports_only_the_bad_ones(self, atlas):
        real = atlas.structures[0].organ_id
        problems = unknown_references(
            atlas,
            {"action": "isolate_structures", "organ_ids": [real, "nope", "also_nope"]},
        )
        assert problems == ["nope", "also_nope"]

    def test_an_action_that_names_nothing_is_always_clean(self, atlas):
        for action in ("reset_view", "clear_pathway", "add_supply", "set_cross_section"):
            assert unknown_references(atlas, {"action": action}) == []

    def test_a_real_group_name_resolves(self, atlas):
        assert unknown_references(atlas, {"action": "isolate_group", "group": "Bursae"}) == []

    def test_an_invented_group_name_is_named_back(self, atlas):
        command = {"action": "isolate_group", "group": "Bursae of lies"}
        assert unknown_references(atlas, command) == ["Bursae of lies"]

    def test_a_group_name_is_not_an_identifier(self, atlas):
        """The two namespaces are separate, and mixing them must not pass.

        A real `organ_id` is not a heading, and this is the check that would
        have caught a validator built for identifiers alone being pointed at
        `isolate_group`.
        """
        real = atlas.structures[0].organ_id
        assert unknown_references(atlas, {"action": "isolate_group", "group": real}) == [real]


class TestAnUnknownActionIsLoud:
    def test_it_raises_rather_than_passing(self, atlas):
        with pytest.raises(UnclassifiedActionError):
            unknown_references(atlas, {"action": "launch_the_missiles"})

    def test_a_missing_action_raises_too(self, atlas):
        with pytest.raises(UnclassifiedActionError):
            unknown_references(atlas, {"organ_id": "whatever"})


class TestItAgreesWithTheAgentOnTheXrayValue:
    """One value, three places, and only two of them can be checked here.

    `scene_tools` needs pydantic-ai and the MCP server's virtualenv does not
    have it, which is why the value lives in this module rather than there.
    That makes this test the only thing standing between an agent's x-ray and
    a reader's looking different from each other.
    """

    def test_the_agent_uses_the_shared_value(self):
        from anatria_engine import scene_tools

        assert scene_tools.XRAY_OPACITY == XRAY_OPACITY

    def test_the_viewer_uses_it_too(self):
        # Read out of the TypeScript rather than restated, so this fails when
        # somebody edits the store instead of when somebody edits a copy of it.
        import re
        from pathlib import Path

        store = Path(__file__).resolve().parents[2] / "src" / "stores" / "sceneStore.ts"
        found = re.search(
            r"export const XRAY_OPACITY = ([0-9.]+);", store.read_text(encoding="utf-8")
        )
        assert found, "sceneStore.ts no longer declares XRAY_OPACITY the way this test reads it"
        assert float(found.group(1)) == XRAY_OPACITY
