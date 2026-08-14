import { z } from "zod";

/**
 * Wire format for the Anatria3D IPC chain: React -> Rust -> Python sidecar.
 *
 * Two rules govern this file and its Pydantic mirror in
 * `engine/anatria_engine/protocol.py`:
 *
 * 1. The wire is snake_case end to end. Rust serde and Pydantic both get the
 *    field names for free, and there is no casing boundary to get wrong.
 * 2. There is no `api_key` field on the frontend request. Rust reads the key
 *    from the OS keyring and injects it when it writes to the sidecar's stdin,
 *    so the key never enters the webview's JS context.
 *
 * `tests/contract.test.ts` diffs the JSON Schema generated from these Zod
 * schemas against the one generated from the Pydantic models. That test is the
 * only thing standing between us and the two sides drifting apart silently.
 */

export const PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * `auto` is not a language. It is the absence of a choice: the assistant
 * answers in whatever the reader wrote in, and keeps doing so.
 */
export const LanguageSchema = z.enum(["auto", "bg", "es", "en"]);
export type Language = z.infer<typeof LanguageSchema>;

export const UserProfileSchema = z.enum(["layperson", "student", "clinician"]);
export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Z-Anatomy ships a male model only. `female` is accepted by the protocol so
 * the schema does not need a breaking change when a female mesh source is
 * procured, but the UI toggle stays disabled until then.
 */
export const GenderModelSchema = z.enum(["male", "female"]);
export type GenderModel = z.infer<typeof GenderModelSchema>;

export const AiProviderSchema = z.enum(["anthropic", "openai", "google"]);
export type AiProvider = z.infer<typeof AiProviderSchema>;

/**
 * What the assistant is doing this turn.
 *
 * `tutor` answers the question that was asked. `case` runs a clinical drill:
 * the assistant presents a scenario, marks the anatomy on the model, and asks
 * the student what they would do — then grades the answer instead of supplying
 * it. The difference is entirely in the instructions and in one extra tool, so
 * a drill keeps the same scene control and the same safety layer as a lesson.
 *
 * `review` reads a case back — what was presented, what was reasoned, where the
 * gaps are. It writes nothing: the journal's `kind` column accepts only `tutor`
 * and `case`, so a review cannot be filed as a visit even by accident. That is
 * the intent. A summary is generated prose, and the journal holds what the
 * reader actually did.
 */
