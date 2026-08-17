"""The instruction layers are load-bearing, so they get asserted like code.

The safety block is what keeps Anatria3D outside EU MDR 2017/745 scope. If it
stops being composed into every turn — any profile, any language — the product's
regulatory classification changes. That is worth a test, not a code review.
"""

from __future__ import annotations

import pytest

from anatria_engine.prompts import (
    CASE,
    PROFILES,
    REVIEW,
    SAFETY,
    SCENE,
    build_instructions,
)
from anatria_engine.protocol import (
    CaseComplaint,
    CaseRecordUpdate,
    CaseVisitSummary,
    Language,
    OrganContext,
    OrganMeta,
    SessionMode,
    UserProfile,
    VirtualPatient,
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


# ---------------------------------------------------------------------------
# Which model actually ran the turn
# ---------------------------------------------------------------------------


def test_an_explicit_model_is_used_as_given():
    from anatria_engine.providers import resolve_model_name

    assert resolve_model_name("anthropic", "claude-opus-5") == "claude-opus-5"


def test_no_choice_resolves_to_the_provider_default():
    """The reported model must be the one the SDK was given, not `None`.

    A usage record filed against "whatever the panel had selected" says nothing
    for every turn that took the default — which is most first turns — and a
    consumption panel that cannot name the model it is counting invites the
    reader to attribute the spend to the wrong one.
    """
    from anatria_engine.providers import DEFAULT_MODELS, resolve_model_name

    for provider, default in DEFAULT_MODELS.items():
        assert resolve_model_name(provider, None) == default


# ---------------------------------------------------------------------------
# Automatic answer language
# ---------------------------------------------------------------------------


def test_auto_follows_the_reader_and_names_no_fixed_language():
    """`auto` is the absence of a choice, not a fourth language."""
    from anatria_engine.prompts import _language_rule

    rule = _language_rule("auto")
    assert "the language the reader writes to you in" in rule
    for named in ("Bulgarian", "Spanish (español)", "English)"):
        assert named not in rule


def test_auto_still_carries_the_nomenclature_rules():
    """Once the language is settled, Latin handling is the same either way.

    Guards the shared tail: it was inlined in one branch before `auto` existed,
    and a copy-paste split would have silently dropped it from the new one.
    """
    from anatria_engine.prompts import _language_rule

    for language in ("auto", "bg", "es", "en"):
        rule = _language_rule(language)
        assert "Terminologia Anatomica" in rule
        assert "Never show one to" in rule


def test_a_fixed_language_is_named_and_wins_over_the_question():
    from anatria_engine.prompts import _language_rule

    rule = _language_rule("bg")
    assert "Bulgarian (български)" in rule
    assert "The chosen language wins" in rule


def test_latin_never_switches_the_language_under_either_setting():
    """A message that is only a structure name says nothing about its author."""
    from anatria_engine.prompts import _language_rule

    for language in ("auto", "es"):
        assert "Arteria femoralis" in _language_rule(language)


def test_the_instructions_build_for_every_language_including_auto():
    from anatria_engine.prompts import build_instructions
    from anatria_engine.protocol import OrganMeta

    organs = [
        OrganMeta(
            organ_id="left_ventricle",
            ta2_latin="Ventriculus sinister",
            name_en="Left ventricle",
            system="cardiovascular",
        )
    ]
    for language in ("auto", "bg", "es", "en"):
        text = build_instructions(
            profile="student",
            language=language,
            organs=organs,
            selection=[],
            mode="tutor",
        )
        assert "left_ventricle" in text


# ---------------------------------------------------------------------------
# What is, and is not, a reason to decline
# ---------------------------------------------------------------------------


def test_the_individual_patient_rule_is_still_the_refusal():
    """The guardrail that keeps the product outside MDR scope. Not tunable."""
    assert "cannot assess an individual" in SAFETY
    assert "qualified healthcare professional" in SAFETY
    assert "Never diagnose, triage, or recommend treatment" in SAFETY


def test_an_unrecognised_word_is_read_as_a_typo_not_a_new_subject():
    """Observed: a reader typed "corzano" for "corazón". A weaker model read it
    as "corzo" — roe deer — and opened with "I cannot help with that", refusing
    a question about veterinary medicine that nobody had asked.

    The reader sees an atlas that refuses a heart question because of one
    letter, which reads as fragility rather than as care.
    """
    assert "misspelling" in SAFETY
    assert "nearest anatomical term" in SAFETY
    assert "you will sometimes be refusing a question" in SAFETY


def test_being_off_topic_is_a_redirection_and_not_a_refusal():
    assert "you do not have\n  a refusal to give" in SAFETY
    assert "reserved for the individual-patient rule" in SAFETY


# ---------------------------------------------------------------------------
# The virtual patient layer
# ---------------------------------------------------------------------------

PATIENT = VirtualPatient(
    title="Neck and lumbar pain, 46",
    sex="male",
    age_years=46,
    height_cm=171,
    weight_kg=98,
    ground_truth="L5-S1 disc protrusion with radicular compression.",
    visit_no=2,
    complaints=[
        CaseComplaint(
            organ_id="free_upper_limb_l",
            label="Left upper limb",
            symptom="Pain radiating down the arm",
            severity=7,
        )
    ],
    earlier_visits=[
        CaseVisitSummary(
            visit_no=1,
            score=72,
            verdict="Read the level correctly, missed the radicular pattern.",
        )
    ],
)


def test_the_grade_is_named_as_a_tool_call_and_not_as_output() -> None:
    """A weak model printed the call instead of making it.

    `gemini-3.1-flash-lite` finished a correct evaluation with the literal
    text `{"score": 100, "verdict": "..."}`. The tool was registered and
    available; it simply wrote it. The student saw JSON at the end of their
    feedback, the journal recorded nothing, and the review that followed
    reported — truthfully — that no visit had been graded.
    """
    text = build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="case",
        patient=None,
    )

    assert "is a tool call, not something you write" in text
    assert '{"score": ..., "verdict": ...}' in text
    # And the way out when it genuinely cannot: say so, rather than print it.
    assert "could not record the grade rather than printing it" in text


