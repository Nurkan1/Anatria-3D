"""Emit a normalised description of the IPC protocol as JSON.

Run as `python -m anatria_engine.protocol_surface`. The TypeScript contract test
(`tests/protocol-contract.test.ts`) computes the same structure from the Zod
schemas and asserts the two match, so a field added on one side and forgotten
on the other fails a test instead of failing in production.

Comparing full JSON Schema documents from two different generators produces
endless false diffs ($ref styles, metadata, ordering). What actually matters
for drift is narrower and is what this emits: which fields exist, whether each
is required, and what the enum value sets are.

Two fields are excluded from the comparison because they legitimately exist on
only one side:
  - `api_key`, injected by Rust from the OS keyring; the frontend never sees it.
  - `kind`, the request discriminator, also added by Rust.
"""

from __future__ import annotations

import json
import sys
from typing import Any, get_args

from pydantic import BaseModel

from anatria_engine import protocol as p

EXCLUDED_FIELDS = {"api_key", "kind"}


def fields_of(model: type[BaseModel]) -> dict[str, str]:
    return {
        name: ("optional" if not field.is_required() else "required")
        for name, field in model.model_fields.items()
        if name not in EXCLUDED_FIELDS
    }


def variants_of(union: Any, discriminator: str) -> dict[str, dict[str, str]]:
    """Map a discriminated union to {discriminator value: field surface}.

    The discriminator is normalised to "required" on both sides. Here it
    carries a default so events can be constructed as `ReadyEvent()`, which
    makes Pydantic report it as optional; Zod's `z.literal()` reports it as
    required. Neither is wrong — on the wire the field is always present — so
    comparing the raw optionality would just be noise. It stays in the surface
    so a rename or removal is still caught.
    """
    out: dict[str, dict[str, str]] = {}
    # Annotated[A | B, Field(discriminator=...)] -> unwrap to the union itself.
    members = get_args(get_args(union)[0])
    for member in members:
        default = member.model_fields[discriminator].default
        surface = fields_of(member)
        surface[discriminator] = "required"
        out[str(default)] = surface
    return out


def build_surface() -> dict[str, Any]:
    return {
        "enums": {
            "Language": sorted(get_args(p.Language)),
            "UserProfile": sorted(get_args(p.UserProfile)),
            "GenderModel": sorted(get_args(p.GenderModel)),
            "AiProvider": sorted(get_args(p.AiProvider)),
            "SectionPlane": sorted(get_args(p.SectionPlane)),
            "SessionMode": sorted(get_args(p.SessionMode)),
            "AnatomicalSystem": sorted(get_args(p.AnatomicalSystem)),
            "EngineErrorCode": sorted(get_args(p.EngineErrorCode)),
        },
        "models": {
            "OrganMeta": fields_of(p.OrganMeta),
            "OrganContext": fields_of(p.OrganContext),
            "TokenUsage": fields_of(p.TokenUsage),
            "TranscriptTurn": fields_of(p.TranscriptTurn),
            "AgentRequest": fields_of(p.AgentRequest),
            # Nested inside AgentRequest, so joined explicitly: the outer field
            # agreeing on both sides says nothing about the shape it carries.
            "VirtualPatient": fields_of(p.VirtualPatient),
            "CaseComplaint": fields_of(p.CaseComplaint),
            "CaseVisitSummary": fields_of(p.CaseVisitSummary),
            "CaseRecordUpdate": fields_of(p.CaseRecordUpdate),
        },
        "unions": {
            "SceneCommand": variants_of(p.SceneCommand, "action"),
            "EngineEvent": variants_of(p.EngineEvent, "type"),
        },
        "protocol_version": p.PROTOCOL_VERSION,
    }


def main() -> int:
    json.dump(build_surface(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