export const SessionModeSchema = z.enum(["tutor", "case", "review"]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/**
 * The modes the journal can actually hold.
 *
 * `review` is missing on purpose, and the SQLite table says the same thing with
 * `CHECK (kind IN ('tutor', 'case'))`. A summary is generated prose; the
 * journal records what the reader did. Stating it in the type means a printed
 * page cannot be asked to label a session kind that can never exist.
 */
export type FiledMode = Exclude<SessionMode, "review">;

export const AnatomicalSystemSchema = z.enum([
  "cardiovascular",
  "respiratory",
  "renal",
  "digestive",
  "nervous",
  "endocrine",
  "lymphatic",
  // Bone, muscle and joint are separate systems, not one block: studying
  // the skeleton means seeing the skeleton, with the musculature off.
  "skeletal",
  "muscular",
  "articular",
  "reproductive",
  "integumentary",
  // Surface and regional anatomy — taught alongside the systems, and 299
  // structures of the atlas would otherwise be dropped.
  "regional",
]);
export type AnatomicalSystem = z.infer<typeof AnatomicalSystemSchema>;

export const SectionPlaneSchema = z.enum(["axial", "coronal", "sagittal"]);
export type SectionPlane = z.infer<typeof SectionPlaneSchema>;

// ---------------------------------------------------------------------------
// Anatomy metadata
// ---------------------------------------------------------------------------

/**
 * One entry per mesh in `public/anatomy/manifest.json`.
 *
 * **Nomenclature is professional-standard only** — Terminologia Anatomica 2
 * Latin plus clinical English. There are deliberately no localised labels here.
 *
 * Translating anatomy is not a lookup, it is an explanation: the right wording
 * for "Ventriculus sinister" differs for a layperson, a medical student and a
 * clinician, and differs again across BG, ES and EN. That is the AI's job, done
 * per turn with the user's profile in hand. Shipping a frozen translation table
 * would produce one wording for all three audiences and leave a pile of
 * unreviewed medical terms in the repo.
 */
export const OrganMetaSchema = z.object({
  organ_id: z.string().min(1),
  ta2_latin: z.string().min(1),
  name_en: z.string().min(1),
  system: AnatomicalSystemSchema,
});
export type OrganMeta = z.infer<typeof OrganMetaSchema>;

/** One structure the user has selected. */
export const OrganContextSchema = z.object({
  organ_id: z.string().min(1),
  ta2_latin: z.string().min(1),
  name_en: z.string().min(1),
  system: AnatomicalSystemSchema,
});
export type OrganContext = z.infer<typeof OrganContextSchema>;

// ---------------------------------------------------------------------------
// Scene commands — what the agent is allowed to do to the viewport
// ---------------------------------------------------------------------------

export const SceneCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("focus_organ"),
    organ_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("set_layer_visibility"),
    system: AnatomicalSystemSchema,
    visible: z.boolean(),
  }),
  /**
   * See through a whole system without switching it off.
   *
   * A third state between shown and hidden, and a distinct teaching move:
   * ghosting the skin keeps the relationship between it and the muscles under
   * it on screen, where hiding it throws that relationship away. `1` is solid.
   */
  z.object({
    action: z.literal("set_layer_opacity"),
    system: AnatomicalSystemSchema,
    opacity: z.number().min(0).max(1),
  }),
  z.object({
    action: z.literal("isolate_structures"),
    organ_ids: z.array(z.string().min(1)).min(1).max(64),
  }),
  /**
   * Show a structure together with everything anatomically inside it — the
   * heart with its chambers and valves, the brain with its lobes.
   *
   * Resolved in the viewer rather than the engine: the hierarchy lives in the
   * manifest, and sending thousands of ancestry paths to the model on every
   * turn to let it expand the set itself would cost more than the feature.
   */
  z.object({
    action: z.literal("isolate_region"),
    organ_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("apply_pathology_overlay"),
    organ_id: z.string().min(1),
    pathology: z.string().min(1).max(120),
    severity: z.number().min(0).max(1),
  }),
  z.object({
    action: z.literal("clear_pathology_overlays"),
  }),
  /**
   * Animate a route travelling through an ordered list of structures.
   *
   * The one command behind "what happens when you drink a glass of water",
   * "trace the blood through the heart", "follow the air to the alveoli" and
   * "where does urine go" — a physiological *process* is an order, and an order
   * is the one thing a static highlight cannot show.
   *
   * Deliberately generic rather than one command per topic: the sequence is
   * data, so a new lesson costs nothing. The engine validates every id against
   * the loaded manifest, so the route can only ever be built from real anatomy.
   *
   * `step_seconds` is the time spent traversing each segment, which is what
   * lets the pace match the narration.
   */
  z.object({
    action: z.literal("highlight_pathway"),
    /** What the route is, for the badge over the canvas. */
    label: z.string().min(1).max(120),
    // At least two: a route through one structure is `focus_organ`. Capped
    // because a "pathway" of forty structures is a tour, and the reader loses
    // the thread long before the marker arrives.
    organ_ids: z.array(z.string().min(1)).min(2).max(24),
    step_seconds: z.number().min(0.2).max(10),
    loop: z.boolean(),
  }),
  z.object({
    action: z.literal("clear_pathway"),
  }),
  /**
   * Shine a light on the structures being talked about.
   *
   * The quietest thing the assistant can do to the scene: nothing moves,
   * nothing is hidden, nothing is claimed to be diseased. It is the difference
   * between naming a structure and pointing at it, and it is the only highlight
   * that reads *through* a ghosted body — which is where an explanation of what
   * lies under what actually happens.
   *
   * An empty list turns the light off, so there is no second command for it.
   * Unlike the pathology overlays, which accumulate one structure at a time,
   * this is always set whole: what is lit is exactly what was last asked for.
   */
  z.object({
    action: z.literal("illuminate_structures"),
    // Capped for the same reason a pathway is: past a couple of dozen, a lit
    // set is a lit body, and the reader learns nothing from being told
    // everything is important.
    organ_ids: z.array(z.string().min(1)).max(24),
  }),
  z.object({
    action: z.literal("set_cross_section"),
    plane: SectionPlaneSchema,
    // Normalised position along the plane's axis, -1 to 1, model-space.
    position: z.number().min(-1).max(1),
  }),
  z.object({
    action: z.literal("reset_view"),
  }),
]);
export type SceneCommand = z.infer<typeof SceneCommandSchema>;