def test_a_perfect_score_is_defined_by_checking_not_by_being_impressed() -> None:
    # The same run scored 100 on an answer with three real omissions and said
    # "nothing to add". The band already said "nothing important missing";
    # what it lacked was an instruction to go and look before awarding it.
    text = build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="case",
        patient=None,
    )

    assert "Most good answers are 71–89." in text or "Most good answers are 71–89." in text
    assert "name to yourself what a complete answer would have" in text


def test_the_record_is_given_to_the_reader_with_its_visit_stamps() -> None:
    """The interval history, and the order that makes it one.

    A figure that moved between visits is a different case from one that was
    always there, so the stamp has to survive into the prompt — otherwise the
    assistant reads four observations as one contradictory paragraph.
    """
    patient = PATIENT.model_copy(
        update={
            "findings": "BMI 33. BP 158/94.",
            "record_updates": [
                CaseRecordUpdate(visit_no=6, body="Weight down 5 kg on diet."),
                CaseRecordUpdate(visit_no=7, body="BP down to 130/85."),
            ],
        }
    )
    text = build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="case",
        patient=patient,
    )

    assert "Visit 6" in text and "Weight down 5 kg on diet." in text
    assert "Visit 7" in text and "BP down to 130/85." in text
    # Said freely, exactly as the opening findings are: these are what the
    # reader was told, not what the case turns out to be.
    assert "Say these freely too" in text
    assert text.index("BMI 33") < text.index("Weight down 5 kg")


def test_a_case_with_no_interval_history_gains_no_section() -> None:
    # Every layer costs tokens on every turn. An empty heading is a heading
    # the reader pays for on each question for the life of the case.
    assert "Added to the record since" not in with_patient()


def test_an_ungraded_visit_is_named_as_ungraded_not_left_blank() -> None:
    """The defect this fixes told the reader their software was broken.

    A bare bullet reads as missing data, and the assistant said so — "the
    history has not loaded completely" — which sends someone to debug a
    database that is working exactly as designed.
    """
    patient = PATIENT.model_copy(
        update={
            "earlier_visits": [
                CaseVisitSummary(visit_no=1, score=None, verdict=None),
            ]
        }
    )
    text = build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="review",
        patient=patient,
    )

    assert "**Visit 1** — not graded" in text
    assert "not a failure to load" in text
    assert "Never blame the software for a thin file." in text


def with_patient(mode: SessionMode = "case") -> str:
    return build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode=mode,
        patient=PATIENT,
    )


def test_a_case_without_a_patient_is_unchanged():
    """The layer is additive. A drill the assistant invents itself, which is
    every drill that existed before virtual patients, must compose exactly as
    it did."""
    assert instructions("student", "es", mode="case") == build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="case",
        patient=None,
    )


def test_a_virtual_patient_never_reaches_a_tutor_turn():
    # A lesson is not a consultation, and a patient leaking into one would put
    # a sealed answer in front of a reader who never opened a case.
    assert "sealed" not in with_patient(mode="tutor")
    assert PATIENT.ground_truth not in with_patient(mode="tutor")


