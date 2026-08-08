"""The instruction layers are load-bearing, so they get asserted like code.

The safety block is what keeps Anatria3D outside EU MDR 2017/745 scope. If it
stops being composed into every turn — any profile, any language — the product's
regulatory classification changes. That is worth a test, not a code review.
"""

from __future__ import annotations

import pytest

from anatria_engine.prompts import CASE, PROFILES, SAFETY, SCENE, build_instructions
from anatria_engine.protocol import (
    Language,
    OrganContext,
    OrganMeta,
    SessionMode,
    UserProfile,
)

PROFILES_ALL: list[UserProfile] = ["layperson", "student", "clinician"]
LANGUAGES_ALL: list[Language] = ["bg", "es", "en"]

ORGANS = [
    OrganMeta(
        organ_id="left_ventricle",
        ta2_latin="Ventriculus sinister",
        name_en="Left ventricle",
        system="cardiovascular",
    )
]


def instructions(
    profile: UserProfile,
    language: Language,
    selection: list[OrganContext] | None = None,
    mode: SessionMode = "tutor",
) -> str:
    return build_instructions(
        profile=profile,
        language=language,
        organs=ORGANS,
        selection=selection or [],
        mode=mode,
    )


@pytest.mark.parametrize("profile", PROFILES_ALL)
@pytest.mark.parametrize("language", LANGUAGES_ALL)
def test_safety_block_is_present_in_every_combination(
    profile: UserProfile, language: Language
) -> None:
    assert SAFETY in instructions(profile, language)


@pytest.mark.parametrize("profile", PROFILES_ALL)
def test_safety_precedes_the_audience_calibration(profile: UserProfile) -> None:
    # Order matters: a later section must not be able to argue its way past a
    # rule the model has already read as absolute. The clinician profile is the
    # one most likely to try.
    text = instructions(profile, "en")
    assert text.index(SAFETY) < text.index(PROFILES[profile])


@pytest.mark.parametrize("profile", PROFILES_ALL)
@pytest.mark.parametrize("language", LANGUAGES_ALL)
def test_scene_control_is_always_instructed(
    profile: UserProfile, language: Language
) -> None:
    # Driving the viewport is the product, not an optional flourish.
    assert SCENE in instructions(profile, language)


@pytest.mark.parametrize("language", LANGUAGES_ALL)
def test_output_language_is_named_explicitly(language: Language) -> None:
    expected = {"bg": "Bulgarian", "es": "Spanish", "en": "English"}[language]
    assert expected in instructions("student", language)


@pytest.mark.parametrize("profile", PROFILES_ALL)
@pytest.mark.parametrize("language", LANGUAGES_ALL)
def test_a_reader_writing_outside_the_three_languages_is_answered_in_theirs(
    profile: UserProfile, language: Language
) -> None:
    # The interface offers three languages; anatomy students do not come in
    # three languages. Someone who reads none of them cannot say so through a
    # dropdown that does not list their language — but they say it by typing.
    #
    # This is not a nicety. The refusal in SAFETY is the sentence that has to
    # land when a reader asks what is wrong with them, and a refusal in a
    # language they do not have is not a refusal.
    text = instructions(profile, language)
    assert "answer in the language they wrote in" in text
    assert "not Bulgarian,\nSpanish or English" in text


@pytest.mark.parametrize("language", LANGUAGES_ALL)
def test_the_chosen_language_still_wins_for_the_three_it_offers(
    language: Language,
) -> None:
    # A reader set to Bulgarian who types a question in English chose Bulgarian
    # deliberately. Mirroring the question there would override a setting
    # instead of filling a gap in it.
    text = instructions("student", language)
    assert "The chosen language wins" in text


@pytest.mark.parametrize("language", LANGUAGES_ALL)
def test_latin_nomenclature_does_not_count_as_the_reader_switching_language(
    language: Language,
) -> None:
    # The single most likely false positive in the whole rule: a student types
    # "Arteria femoralis" and nothing else. That is the atlas's nomenclature,
    # not a request to be answered in Latin.
    text = instructions("student", language)
    assert "Anatomical Latin" in text
    assert "not a request" in text


