"""Writing a teaching case: checked against the atlas before the author sees it."""

from __future__ import annotations

import pytest
from pydantic_ai.models.test import TestModel

from anatria_engine import case_draft
from anatria_engine.case_draft import (
    GeneratedCase,
    GeneratedPath,
    GeneratedStop,
    draft_case,
    find_in,
    to_draft,
    unknown_stops,
)
from anatria_engine.prompts import SAFETY, build_case_draft_instructions
from anatria_engine.protocol import CaseDraftEvent, CaseDraftRequest, OrganMeta

ORGANS = {
    organ.organ_id: organ
    for organ in [
        OrganMeta(organ_id="brachial_plexus_l", ta2_latin="Plexus brachialis",
                  name_en="Brachial plexus", system="nervous"),
        OrganMeta(organ_id="ulnar_nerve_l", ta2_latin="Nervus ulnaris",
                  name_en="Ulnar nerve", system="nervous"),
        OrganMeta(organ_id="little_finger_l", ta2_latin="Digitus minimus manus",
                  name_en="Little finger", system="regional"),
    ]
}


def generated(*stops: str, spread: str = "radiating") -> GeneratedCase:
    return GeneratedCase(
        title=" Numbness in the left hand, 42 ",
        sex="male",
        age_years=42,
        findings="Two months of tingling in the little finger.",
        ground_truth="Compression of the lower trunk (Truncus inferior).",
        path=GeneratedPath(
            label="Neck to little finger",
            spread=spread,  # type: ignore[arg-type]
            trigger="Lifting the arm",
            stops=[GeneratedStop(organ_id=stop, intensity=5) for stop in stops],
        ),
    )


# -- checking against the atlas -----------------------------------------------


def test_a_path_keeps_only_stops_the_atlas_has_and_names_them_from_it() -> None:
    draft = to_draft(generated("brachial_plexus_l", "invented_nerve", "little_finger_l"), ORGANS)
    assert draft.path is not None
    ids = [point.organ_id for point in draft.path.points]
    assert ids == ["brachial_plexus_l", "little_finger_l"]
    labels = [point.label for point in draft.path.points]
    assert labels == ["Plexus brachialis", "Digitus minimus manus"]
    assert draft.title == "Numbness in the left hand, 42"


def test_a_path_left_with_one_real_stop_is_dropped_rather_than_drawn_as_a_stub() -> None:
    draft = to_draft(generated("brachial_plexus_l", "invented_nerve"), ORGANS)
    assert draft.path is None
    # The rest of the case is still usable.
    assert draft.findings.startswith("Two months")


def test_a_multifocal_set_needs_only_one_real_place() -> None:
    draft = to_draft(generated("ulnar_nerve_l", "invented", spread="multifocal"), ORGANS)
    assert draft.path is not None and len(draft.path.points) == 1


def test_a_path_sent_as_a_json_string_is_read_as_the_object_it_describes() -> None:
    # qwen3.5:9b found real ids and then wrapped the whole path in a string.
    case = GeneratedCase.model_validate({
        "title": "Numbness, 42", "sex": "female", "findings": "f", "ground_truth": "g",
        "path": '{"label": "Neck to hand", "spread": "radiating", "stops": '
                '[{"organ_id": "brachial_plexus_l"}, {"organ_id": "ulnar_nerve_l"}]}',
    })
    assert case.path is not None and len(case.path.stops) == 2


def test_the_validator_names_every_invented_stop() -> None:
    assert unknown_stops(generated("brachial_plexus_l", "made_up", "also_made_up"), ORGANS) == [
        "made_up",
        "also_made_up",
    ]


def test_searching_returns_ids_to_use_and_says_when_nothing_matches() -> None:
    assert "ulnar_nerve_l — Nervus ulnaris (Ulnar nerve)" in find_in(ORGANS, "ulnar")
    assert "Nothing loaded matches" in find_in(ORGANS, "pancreas")


# -- the instructions ---------------------------------------------------------


