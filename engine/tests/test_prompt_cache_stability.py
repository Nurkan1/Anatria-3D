"""Cache-friendly ordering must not remove anatomy or change safety rules."""

from os.path import commonprefix

import pytest

from anatria_engine.prompts import SAFETY, _groups_rule, build_instructions
from anatria_engine.protocol import OrganContext, OrganMeta


def organ(organ_id: str) -> OrganMeta:
    return OrganMeta(
        organ_id=organ_id, ta2_latin=organ_id, name_en=organ_id, system="skeletal"
    )


@pytest.mark.parametrize("mode", ["tutor", "case", "review"])
def test_equivalent_inventory_has_identical_prompt_regardless_of_input_order(mode):
    kwargs = dict(profile="student", language="en", mode=mode, selection=[])
    first = build_instructions(organs=[organ("a"), organ("b")], groups=["B", "A"], **kwargs)
    second = build_instructions(organs=[organ("b"), organ("a")], groups=["A", "B"], **kwargs)
    assert first == second
    assert first.startswith(SAFETY)
    assert "a — a (a)" in first
    assert "b — b (b)" in first


def test_changing_selection_does_not_invalidate_the_static_group_catalogue():
    kwargs = dict(
        profile="student", language="en", mode="tutor",
        organs=[organ("a"), organ("b")], groups=["A", "B"],
    )
    a = OrganContext(**organ("a").model_dump())
    b = OrganContext(**organ("b").model_dump())
    first = build_instructions(selection=[a], **kwargs)
    second = build_instructions(selection=[b], **kwargs)
    shared = commonprefix([first, second])
    assert _groups_rule(["A", "B"]) in shared
    assert a.describe() in first
    assert b.describe() in second
    assert len(first) == len(second)
