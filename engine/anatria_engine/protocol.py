"""Pydantic mirror of the IPC wire format.

The authoritative companion is `src/lib/schemas.ts`. Keep the two in lockstep —
`tests/test_contract.py` and `src/lib/schemas.contract.test.ts` compare the
JSON Schema each side generates and fail loudly when they diverge.

Wire convention: snake_case throughout, so serde (Rust) and Pydantic (Python)
both deserialise without rename shims.

The one asymmetry with the TypeScript file is `AgentRequest.api_key`: Rust
reads the key from the OS keyring and injects it here, on stdin. The frontend
never sees it, so it is absent from the TypeScript request schema by design.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_VERSION = 2
ENGINE_VERSION = "0.1.0"

#: `auto` is not a language, it is the absence of a choice: answer in whatever
#: the reader wrote in. See `_language_rule` in prompts.py.
Language = Literal["auto", "bg", "es", "en"]
UserProfile = Literal["layperson", "student", "clinician"]
GenderModel = Literal["male", "female"]
AiProvider = Literal["anthropic", "openai", "google"]
SectionPlane = Literal["axial", "coronal", "sagittal"]

#: What the assistant is doing this turn.
#:
#: "tutor" answers the question asked. "case" runs a clinical drill: present a
#: scenario, mark the anatomy, ask the student what they would do, then grade
#: the answer rather than supply it. The difference lives in the instructions
#: and one extra tool, so a drill keeps the same scene control and the same
#: safety layer as a lesson.
#:
#: "review" reads a case back: what was presented, what the reader reasoned,
#: and where the gaps are. It writes nothing — the journal's own CHECK
#: constraint allows only 'tutor' and 'case', so a review cannot be filed as a
#: visit even by accident, which is the intent rather than a limitation. A
#: summary is generated prose, and the journal holds what the reader did.
SessionMode = Literal["tutor", "case", "review"]

AnatomicalSystem = Literal[
    "cardiovascular",
    "respiratory",
    "renal",
    "digestive",
    "nervous",
    "endocrine",
    "lymphatic",
    # Bone, muscle and joint are separate systems, not one block: studying
    # the skeleton means seeing the skeleton, with the musculature off.
    "skeletal",
    "muscular",
    "articular",
    "reproductive",
    "integumentary",
    # Surface and regional anatomy, taught alongside the systems.
    "regional",
]

EngineErrorCode = Literal[
    "missing_api_key",
    "invalid_api_key",
    "provider_error",
    "rate_limited",
    # The provider is up but the specific model is saturated (HTTP 503). Its own
    # code because the user's next move is "retry, or pick another model" — not
    # the shrug that "internal error" invites.
    "service_unavailable",
    "guardrail_triggered",
    "invalid_request",
    "internal_error",
]


class Strict(BaseModel):
    """Reject unknown fields so a protocol drift fails here, not three layers up."""

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Anatomy metadata
# ---------------------------------------------------------------------------


class OrganMeta(Strict):
    """One loaded structure, in professional nomenclature only.

    There are no localised labels here by design. Rendering "Ventriculus
    sinister" for a layperson, a medical student and a clinician calls for three
    different explanations in each of BG, ES and EN — that is the agent's job,
    done per turn with the profile in hand, not a frozen lookup table.
    """

    organ_id: str = Field(min_length=1)
    ta2_latin: str = Field(min_length=1)
    name_en: str = Field(min_length=1)
    system: AnatomicalSystem

    def describe(self) -> str:
        """Compact form for the prompt: `organ_id — Latin (English)`."""
        return f"{self.organ_id} — {self.ta2_latin} ({self.name_en})"


class OrganContext(Strict):
    organ_id: str = Field(min_length=1)
    ta2_latin: str = Field(min_length=1)
    name_en: str = Field(min_length=1)
    system: AnatomicalSystem

    def describe(self) -> str:
        return f"{self.ta2_latin} ({self.name_en})"


class CaseComplaint(Strict):
    """Something the reader marked on the body.

    `organ_id` is **where they marked it**, not where the cause is. Referred
    pain runs the wrong way round for a static atlas to teach, and keeping the
    two apart is the whole point of recording one.
    """

    organ_id: str = Field(min_length=1)
    #: The structure's name, so the assistant can speak it without leaking an id.
    label: str = Field(min_length=1)
    symptom: str = Field(min_length=1, max_length=200)
    #: 0–10, the reader's own scale. Absent when it was not asked.
    severity: int | None = Field(default=None, ge=0, le=10)


class CaseVisitSummary(Strict):
    """A past visit, as the current one needs to remember it."""

    visit_no: int = Field(ge=1)
    score: int | None = Field(default=None, ge=0, le=100)
    verdict: str | None = Field(default=None, max_length=4000)


class CaseRecordUpdate(Strict):
    """Something learned about the patient after the case was opened.

    The interval history. `findings` is what was sealed on day one and never
    changes; these accumulate, each stamped with the visit it was known at, so
    a course that developed reads as one — a weight coming down over four
    visits is a different case from a weight that was always low.
    """

    visit_no: int = Field(ge=1)
    body: str = Field(min_length=1, max_length=20_000)


class VirtualPatient(Strict):
    """The simulated patient this drill is a visit to.

    **Nobody described here is real, and the field list is what guarantees it:**
    there is no name, and no free-text identity of any kind, because the journal
    that stores this has no column for one. These are the parameters of a
    teaching scenario.

    Its presence is what stops the safety layer misfiring. Without it the engine
    cannot tell an invented patient from a real one, so a reader typing "he has
    neck pain" gets a refusal that is correct in form and wrong in fact — which
    is exactly what happened before this field existed.
    """

    title: str = Field(min_length=1, max_length=200)
    sex: Literal["male", "female"]
    age_years: int | None = Field(default=None, ge=0, le=130)
    height_cm: int | None = Field(default=None, ge=30, le=260)
    weight_kg: float | None = Field(default=None, gt=0, le=400)
    #: Vitals, history and results the reader is **given**.
    #:
    #: The counterpart to `ground_truth`, and split from it because one field
    #: could not do both jobs: an author wrote "overweight, high blood
    #: pressure" — facts the reader needs to reason at all — into the half that
    #: may never be spoken, and the assistant quoted the seal back to them.
    findings: str = Field(default="", max_length=20_000)
    #: What has been added to the record since, oldest first.
    #:
    #: Given to the reader in the same way `findings` is — these are not
    #: secret. They are separate from it only because they were learned later,
    #: and that ordering is itself clinical information.
    record_updates: list[CaseRecordUpdate] = Field(default_factory=list, max_length=200)
    #: What the case was sealed with, before anything was attempted. The
    #: assistant needs it to keep the course coherent across visits and must
    #: never say it — see the prompt layer, which spends a paragraph on that.
    #:
    #: **May arrive empty, and that is a deliberate act by the caller.** A
    #: review of a case that still has an ungraded visit is sent without it, so
    #: the summary physically cannot contain the answer. What is not given
    #: cannot be leaked, which is a stronger guarantee than an instruction not
    #: to mention it.
    ground_truth: str = Field(default="", max_length=20_000)
    #: Which visit this turn belongs to, counting from one.
    visit_no: int = Field(ge=1)
    #: The presentation so far, oldest first.
    complaints: list[CaseComplaint] = Field(default_factory=list, max_length=200)
    #: Earlier visits, oldest first. Read from the journal, never generated.
    earlier_visits: list[CaseVisitSummary] = Field(default_factory=list, max_length=20)


# ---------------------------------------------------------------------------
# Scene commands
# ---------------------------------------------------------------------------


class FocusOrgan(Strict):
    action: Literal["focus_organ"] = "focus_organ"
    organ_id: str = Field(min_length=1)


class SetLayerVisibility(Strict):
    action: Literal["set_layer_visibility"] = "set_layer_visibility"
    system: AnatomicalSystem
    visible: bool


class SetLayerOpacity(Strict):
    """See through a whole system without switching it off.

    A third state between shown and hidden, and a distinct teaching move:
    ghosting the skin keeps its relationship to the muscles underneath on
    screen, where hiding it throws that relationship away. 1.0 is solid.
    """

    action: Literal["set_layer_opacity"] = "set_layer_opacity"
    system: AnatomicalSystem
    opacity: float = Field(ge=0.0, le=1.0)


class IsolateStructures(Strict):
    action: Literal["isolate_structures"] = "isolate_structures"
    organ_ids: list[str] = Field(min_length=1, max_length=64)


class ApplyPathologyOverlay(Strict):
    action: Literal["apply_pathology_overlay"] = "apply_pathology_overlay"
    organ_id: str = Field(min_length=1)
    pathology: str = Field(min_length=1, max_length=120)
    severity: float = Field(ge=0.0, le=1.0)


class IsolateRegion(Strict):
    """Show a structure with everything anatomically inside it.

    Expanded by the viewer, which holds the manifest hierarchy — sending
    thousands of ancestry paths to the model each turn so it could expand the
    set itself would cost more than the feature is worth.
    """

    action: Literal["isolate_region"] = "isolate_region"
    organ_id: str = Field(min_length=1)


class IsolateGroup(Strict):
    """Show every structure under a named group in the manifest hierarchy.

    Most groups are not structures. The atlas has no mesh called "Kidney" on the
    female body — it is fifty parts under one heading — and 109 of the male
    atlas's 110 groups are the same. The reader has always been able to isolate
    them by right-clicking; without this the assistant could not, so "show me
    the whole kidney" had to be answered by naming fifty ids or not at all.

    Expanded by the viewer, which holds the hierarchy. The name is the key
    because there is no id to use.
    """

    action: Literal["isolate_group"] = "isolate_group"
    group: str = Field(min_length=1)


class ClearPathologyOverlays(Strict):
    action: Literal["clear_pathology_overlays"] = "clear_pathology_overlays"


class HighlightPathway(Strict):
    """Animate a route travelling through an ordered list of structures.

    The one command behind "what happens when you drink a glass of water",
    "trace the blood through the heart", "follow the air to the alveoli" and
    "where does urine go". A physiological process is an *order*, and an order
    is the one thing a static highlight cannot show.

    Generic by design rather than one command per topic: the sequence is data,
    so a new lesson costs nothing. Every id is validated against the loaded
    manifest before this is emitted, so a route can only be built from anatomy
    that is actually on screen.

    Note the absence of defaults on `step_seconds` and `loop`. The tool that
    builds this supplies them; the wire model keeps them required so the
    contract test sees the same optionality on the TypeScript side.
    """

    action: Literal["highlight_pathway"] = "highlight_pathway"
    #: What the route is, for the badge the viewer shows over the canvas.
    label: str = Field(min_length=1, max_length=120)
    #: At least two — a route through one structure is `FocusOrgan`.
    organ_ids: list[str] = Field(min_length=2, max_length=24)
    #: Seconds spent traversing each segment, so the pace can match narration.
    step_seconds: float = Field(ge=0.2, le=10.0)
    loop: bool


class ClearPathway(Strict):
    action: Literal["clear_pathway"] = "clear_pathway"


class IlluminateStructures(Strict):
    """Shine a light on the structures being talked about.

    The quietest thing the assistant can do to the scene: nothing moves, nothing
    is hidden, nothing is claimed to be diseased. It is the difference between
    naming a structure and pointing at it, and it is the only highlight that
    reads *through* a ghosted body — which is where an explanation of what lies
    under what actually happens.

    An empty list turns the light off, so there is no second command for it.
    Unlike the pathology overlays, which accumulate one structure at a time,
    this is always set whole: what is lit is exactly what was last asked for.
    """

    action: Literal["illuminate_structures"] = "illuminate_structures"
    organ_ids: list[str] = Field(max_length=24)


class SetCrossSection(Strict):
    action: Literal["set_cross_section"] = "set_cross_section"
    plane: SectionPlane
    position: float = Field(ge=-1.0, le=1.0)


class ResetView(Strict):
    action: Literal["reset_view"] = "reset_view"


SceneCommand = Annotated[
    FocusOrgan
    | SetLayerVisibility
    | SetLayerOpacity
    | IsolateStructures
    | IsolateRegion
    | IsolateGroup
    | ApplyPathologyOverlay
    | ClearPathologyOverlays
    | HighlightPathway
    | ClearPathway
    | IlluminateStructures
    | SetCrossSection
    | ResetView,
    Field(discriminator="action"),
]


# ---------------------------------------------------------------------------
# Inbound: Rust -> engine (stdin)
# ---------------------------------------------------------------------------


class TranscriptTurn(Strict):
    role: Literal["user", "assistant"]
    content: str


class AgentRequest(Strict):
    kind: Literal["agent_request"] = "agent_request"
    request_id: str = Field(min_length=1)
    query: str = Field(min_length=1, max_length=8000)
    #: Prior turns, oldest first, excluding the one being sent. Without this a
    #: follow-up like "and why?" arrives with no idea what it refers to.
    #:
    #: Required, not defaulted: a client that forgets to send it should fail
    #: loudly here rather than run every turn context-free, which looks like the
    #: model forgetting rather than the frame being wrong.
    history: list[TranscriptTurn] = Field(max_length=100)
    provider: AiProvider
    model: str | None = None
    profile: UserProfile
    language: Language
    gender_model: GenderModel
    #: Lesson or clinical drill — see `SessionMode`.
    mode: SessionMode
    #: Everything the user has selected, in pick order. A list rather than one
    #: structure because comparing is the everyday study move.
    selection: list[OrganContext] = Field(max_length=64)
    available_organs: list[OrganMeta]
    #: Named groups in the manifest hierarchy that can be isolated whole —
    #: "Kidney", "Muscles", "Vertebral column". Names, not ids, because most of
    #: them have neither.
    #:
    #: Defaulted for the usual reason: a new field on an existing event is
    #: optional on the way in, or every frame from an older client fails
    #: validation and is dropped.
    available_groups: list[str] = Field(default_factory=list, max_length=400)
    #: The virtual patient this drill belongs to, when there is one.
    #:
    #: Defaulted, not required — a new field on an existing event is optional on
    #: the way in, or every frame from an older client fails validation and is
    #: dropped. That rule was learned the expensive way when token accounting
    #: vanished for a release.
    case: VirtualPatient | None = None
    # Injected by Rust from the OS keyring — never present on the frontend side.
    api_key: str = Field(min_length=1, repr=False)


class ListModelsRequest(Strict):
    """Ask a provider which models this key can actually use.

    Doubles as key validation: the same call that fills the picker is the one
    that proves the credential works, so there is no separate "test key" path
    that could drift from the real one.
    """

    kind: Literal["list_models"] = "list_models"
    request_id: str = Field(min_length=1)
    provider: AiProvider
    api_key: str = Field(min_length=1, repr=False)


class CancelRequest(Strict):
    kind: Literal["cancel"] = "cancel"
    request_id: str = Field(min_length=1)


class ShutdownRequest(Strict):
    kind: Literal["shutdown"] = "shutdown"


EngineRequest = Annotated[
    AgentRequest | ListModelsRequest | CancelRequest | ShutdownRequest,
    Field(discriminator="kind"),
]


# ---------------------------------------------------------------------------
# Outbound: engine -> Rust (stdout)
# ---------------------------------------------------------------------------


class TokenUsage(Strict):
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class ReadyEvent(Strict):
    type: Literal["ready"] = "ready"
    # No defaults: these always appear on the wire, so the contract test sees
    # them as required on both sides. `ready()` below is the single construction
    # site, so the ergonomic cost is nil.
    protocol_version: int
    engine_version: str

    @staticmethod
    def current() -> ReadyEvent:
        return ReadyEvent(
            protocol_version=PROTOCOL_VERSION, engine_version=ENGINE_VERSION
        )


class TextDeltaEvent(Strict):
    type: Literal["text_delta"] = "text_delta"
    request_id: str
    text: str


class ToolStartedEvent(Strict):
    type: Literal["tool_started"] = "tool_started"
    request_id: str
    tool: str


class SceneCommandEvent(Strict):
    type: Literal["scene_command"] = "scene_command"
    request_id: str
    command: SceneCommand


class ModelInfo(Strict):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    description: str | None = None
    #: True for the entry the engine would pick if none is chosen.
    recommended: bool = False


class ModelsEvent(Strict):
    type: Literal["models"] = "models"
    request_id: str
    provider: AiProvider
    models: list[ModelInfo]


class CaseVerdictEvent(Strict):
    """The grade for a case drill, from the assistant's own evaluation.

    A number rather than prose because it is what lets the journal show
    progress: "eleven cardiac cases, averaging 74" is a fact a student can act
    on, and it cannot be recovered from a paragraph afterwards. The reasoning
    still streams as ordinary text — this is only the part worth storing.
    """

    type: Literal["case_verdict"] = "case_verdict"
    request_id: str
    score: int = Field(ge=0, le=100)
    verdict: str = Field(min_length=1, max_length=4000)


class DoneEvent(Strict):
    """The turn is over, with what it cost and what ran it.

    `model` is the id the SDK was actually given, defaults resolved — not what
    the panel had selected, which is `null` whenever the reader never chose one.
    Both it and `usage` are nullable because a `done` also closes turns that
    never reached a provider, and "we were not told" has to stay distinguishable
    from "this cost nothing": only one of the two belongs in a total.
    """

    type: Literal["done"] = "done"
    request_id: str
    usage: TokenUsage | None
    # Defaulted to match the reader. See the Zod side for why a `done` may
    # never fail to parse: an engine older than the window it is talking to
    # sends this frame without the field, and dropping it would cost the turn
    # its journal entry, its token count and the composer's ready state.
    model: str | None = None


class ErrorEvent(Strict):
    type: Literal["error"] = "error"
    request_id: str | None
    code: EngineErrorCode
    message: str


EngineEvent = Annotated[
    ReadyEvent
    | TextDeltaEvent
    | ToolStartedEvent
    | SceneCommandEvent
    | ModelsEvent
    | CaseVerdictEvent
    | DoneEvent
    | ErrorEvent,
    Field(discriminator="type"),
]