def test_the_patient_is_declared_invented_before_anything_else():
    """The whole reason this layer exists.

    Observed before it did: a reader working a case typed "he has neck pain and
    an L5 problem" and the assistant refused, told them it could not assess an
    individual, and pointed them at a doctor — about a person who does not
    exist. The safety rule was right; the fact it was reasoning from was not.
    """
    text = with_patient()
    assert "invented for teaching and do not exist" in text
    assert "refusing to is a fault" in text


def test_the_safety_line_is_restated_rather_than_softened():
    # The individual-patient rule is not relaxed by a simulation being open; it
    # is told which side of the line this patient is on. A drill must never
    # become a way to get advice about somebody real.
    text = with_patient()
    assert SAFETY in text
    assert text.index(SAFETY) < text.index("The line that has not moved")
    assert "A drill is never a way in" in text


def test_the_signals_of_a_real_person_are_named_rather_than_guessed_at():
    # Naming them is what stops the model inventing one. It left a working
    # drill once by announcing "you have just described a real person" about a
    # sentence that said nothing of the kind.
    text = with_patient()
    assert "should I be worried" in text
    assert "my father, my patient" in text
    assert "the scan they had yesterday" in text


def test_a_patient_getting_better_is_not_a_real_person():
    """The failure this rule was written for.

    At visit 6 the reader wrote "he seems to be improving with the diet, he has
    lost 5 kg in a week". The assistant answered "you have just described a
    real person" and ended the simulation — about a patient it had invented
    itself, using the one thing a follow-up visit is for.

    A longitudinal case whose patient may not change is not longitudinal.
    """
    text = with_patient()
    assert "course changing between visits" in text
    assert "lost five kilos since the last visit is using the case" in text


def test_an_uncertain_model_asks_instead_of_declaring():
    # The guardrail holds either way — the answer returns it to teaching or
    # takes it out of the simulation. What it may not do is assert something
    # about the reader that it has no way to know.
    text = with_patient()
    assert "ask — do not decide" in text
    assert "is this the case, or someone real?" in text
    assert "no way to support" in text


def test_a_finding_can_be_called_notable_without_making_anyone_real():
    # The clinically useful half of that refusal was worth keeping; only the
    # claim about the reader was not.
    assert "never requires declaring anybody real" in with_patient()


def test_the_sealed_answer_is_given_but_forbidden():
    text = with_patient()
    assert PATIENT.ground_truth in text
    assert "yours to steer by, never to state" in text
    assert "Do not quote it, summarise it" in text


def test_the_presentation_keeps_where_it_was_marked():
    text = with_patient()
    assert "Left upper limb" in text
    assert "free_upper_limb_l" in text
    assert "do not quietly relocate a complaint" in text


def test_earlier_visits_arrive_as_record_not_memory():
    text = with_patient()
    assert "Visit 1" in text
    assert "scored 72/100" in text
    assert "missed the radicular pattern" in text


def test_the_model_is_male_whatever_the_case_says():
    female = PATIENT.model_copy(update={"sex": "female"})
    text = build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="case",
        patient=female,
    )
    assert "Sex: female" in text
    assert "do not describe the model as female" in text


def test_findings_are_given_and_the_answer_is_still_sealed():
    """The failure that split the field in two.

    Observed: an author wrote "overweight, high blood pressure" — facts the
    reader must have to reason at all — into the only field there was, which
    was the sealed one. The assistant handed them over anyway, quoting the seal
    back as "according to the record". The rule was right; the field was wrong.
    """
    patient = PATIENT.model_copy(
        update={"findings": "BMI 33. BP 158/94. Sedentary."}
    )
    text = build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="case",
        patient=patient,
    )

    assert "What is on the record" in text
    assert "BP 158/94" in text
    assert "Say these freely" in text
    # And the two halves are still on opposite sides of the line.
    assert text.index("Say these freely") < text.index("yours to steer by, never to state")


def test_a_case_with_no_findings_gets_no_empty_heading():
    # Every case authored before the split has none, and a heading over nothing
    # invites the model to fill it.
    text = with_patient()
    assert "What is on the record" not in text


def test_the_tool_narration_rule_names_the_artefact_it_produces():
    """Observed in a printed journal, welded together with no spaces:

        …the structures involved:Perfect. Now I will show you:Let me find the
        heart properly:Now I will mark it:

    "Do not narrate the tool calls" alone did not hold. The rule now shows the
    model what the fragments look like once concatenated, and says to emit
    nothing at all until the calls are done.
    """
    assert "welded together" in SCENE
    assert "write nothing at all before or between tool calls" in SCENE
    assert "first words of the answer" in SCENE