export type SceneCommandAction = SceneCommand["action"];

// ---------------------------------------------------------------------------
// Frontend -> Rust
// ---------------------------------------------------------------------------

export const ChatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/**
 * Note the absence of `api_key`. This is deliberate and load-bearing — see the
 * file header. Rust adds the key on the way to the sidecar.
 */
/**
 * Something the reader marked on the body.
 *
 * `organ_id` is where they marked it, not where the cause is — the assistant is
 * told in as many words not to relocate it to the organ it suspects.
 */
export const CaseComplaintSchema = z.object({
  organ_id: z.string().min(1),
  /** The structure's name, so the assistant can speak it without leaking an id. */
  label: z.string().min(1),
  symptom: z.string().min(1).max(200),
  severity: z.number().int().min(0).max(10).nullable().optional(),
});

/**
 * Something learned about the patient after the case was opened.
 *
 * `findings` is what was sealed on day one. These accumulate beside it, each
 * stamped with the visit it was known at — a weight coming down over four
 * visits is a different case from a weight that was always low.
 */
export const CaseRecordUpdateSchema = z.object({
  visit_no: z.number().int().min(1),
  body: z.string().min(1).max(20_000),
});
export type CaseRecordUpdate = z.infer<typeof CaseRecordUpdateSchema>;

export const CaseVisitSummarySchema = z.object({
  visit_no: z.number().int().min(1),
  score: z.number().int().min(0).max(100).nullable().optional(),
  verdict: z.string().max(4000).nullable().optional(),
});

/**
 * The simulated patient a drill is a visit to.
 *
 * **No name, and no free-text identity of any kind** — the journal behind this
 * has no column for one, so the shape itself is the guarantee.
 *
 * Sending it is what stops the safety layer misfiring. Without it the engine
 * cannot tell an invented patient from a real one, and a reader typing "he has
 * neck pain" is told to see a doctor about someone who does not exist.
 */
export const VirtualPatientSchema = z.object({
  title: z.string().min(1).max(200),
  sex: z.enum(["male", "female"]),
  age_years: z.number().int().min(0).max(130).nullable().optional(),
  height_cm: z.number().int().min(30).max(260).nullable().optional(),
  weight_kg: z.number().positive().max(400).nullable().optional(),
  /**
   * Vitals, history and results the reader is **given**.
   *
   * Split out from the sealed answer because one field could not do both jobs:
   * an author wrote the facts the reader needs to reason at all into the half
   * that may never be spoken, and the assistant handed them over anyway.
   */
  findings: z.string().max(20_000).default(""),
  /**
   * What has been added to the record since, oldest first.
   *
   * Given to the reader exactly as `findings` is — these are not secret. They
   * are separate only because they were learned later, and that ordering is
   * itself clinical information.
   */
  record_updates: z.array(CaseRecordUpdateSchema).max(200).default([]),
  /** Sealed before anything was attempted. The assistant steers by it, never states it. */
  /**
   * May be sent empty, and that is a deliberate act by the caller: a review of
   * a case with an ungraded visit goes without it, so the summary physically
   * cannot contain the answer.
   */
  ground_truth: z.string().max(20_000).default(""),
  visit_no: z.number().int().min(1),
  /** `.default([])` mirrors Pydantic's `default_factory=list`: a field with a
   *  default reads as optional on both sides, and the contract test compares
   *  exactly that. */
  complaints: z.array(CaseComplaintSchema).max(200).default([]),
  earlier_visits: z.array(CaseVisitSummarySchema).max(20).default([]),
});
export type VirtualPatient = z.infer<typeof VirtualPatientSchema>;