def test_clinician_profile_still_carries_the_patient_boundary() -> None:
    # Depth is what changes between profiles; the boundary is not negotiable,
    # and the clinician prompt is where it would be tempting to relax it.
    assert "never an" in PROFILES["clinician"].lower()
    assert "assessment of a patient" in PROFILES["clinician"]


def test_scene_inventory_lists_loaded_structures_with_nomenclature() -> None:
    text = instructions("student", "en")
    assert "left_ventricle" in text
    assert "Ventriculus sinister" in text
    assert "Left ventricle" in text


def test_selected_structure_is_named_as_the_subject() -> None:
    context = OrganContext(
        organ_id="left_ventricle",
        ta2_latin="Ventriculus sinister",
        name_en="Left ventricle",
        system="cardiovascular",
    )
    text = instructions("student", "es", selection=[context])
    assert "selected" in text
    assert "Ventriculus sinister" in text


def test_internal_identifiers_are_kept_out_of_user_facing_prose() -> None:
    # organ_ids are tool plumbing. Showing "left_ventricle" to a reader would
    # leak the implementation into the teaching.
    assert "Never show one to" in instructions("layperson", "bg")


# ---------------------------------------------------------------------------
# Case drills
# ---------------------------------------------------------------------------


def test_case_instructions_appear_only_when_a_drill_is_running() -> None:
    assert CASE not in instructions("student", "en", mode="tutor")
    assert CASE in instructions("student", "en", mode="case")


@pytest.mark.parametrize("profile", PROFILES_ALL)
@pytest.mark.parametrize("language", LANGUAGES_ALL)
def test_a_drill_still_carries_the_safety_block(
    profile: UserProfile, language: Language
) -> None:
    # A simulation is the situation most likely to be mistaken for clinical
    # advice, so it is the last place the guardrails may be dropped.
    assert SAFETY in instructions(profile, language, mode="case")


def test_safety_precedes_the_case_rules() -> None:
    # `CASE` grants the model a patient to reason about. It has to read the rule
    # that no real person is ever the subject *before* it reads that grant.
    text = instructions("clinician", "en", mode="case")
    assert text.index(SAFETY) < text.index(CASE)


def test_a_simulated_patient_is_declared_as_invented() -> None:
    assert "invented by you for teaching" in CASE


def test_a_real_person_ends_the_drill() -> None:
    # The failure mode worth naming: a student who slides from "the patient in
    # the case" to "my father last week" must not be answered in character.
    assert "abandon the drill immediately" in CASE
    assert "never the subject of a simulation" in CASE


def test_the_drill_withholds_the_answer() -> None:
    # Without this the model asks its question and then answers it in the same
    # turn, which is a lecture wearing a case's clothes.
    assert "Do not answer your own question" in CASE
    assert "End the turn on the question" in CASE


def test_the_grading_scale_is_pinned_to_bands() -> None:
    # Scores are averaged across drills in the journal, so they have to mean the
    # same thing from one case to the next.
    for band in ("0–40", "41–70", "71–89", "90–100"):
        assert band in CASE
    assert "record_case_verdict" in CASE
    assert "Inflating it to be encouraging" in CASE


def test_multiple_selection_is_framed_as_a_comparison() -> None:
    """Several structures chosen at once is a comparison question, not four."""
    chosen = [
        OrganContext(
            organ_id=f"muscle_{index}",
            ta2_latin=f"Musculus {index}",
            name_en=f"Muscle {index}",
            system="muscular",
        )
        for index in range(4)
    ]
    text = instructions("student", "en", selection=chosen)

    assert "4 structures together" in text
    assert "muscle_0" in text and "muscle_3" in text
    # Without this the model answers about the first one and ignores the rest.
    assert "compare" in text.lower()