# ---------------------------------------------------------------------------
# Review mode
# ---------------------------------------------------------------------------


def review(patient: VirtualPatient | None = None) -> str:
    return build_instructions(
        profile="student",
        language="es",
        organs=ORGANS,
        selection=[],
        mode="review",
        patient=patient,
    )


def test_review_is_not_a_drill():
    # A review reads the file back. Presenting a scenario and asking for an
    # answer would be a second drill wearing a summary's clothes.
    text = review()
    assert REVIEW in text
    assert CASE not in text
    assert "Nothing here is a drill" in text
    assert "do not grade" in text


def test_review_never_reaches_an_ordinary_lesson():
    assert REVIEW not in instructions("student", "es", mode="tutor")
    assert REVIEW not in instructions("student", "es", mode="case")


def test_a_review_summarises_the_case_and_not_the_patient():
    """The distinction that keeps this on the right side of the line.

    "The state of the patient" is a clinical judgement about somebody. "The
    state of the case" is a reading of a record, and it is also the more useful
    of the two for a student.
    """
    text = review()
    assert "summarising **a case**, not assessing a patient" in text
    assert "clinical judgement about" in text
    assert "study aid" in text


def test_the_gaps_are_the_part_worth_reading():
    text = review()
    assert "Where the gaps are" in text
    assert "A gap is more useful to a student than a recap" in text


def test_a_review_may_not_invent_what_the_record_does_not_hold():
    text = review()
    assert "Never invent" in text
    assert "say it is ungraded rather than" in text


def test_a_redacted_review_is_told_the_answer_was_withheld():
    """The seal protects a visit until it is graded, so a case with an ungraded
    visit is reviewed without its answer at all. The prompt has to say the
    answer is absent rather than let the model conclude it was never written.
    """
    open_case = PATIENT.model_copy(update={"ground_truth": ""})
    text = review(open_case)

    assert "The answer is sealed and you do not have it" in text
    assert "Do not reconstruct it" in text
    assert "sealed until the visit is graded" in text
    # And nothing pretending to be the answer is anywhere on the page.
    assert "What this case turned out to be" not in text


def test_a_finished_case_is_reviewed_with_everything():
    text = review(PATIENT)
    assert PATIENT.ground_truth in text
    assert "The answer is sealed and you do not have it" not in text


# ---------------------------------------------------------------------------
# Which body is on screen
# ---------------------------------------------------------------------------


def test_male_is_the_default_body() -> None:
    """A sidecar older than the window it is paired with still gets a body.

    `gender` is defaulted rather than required for the same reason every new
    protocol field is optional on the way in — and the default has to be the
    atlas every build before this one loaded.
    """
    text = build_instructions(
        profile="student",
        language="en",
        organs=[],
        selection=[],
        mode="tutor",
    )
    assert "male atlas is loaded" in text


def test_female_says_what_is_not_loaded() -> None:
    """The whole point of the rule.

    Told only that 219 structures are loaded, the agent reasons from the atlas
    it has always seen and offers to focus a kidney. The tool layer rejects the
    id, and the reader sees an assistant that promised and then did nothing.
    """
    text = build_instructions(
        profile="student",
        language="en",
        organs=[],
        selection=[],
        mode="tutor",
        gender="female",
    )
    assert "It is the **trunk**" in text
    assert "any skeletal muscle or peripheral nerve at all" in text
    # The variants that most look like bugs in the data.
    assert "six lumbar vertebrae" in text
    assert "T12 to L3" in text


def test_female_gives_the_exam_value_before_this_body() -> None:
    """The rule that keeps a reader from being marked wrong.

    This subject's kidneys sit at L1-L5. A reader measuring them on screen and
    writing that down loses the mark, so the agent is told to lead with the
    classical range and describe the body second.
    """
    text = build_instructions(
        profile="student",
        language="en",
        organs=[],
        selection=[],
        mode="tutor",
        gender="female",
    )
    assert "give the classical teaching value first" in text.lower()
    assert text.index("T12 to L3") > text.index("NOT AN AVERAGE")
    # It must still be allowed to teach what it cannot show.
    assert "The limit is on what can be shown" in text


def test_the_body_rule_sits_below_safety() -> None:
    """Safety is absolute and nothing later may argue with it."""
    text = build_instructions(
        profile="student",
        language="en",
        organs=[],
        selection=[],
        mode="tutor",
        gender="female",
    )
    assert text.index("THE BODY ON SCREEN") > text.index("Anatria3D")
