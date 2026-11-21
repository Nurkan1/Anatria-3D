import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaseDraft } from "@/lib/schemas";

vi.mock("@/lib/ipc", () => ({ draftCase: vi.fn() }));
vi.mock("@/lib/studyDb", () => ({
  listCases: vi.fn(),
  caseDigest: vi.fn(),
  addCasePath: vi.fn(),
  MAX_VISITS: 20,
  MAX_PATH_POINTS: 12,
}));
vi.mock("@/stores/usageStore", () => ({
  useUsageStore: { getState: () => ({ record: usage.record }) },
}));
const usage = vi.hoisted(() => ({ record: vi.fn() }));

const ipc = vi.mocked(await import("@/lib/ipc"));
const db = vi.mocked(await import("@/lib/studyDb"));
const { useCaseStore, CASE_DRAFT_PREFIX } = await import("./caseStore");

const store = () => useCaseStore.getState();

const DRAFT: CaseDraft = {
  title: "Numbness in the left hand, 42",
  sex: "male",
  age_years: 42,
  findings: "Two months of tingling in the little finger.",
  ground_truth: "Compression of the lower trunk.",
  path: {
    label: "Neck to little finger",
    spread: "radiating",
    trigger: "Lifting the arm",
    points: [
      { organ_id: "brachial_plexus_l", label: "Plexus brachialis", intensity: 6 },
      { organ_id: "ulnar_nerve_l", label: "Nervus ulnaris", character: "tingling" },
    ],
  },
};

const ASK = {
  region: "  Brachial plexus ",
  level: "clinical" as const,
  language: "bg" as const,
  profile: "student" as const,
  provider: "anthropic" as const,
  model: "claude-opus-4-7",
  organs: [{ organ_id: "brachial_plexus_l", ta2_latin: "Plexus brachialis", name_en: "Brachial plexus", system: "nervous" as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  ipc.draftCase.mockResolvedValue(undefined);
  store().resetCaseDraft();
  useCaseStore.setState({ activeCaseId: "c1", paths: [] });
});

describe("asking the assistant for a case", () => {
  it("sends the region, level, language and the atlas, under a draft id", async () => {
    await store().requestCaseDraft(ASK);

    const request = ipc.draftCase.mock.calls[0]![0];
    expect(request.request_id.startsWith(CASE_DRAFT_PREFIX)).toBe(true);
    expect(request).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-7",
      region: "Brachial plexus",
      level: "clinical",
      language: "bg",
      profile: "student",
    });
    expect(request.available_organs).toHaveLength(1);
    expect(store().generation.status).toBe("working");
  });

  it("does not ask twice while a draft is being written", async () => {
    await store().requestCaseDraft(ASK);
    await store().requestCaseDraft(ASK);
    expect(ipc.draftCase).toHaveBeenCalledTimes(1);
  });

  it("takes only the draft it asked for last", async () => {
    await store().requestCaseDraft(ASK);
    const id = store().generation.requestId!;

    store().receiveCaseDraft("draft-old", { ...DRAFT, title: "A stale case" });
    expect(store().generation.draft).toBeNull();

    store().receiveCaseDraft(id, DRAFT);
    expect(store().generation).toMatchObject({ status: "ready", draft: DRAFT });
  });

  it("says why when the provider refuses", async () => {
    await store().requestCaseDraft(ASK);
    store().failCaseDraft(store().generation.requestId!, "invalid x-api-key");
    expect(store().generation).toMatchObject({ status: "failed", error: "invalid x-api-key" });
  });

  it("files what a draft cost in Usage, against the provider that wrote it", async () => {
    await store().requestCaseDraft(ASK);
    store().finishCaseDraft(
      store().generation.requestId!,
      { input_tokens: 1200, output_tokens: 800, cache_read_tokens: 0 },
      "claude-opus-4-7",
    );
    expect(usage.record).toHaveBeenCalledWith({
      session_id: null,
      provider: "anthropic",
      model: "claude-opus-4-7",
      input_tokens: 1200,
      output_tokens: 800,
      cache_read_tokens: 0,
    });
  });
});

describe("the path a drafted case comes with", () => {
  it("is drawn on the case it was sealed as, as part of the presentation", async () => {
    db.addCasePath.mockResolvedValue({ id: 9 } as never);

    await store().addGeneratedPath("c1", DRAFT.path!);

    expect(db.addCasePath).toHaveBeenCalledWith({
      case_id: "c1",
      kind: "presentation",
      label: "Neck to little finger",
      spread: "radiating",
      trigger: "Lifting the arm",
      points: [
        { organ_id: "brachial_plexus_l", organ_label: "Plexus brachialis", character: null, intensity: 6 },
        { organ_id: "ulnar_nerve_l", organ_label: "Nervus ulnaris", character: "tingling", intensity: null },
      ],
    });
    expect(store().paths).toHaveLength(1);
  });
});