@pytest.mark.parametrize("level", ["preclinical", "clinical"])
def test_safety_comes_first_when_writing_a_case_too(level: str) -> None:
    text = build_case_draft_instructions(profile="student", language="bg", level=level)  # type: ignore[arg-type]
    assert text.startswith(SAFETY)


def test_the_case_is_invented_written_in_the_chosen_language_and_its_stops_are_searched() -> None:
    text = build_case_draft_instructions(profile="student", language="bg", level="clinical")
    assert "**one invented patient**" in text
    assert "no name, no initials, no place" in text
    assert "in Bulgarian (български)" in text
    assert "never invent an id" in text
    assert "Give no medicine names with doses." in text
    # Measured: llama3.1:8b titled a drafted case "Brachial Plexus Compression, 32".
    assert "Never the diagnosis or the structure responsible" in text
    assert "a red flag or a\ndifferential" not in text  # the level line is one sentence
    assert "red flag" in text


def test_an_automatic_language_writes_the_case_in_english() -> None:
    assert "in English." in build_case_draft_instructions(
        profile="student", language="auto", level="preclinical"
    )


# -- the whole run, on a test model -------------------------------------------


def request() -> CaseDraftRequest:
    return CaseDraftRequest(
        request_id="draft-1", provider="anthropic", region="brachial plexus", level="clinical",
        language="es", profile="student", available_organs=list(ORGANS.values()), api_key="test",
    )


def fixed_output(*stops: str) -> TestModel:
    case = generated(*stops)
    return TestModel(call_tools=[], custom_output_args=case.model_dump())


async def test_a_run_returns_a_checked_draft(monkeypatch) -> None:
    model = fixed_output("brachial_plexus_l", "ulnar_nerve_l")
    monkeypatch.setattr(case_draft, "build_model", lambda *_args: model)

    draft, _usage, name = await draft_case(request())

    assert draft.path is not None
    assert [point.label for point in draft.path.points] == ["Plexus brachialis", "Nervus ulnaris"]
    assert name == "claude-sonnet-5"


async def test_a_run_that_keeps_inventing_ids_fails_instead_of_drawing_them(monkeypatch) -> None:
    model = fixed_output("made_up_1", "made_up_2")
    monkeypatch.setattr(case_draft, "build_model", lambda *_args: model)

    with pytest.raises(Exception, match=r"retries|Exceeded"):
        await draft_case(request())


# -- the handler --------------------------------------------------------------


class Recorder:
    def __init__(self) -> None:
        self.events: list[object] = []

    def emit(self, event: object) -> None:
        self.events.append(event)

    def log(self, message: str) -> None:
        pass


async def test_the_handler_sends_the_draft_then_what_it_cost(monkeypatch) -> None:
    from anatria_engine import handlers

    async def fake(_request):
        draft = to_draft(generated("brachial_plexus_l", "ulnar_nerve_l"), ORGANS)
        return draft, None, "claude-sonnet-5"

    monkeypatch.setattr(case_draft, "draft_case", fake)
    recorder = Recorder()
    await handlers.handle_case_draft(request(), recorder)  # type: ignore[arg-type]

    assert [type(event).__name__ for event in recorder.events] == ["CaseDraftEvent", "DoneEvent"]
    assert isinstance(recorder.events[0], CaseDraftEvent)
    assert recorder.events[1].model == "claude-sonnet-5"  # type: ignore[attr-defined]


async def test_the_handler_reports_a_failure_on_the_request(monkeypatch) -> None:
    from anatria_engine import handlers

    async def broken(_request):
        raise RuntimeError("Error code: 401 - invalid x-api-key")

    monkeypatch.setattr(case_draft, "draft_case", broken)
    recorder = Recorder()
    await handlers.handle_case_draft(request(), recorder)  # type: ignore[arg-type]

    assert type(recorder.events[-1]).__name__ == "ErrorEvent"
    assert recorder.events[-1].request_id == "draft-1"  # type: ignore[attr-defined]