export const AgentRequestSchema = z.object({
  request_id: z.string().min(1),
  query: z.string().min(1).max(8000),
  /**
   * Prior turns, oldest first, excluding the one being sent. Without this a
   * follow-up like "and why?" arrives with no idea what it refers to — the
   * panel would look like a chat while behaving like a search box.
   */
  history: z.array(ChatTurnSchema).max(100),
  provider: AiProviderSchema,
  /** Omit to let the engine pick the provider's current default model. */
  model: z.string().min(1).optional(),
  profile: UserProfileSchema,
  language: LanguageSchema,
  gender_model: GenderModelSchema,
  /** Lesson or clinical drill — see `SessionModeSchema`. */
  mode: SessionModeSchema,
  /**
   * Everything the user currently has selected, in the order they picked it.
   *
   * A list rather than one structure because comparing is the everyday study
   * move — "how do these four rotator cuff muscles differ?" — and a single-
   * context protocol forces that into four separate questions.
   */
  selection: z.array(OrganContextSchema).max(64),
  /**
   * The organs actually loaded in the scene right now. The agent's tools
   * validate every organ_id against this list, so it cannot invent anatomy.
   */
  available_organs: z.array(OrganMetaSchema),
  /**
   * The virtual patient this drill belongs to, when there is one.
   *
   * Optional on purpose, and the Pydantic side defaults it the same way: a new
   * field on an existing event must be optional on the way in, or every frame
   * from a build that predates it fails validation and is silently dropped.
   */
  case: VirtualPatientSchema.optional(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

/**
 * Ask a provider which models the stored key can actually use.
 *
 * Doubles as key validation: the call that fills the picker is the call that
 * proves the credential works, so there is no separate "test key" path that
 * could drift from the real one.
 */
export const ListModelsRequestSchema = z.object({
  request_id: z.string().min(1),
  provider: AiProviderSchema,
});
export type ListModelsRequest = z.infer<typeof ListModelsRequestSchema>;

export const ModelInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  /** The entry the engine would pick if none is chosen. */
  recommended: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

// ---------------------------------------------------------------------------
// Python -> Rust -> Frontend (events)
// ---------------------------------------------------------------------------

export const TokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Error codes the engine can report. Kept as a closed set so the UI can render
 * a translated, actionable message instead of leaking a Python traceback.
 */
export const EngineErrorCodeSchema = z.enum([
  "missing_api_key",
  "invalid_api_key",
  "provider_error",
  "rate_limited",
  /**
   * The provider is up but the chosen model is saturated (HTTP 503). Its own
   * code because the user's next move is "retry, or pick another model" — not
   * the shrug that "internal error" invites.
   */
  "service_unavailable",
  "guardrail_triggered",
  "invalid_request",
  "internal_error",
]);
export type EngineErrorCode = z.infer<typeof EngineErrorCodeSchema>;

export const EngineEventSchema = z.discriminatedUnion("type", [
  /** Handshake, emitted once when the sidecar finishes booting. */
  z.object({
    type: z.literal("ready"),
    protocol_version: z.number().int(),
    engine_version: z.string(),
  }),
  z.object({
    type: z.literal("text_delta"),
    request_id: z.string(),
    text: z.string(),
  }),
  /** Surfaced so the chat panel can show "focusing left ventricle…". */
  z.object({
    type: z.literal("tool_started"),
    request_id: z.string(),
    tool: z.string(),
  }),
  z.object({
    type: z.literal("scene_command"),
    request_id: z.string(),
    command: SceneCommandSchema,
  }),
  z.object({
    type: z.literal("models"),
    request_id: z.string(),
    provider: AiProviderSchema,
    models: z.array(ModelInfoSchema),
  }),
  /**
   * The grade for a case drill, emitted by the assistant's own tool once it has
   * evaluated the student's answer.
   *
   * A number rather than prose because it is what makes the journal show
   * progress: "you have run eleven cardiac cases, averaging 74" is a fact a
   * student can act on, and it cannot be recovered from a paragraph after the
   * fact. The reasoning still streams as text — this is the part worth storing.
   */
  z.object({
    type: z.literal("case_verdict"),
    request_id: z.string(),
    score: z.number().int().min(0).max(100),
    verdict: z.string().min(1).max(4000),
  }),
  /**
   * The turn is over, with what it cost and what ran it.
   *
   * `model` is the id the engine actually sent to the provider, defaults
   * resolved — not what the panel had selected, which is null whenever the
   * reader never chose one. Both fields are nullable because a `done` also
   * closes work that never reached a provider, and "we were not told" must stay
   * distinguishable from "this cost nothing".
   *
   * `model` is **defaulted, not required**, and that is load-bearing. A `done`
   * is the one frame that must never be dropped: it clears the composer, files
   * the turn in the journal and records what it cost, so a validation failure
   * here does not degrade anything — it loses all three at once and leaves the
   * send button stuck on "Stop". A build whose sidecar is older than its window
   * (the Tauri build does not rebuild the engine) sends this frame without the
   * field, and it must still parse. **New fields on an event are optional on
   * the way in, always.**
   */
  z.object({
    type: z.literal("done"),
    request_id: z.string(),
    usage: TokenUsageSchema.nullable(),
    model: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal("error"),
    request_id: z.string().nullable(),
    code: EngineErrorCodeSchema,
    message: z.string(),
  }),
]);
export type EngineEvent = z.infer<typeof EngineEventSchema>;

export type EngineEventType = EngineEvent["type"];

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Each organ names the .glb it lives in and its node within that file, so one
 * file can hold a whole system (which is what a Blender export produces
 * naturally) and the loader groups by `mesh_file`. Adding a second system later
 * needs no schema change.
 *
 * Note this shape is TypeScript-only — the Python engine reasons about organ
 * identity and labels, never about geometry — so it is outside the scope of the
 * cross-language contract test.
 */
export const ManifestOrganSchema = OrganMetaSchema.extend({
  mesh_file: z.string().min(1),
  node: z.string().min(1),
  /**
   * Anatomical ancestry, outermost first — `["Heart", "Left ventricle"]`.
   *
   * Taken from Z-Anatomy's own collection nesting, which *is* the anatomical
   * hierarchy. It is what lets a reader study an organ together with
   * everything inside it rather than as one opaque shell.
   */
  path: z.array(z.string()),
});

/**
 * One anatomical system, packaged as a single .glb.
 *
 * A system does not own a single mesh file. Z-Anatomy's own top-level
 * collections are flat, so structures belonging to one system can arrive from
 * more than one export — the files a system needs are derived from its organs
 * instead of declared here. The viewer fetches only the files the visible
 * systems actually reference.
 */
export const AnatomySystemSchema = z.object({
  system: AnatomicalSystemSchema,
  organ_count: z.number().int().nonnegative(),
  /** Fetched at startup. Everything else loads on demand. */
  load_on_start: z.boolean(),
});
export type AnatomySystem = z.infer<typeof AnatomySystemSchema>;

export const AnatomyManifestSchema = z.object({
  version: z.number().int(),
  gender_model: GenderModelSchema,
  /** Attribution is a CC BY-SA 4.0 obligation, so it travels with the data. */
  attribution: z.string(),
  license: z.string(),
  systems: z.array(AnatomySystemSchema).min(1),
  organs: z.array(ManifestOrganSchema),
});
export type AnatomyManifest = z.infer<typeof AnatomyManifestSchema>;
export type ManifestOrgan = z.infer<typeof ManifestOrganSchema>;
