"""Write a teaching case with the assistant, for its author to check before sealing.

# What it is for

A teacher with twenty minutes before a seminar, or a student who wants a case
they have not seen, asks for "brachial plexus, clinical correlation" and gets a
complete virtual patient: the record the student is given, the sealed
explanation, and the symptom path pre-drawn on the body. Nothing is opened or
sealed here. The draft fills the same form a hand-written case uses, and the
author reads it, changes what they like and seals it themselves — the case
stays theirs, and a wrong draft costs an edit, not a wrong lesson.

# Why the path is checked twice

A model asked to name structures will invent plausible ids. A path whose stops
do not exist draws nothing and tells the assistant about structures that are not
there. So the model searches the loaded atlas with `find_structures`, an output
validator sends back any id it did not find, and `to_draft` drops whatever still
gets through. A path with too few real stops left is dropped rather than drawn
as a stub.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, field_validator
from pydantic_ai import Agent, ModelRetry

from anatria_engine.agent import usage_of_result
from anatria_engine.atlas_search import search
from anatria_engine.prompts import build_case_draft_instructions
from anatria_engine.protocol import (
    CaseDraft,
    CaseDraftRequest,
    CasePathPoint,
    DraftPath,
    OrganMeta,
    PathCharacter,
    PathSpread,
    TokenUsage,
)
from anatria_engine.providers import build_model, resolve_model_name

#: How many matches one search returns. Enough to choose from, small enough to read.
SEARCH_LIMIT = 25

#: Retries the model gets to replace ids it invented, or to repair a search.
RETRIES = 2


class GeneratedStop(BaseModel):
    organ_id: str = Field(description="An organ_id returned by find_structures. Never invent one.")
    character: PathCharacter | None = None
    intensity: int | None = Field(default=None, ge=0, le=10)


class GeneratedPath(BaseModel):
    label: str = Field(max_length=120)
    spread: PathSpread
    trigger: str | None = Field(default=None, max_length=200)
    stops: list[GeneratedStop] = Field(min_length=1, max_length=8)


class GeneratedCase(BaseModel):
    """What the model is asked to return. Checked before it becomes a `CaseDraft`."""

    title: str = Field(max_length=120)
    sex: str = Field(pattern="^(male|female)$")
    age_years: int | None = Field(default=None, ge=0, le=110)
    height_cm: int | None = Field(default=None, ge=40, le=230)
    weight_kg: float | None = Field(default=None, gt=2, le=250)
    findings: str = Field(max_length=6000)
    ground_truth: str = Field(max_length=6000)
    path: GeneratedPath | None = None

    @field_validator("path", mode="before")
    @classmethod
    def path_sent_as_text(cls, value: object) -> object:
        """Read a path sent as a JSON string as the object it describes.

        Measured on qwen3.5:9b: it searched the atlas properly, found real ids,
        and then sent the whole path as a string inside the call, which failed
        validation on every retry. The content was right; only the wrapping
        was wrong, and it is a common slip in smaller models.
        """
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value


def unknown_stops(case: GeneratedCase, organs: dict[str, OrganMeta]) -> list[str]:
    """The path's organ ids that are not in the loaded atlas."""
    if case.path is None:
        return []
    return [stop.organ_id for stop in case.path.stops if stop.organ_id not in organs]


def to_draft(case: GeneratedCase, organs: dict[str, OrganMeta]) -> CaseDraft:
    """The draft the form is filled with: real stops only, each with its name."""
    path = None
    if case.path is not None:
        points = [
            CasePathPoint(
                organ_id=stop.organ_id,
                label=organs[stop.organ_id].ta2_latin,
                character=stop.character,
                intensity=stop.intensity,
            )
            for stop in case.path.stops
            if stop.organ_id in organs
        ]
        fewest = 1 if case.path.spread == "multifocal" else 2
        if len(points) >= fewest and case.path.label.strip():
            path = DraftPath(
                label=case.path.label.strip(),
                spread=case.path.spread,
                trigger=(case.path.trigger or "").strip() or None,
                points=points,
            )
    return CaseDraft(
        title=case.title.strip(),
        sex=case.sex,  # type: ignore[arg-type]
        age_years=case.age_years,
        height_cm=case.height_cm,
        weight_kg=case.weight_kg,
        findings=case.findings.strip(),
        ground_truth=case.ground_truth.strip(),
        path=path,
    )


def find_in(organs: dict[str, OrganMeta], query: str) -> str:
    """`find_structures` for the drafter: id, Latin and English per line."""
    found = search(list(organs.values()), query)[:SEARCH_LIMIT]
    if not found:
        return f"Nothing loaded matches {query!r}. Try the Latin or English name of a larger part."
    return "\n".join(f"{organ.organ_id} — {organ.ta2_latin} ({organ.name_en})" for organ in found)


async def draft_case(request: CaseDraftRequest) -> tuple[CaseDraft, TokenUsage | None, str]:
    """One case, written by the model and checked against the atlas."""
    organs = {organ.organ_id: organ for organ in request.available_organs}
    agent: Agent[None, GeneratedCase] = Agent(
        build_model(request.provider, request.api_key, request.model),
        output_type=GeneratedCase,
        instructions=build_case_draft_instructions(
            profile=request.profile, language=request.language, level=request.level
        ),
        retries=RETRIES,
    )

    @agent.tool_plain
    def find_structures(query: str) -> str:
        """Search the loaded atlas by Latin or English name; returns organ_ids for the path."""
        if len(query.strip()) < 2:
            raise ModelRetry("Search for at least two characters.")
        return find_in(organs, query)

    @agent.output_validator
    def stops_must_exist(case: GeneratedCase) -> GeneratedCase:
        unknown = unknown_stops(case, organs)
        if unknown:
            raise ModelRetry(
                "These organ_ids are not in the loaded atlas: "
                + ", ".join(unknown)
                + ". Search for each stop with find_structures and use an id it returns."
            )
        return case

    result = await agent.run(f"Write one teaching case about: {request.region}")
    return (
        to_draft(result.output, organs),
        usage_of_result(result),
        resolve_model_name(request.provider, request.model),
    )
