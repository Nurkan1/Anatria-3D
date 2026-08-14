import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AgentRequestSchema,
  CaseComplaintSchema,
  CaseRecordUpdateSchema,
  CaseVisitSummarySchema,
  VirtualPatientSchema,
  AiProviderSchema,
  AnatomicalSystemSchema,
  EngineErrorCodeSchema,
  EngineEventSchema,
  GenderModelSchema,
  LanguageSchema,
  OrganContextSchema,
  OrganMetaSchema,
  PROTOCOL_VERSION,
  SceneCommandSchema,
  SectionPlaneSchema,
  SessionModeSchema,
  TokenUsageSchema,
} from "../src/lib/schemas";

/**
 * The IPC protocol has two owners — Zod in `src/lib/schemas.ts` and Pydantic in
 * `engine/anatria_engine/protocol.py`. Nothing in the type system connects
 * them, so a field added on one side and forgotten on the other would surface
 * as a runtime validation error in a built app. This test is the connection:
 * it derives a normalised surface from each and asserts they match.
 *
 * `kind` and `api_key` are excluded on the Python side (Rust injects both), so
 * they are excluded here too — see `protocol_surface.py`.
 */

type FieldSurface = Record<string, "required" | "optional">;

interface ProtocolSurface {
  enums: Record<string, string[]>;
  models: Record<string, FieldSurface>;
  unions: Record<string, Record<string, FieldSurface>>;
  protocol_version: number;
}

const EXCLUDED_FIELDS = new Set(["api_key", "kind"]);

/** A field is "optional" when the schema accepts `undefined`; nullable is not optional. */
function fieldsOf(schema: z.ZodObject): FieldSurface {
  const surface: FieldSurface = {};
  for (const [name, field] of Object.entries(schema.shape)) {
    if (EXCLUDED_FIELDS.has(name)) continue;
    const accepts = (field as z.ZodType).safeParse(undefined).success;
    surface[name] = accepts ? "optional" : "required";
  }
  return surface;
}

function variantsOf(
  union: z.ZodDiscriminatedUnion,
  discriminator: string,
): Record<string, FieldSurface> {
  const out: Record<string, FieldSurface> = {};
  for (const option of union.options as z.ZodObject[]) {
    const tag = option.shape[discriminator] as z.ZodLiteral<string>;
    // Normalised to "required" on both sides — see `variants_of` in
    // protocol_surface.py for why the raw optionality differs.
    out[String(tag.value)] = { ...fieldsOf(option), [discriminator]: "required" };
  }
  return out;
}

const sorted = (schema: z.ZodEnum<never>): string[] =>
  [...(schema.options as string[])].sort();

function typescriptSurface(): ProtocolSurface {
  return {
    enums: {
      Language: sorted(LanguageSchema as never),
      UserProfile: sorted(z.enum(["layperson", "student", "clinician"]) as never),
      GenderModel: sorted(GenderModelSchema as never),
      AiProvider: sorted(AiProviderSchema as never),
      SectionPlane: sorted(SectionPlaneSchema as never),
      SessionMode: sorted(SessionModeSchema as never),
      AnatomicalSystem: sorted(AnatomicalSystemSchema as never),
      EngineErrorCode: sorted(EngineErrorCodeSchema as never),
    },
    models: {
      OrganMeta: fieldsOf(OrganMetaSchema),
      OrganContext: fieldsOf(OrganContextSchema),
      TokenUsage: fieldsOf(TokenUsageSchema),
      TranscriptTurn: fieldsOf(
        z.object({ role: z.enum(["user", "assistant"]), content: z.string() }),
      ),
      AgentRequest: fieldsOf(AgentRequestSchema),
      // Nested inside AgentRequest. `case` matching on both sides proves
      // nothing about what travels inside it.
      VirtualPatient: fieldsOf(VirtualPatientSchema),
      CaseComplaint: fieldsOf(CaseComplaintSchema),
      CaseVisitSummary: fieldsOf(CaseVisitSummarySchema),
      CaseRecordUpdate: fieldsOf(CaseRecordUpdateSchema),
    },
    unions: {
      SceneCommand: variantsOf(SceneCommandSchema, "action"),
      EngineEvent: variantsOf(EngineEventSchema, "type"),
    },
    protocol_version: PROTOCOL_VERSION,
  };
}

function pythonSurface(): ProtocolSurface {
  const repoRoot = join(import.meta.dirname, "..");
  const candidates = [
    join(repoRoot, ".venv", "Scripts", "python.exe"),
    join(repoRoot, ".venv", "bin", "python"),
  ];
  const python = candidates.find((path) => existsSync(path));
  if (!python) {
    throw new Error(
      `No project virtualenv found. Looked in:\n  ${candidates.join("\n  ")}\n` +
        "Create it with `python -m venv .venv` and `pip install -e engine[dev]`.",
    );
  }

  const stdout = execFileSync(python, ["-m", "anatria_engine.protocol_surface"], {
    cwd: join(repoRoot, "engine"),
    encoding: "utf8",
  });
  return JSON.parse(stdout) as ProtocolSurface;
}

describe("IPC protocol contract", () => {
  const ts = typescriptSurface();
  const py = pythonSurface();

  it("agrees on protocol version", () => {
    expect(ts.protocol_version).toBe(py.protocol_version);
  });

  it("agrees on enum value sets", () => {
    expect(ts.enums).toEqual(py.enums);
  });

  it("agrees on model fields and optionality", () => {
    expect(ts.models).toEqual(py.models);
  });

  it("agrees on scene command variants", () => {
    expect(ts.unions.SceneCommand).toEqual(py.unions.SceneCommand);
  });

  it("agrees on engine event variants", () => {
    expect(ts.unions.EngineEvent).toEqual(py.unions.EngineEvent);
  });

  it("keeps the API key off the frontend request schema", () => {
    // Not a drift check — a standing assertion that the security boundary
    // holds. If `api_key` ever appears here, the key is crossing into the
    // webview's JS context and the keyring design has been defeated.
    expect(Object.keys(AgentRequestSchema.shape)).not.toContain("api_key");
  });
});
