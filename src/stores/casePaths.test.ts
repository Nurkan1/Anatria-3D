import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaseDigest, CaseFile, CasePath } from "@/lib/studyDb";

vi.mock("@/lib/studyDb", () => ({
  listCases: vi.fn(),
  caseDigest: vi.fn(),
  addCasePath: vi.fn(),
  setCasePathActive: vi.fn(),
  deleteCasePath: vi.fn(),
  MAX_VISITS: 20,
  MAX_PATH_POINTS: 12,
}));

const db = vi.mocked(await import("@/lib/studyDb"));
const { useCaseStore, draftProblem, virtualPatientContext } = await import("./caseStore");

const store = () => useCaseStore.getState();

const CASE: CaseFile = {
  id: "c1",
  title: "Neck and arm pain",
  sex: "male",
  age_years: 46,
  height_cm: 171,
  weight_kg: 80,
  findings: "",
  sealed_at: 1_000,
  revealed_at: null,
  profile: "student",
  language: "es",
  created_at: 1_000,
  updated_at: 1_000,
  visit_count: 0,
};

function path(overrides: Partial<CasePath> = {}): CasePath {
  return {
    id: 1,
    kind: "presentation",
    label: "Neck to thumb",
    spread: "radiating",
    trigger: "Worse turning the head",
    reflection: null,
    points: [
      { organ_id: "nervus_spinalis_c6", organ_label: "Nervus spinalis C6", character: "sharp", intensity: 8 },
      { organ_id: "pollex", organ_label: null, character: null, intensity: 3 },
    ],
    active: true,
    session_id: null,
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCaseStore.setState({
    cases: [CASE],
    activeCaseId: "c1",
    symptoms: [],
    visits: [],
    record: [],
    paths: [],
    draft: null,
    feedbackAsk: null,
    error: null,
    loaded: true,
  });
});

describe("drawing a symptom path", () => {
  it("starts at the first structure and adds each next one as the following stop", () => {
    store().addToPath({ organ_id: "nervus_spinalis_c6", organ_label: "C6" });
    store().addToPath({ organ_id: "nervus_radialis", organ_label: "Radial nerve" });
    store().addToPath({ organ_id: "pollex", organ_label: "Thumb" });

    expect(store().draft?.points.map((point) => point.organ_id)).toEqual([
      "nervus_spinalis_c6",
      "nervus_radialis",
      "pollex",
    ]);
    expect(store().draft?.spread).toBe("radiating");
  });

  it("does not add the same structure twice in a row: a step with no length has no direction", () => {
    store().addToPath({ organ_id: "pollex", organ_label: null });
    store().addToPath({ organ_id: "pollex", organ_label: null });
    expect(store().draft?.points).toHaveLength(1);
  });

  it("stops at the journal's limit instead of failing on save", () => {
    for (let index = 0; index < 15; index += 1) {
      store().addToPath({ organ_id: `s${index}`, organ_label: null });
    }
    expect(store().draft?.points).toHaveLength(12);
  });

  it("reorders stops, because the order is the direction", () => {
    store().addToPath({ organ_id: "a", organ_label: null });
    store().addToPath({ organ_id: "b", organ_label: null });
    store().moveDraftPoint(1, -1);
    expect(store().draft?.points.map((point) => point.organ_id)).toEqual(["b", "a"]);
    store().moveDraftPoint(0, -1);
    expect(store().draft?.points.map((point) => point.organ_id)).toEqual(["b", "a"]);
  });

  it("says what is missing before it can be saved", () => {
    store().addToPath({ organ_id: "a", organ_label: null });
    expect(draftProblem(store().draft!)).toBe("A path needs a start and an end.");
    store().updateDraft({ spread: "multifocal" });
    expect(draftProblem(store().draft!)).toBe("Give the path a name.");
    store().updateDraft({ label: "Scattered" });
    expect(draftProblem(store().draft!)).toBeNull();
  });

  it("saves the draft as a presentation, trimmed, and clears it", async () => {
    db.addCasePath.mockResolvedValue(path());
    store().addToPath({ organ_id: "nervus_spinalis_c6", organ_label: "C6" });
    store().addToPath({ organ_id: "pollex", organ_label: "Thumb" });
    store().updateDraftPoint(0, { character: "sharp", intensity: 8 });
    store().updateDraft({ label: "  Neck to thumb ", trigger: "   " });

    await store().savePath();

    expect(db.addCasePath).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: "c1",
        kind: "presentation",
        label: "Neck to thumb",
        trigger: null,
      }),
    );
    expect(db.addCasePath.mock.calls[0]![0].points[0]).toMatchObject({ character: "sharp", intensity: 8 });
    expect(store().draft).toBeNull();
    expect(store().paths).toHaveLength(1);
  });

  it("keeps the draft when the journal refuses it, so nothing drawn is lost", async () => {
    db.addCasePath.mockRejectedValue(new Error("database is locked"));
    store().addToPath({ organ_id: "a", organ_label: null });
    store().addToPath({ organ_id: "b", organ_label: null });
    store().updateDraft({ label: "Path" });

    await expect(store().savePath()).resolves.toBeNull();
    expect(store().draft?.points).toHaveLength(2);
    expect(store().error).toMatch(/locked/);
  });

  it("drops a half-drawn path when the patient changes, so it cannot land on the wrong one", () => {
    store().addToPath({ organ_id: "a", organ_label: null });
    store().select("c2");
    expect(store().draft).toBeNull();
    expect(store().paths).toEqual([]);
  });

  it("switches a path off and back on without losing it", async () => {
    useCaseStore.setState({ paths: [path()] });
    db.setCasePathActive.mockResolvedValue(undefined);
    await store().setPathActive(1, false);
    expect(store().paths[0]!.active).toBe(false);
  });
});

describe("what the assistant is sent", () => {
  function digest(paths: CasePath[]): CaseDigest {
    return { case: CASE, ground_truth: "C6 radiculopathy.", visits: [], symptoms: [], record_updates: [], paths };
  }

  it("sends the paths that are switched on, with a name for every stop", async () => {
    db.caseDigest.mockResolvedValue(digest([path()]));

    const context = await virtualPatientContext("s1", (id) => (id === "pollex" ? "Pollex" : null));

    expect("case" in context && context.case.paths).toEqual([
      {
        label: "Neck to thumb",
        spread: "radiating",
        trigger: "Worse turning the head",
        points: [
          { organ_id: "nervus_spinalis_c6", label: "Nervus spinalis C6", character: "sharp", intensity: 8 },
          { organ_id: "pollex", label: "Pollex", character: null, intensity: 3 },
        ],
      },
    ]);
  });

  it("never sends a path that is switched off, nor a student's hypothesis", async () => {
    db.caseDigest.mockResolvedValue(
      digest([path({ id: 1, active: false }), path({ id: 2, kind: "hypothesis", label: "My guess" })]),
    );

    const context = await virtualPatientContext("s1", () => null);

    expect("case" in context && context.case.paths).toEqual([]);
  });
});

describe("a student's hypothesis", () => {
  it("cannot be saved without the reasoning, which is the half worth answering", () => {
    store().addToPath({ organ_id: "a", organ_label: null });
    store().addToPath({ organ_id: "b", organ_label: null });
    store().updateDraft({ kind: "hypothesis", label: "Lower trunk" });
    expect(draftProblem(store().draft!)).toBe("Say why you think this is the route.");
    store().updateDraft({ reflection: "C8-T1 carry the little finger." });
    expect(draftProblem(store().draft!)).toBeNull();
  });

  it("is saved as a hypothesis with its reasoning, and no trigger", async () => {
    db.addCasePath.mockResolvedValue(path({ kind: "hypothesis" }));
    store().addToPath({ organ_id: "a", organ_label: null });
    store().addToPath({ organ_id: "b", organ_label: null });
    store().updateDraft({ kind: "hypothesis", label: "Lower trunk", trigger: "left over", reflection: " C8-T1. " });

    await store().savePath();

    expect(db.addCasePath).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "hypothesis", trigger: null, reflection: "C8-T1." }),
    );
  });

  it("is asked about through the chat, in the student's own words", () => {
    useCaseStore.setState({
      paths: [path({ id: 4, kind: "hypothesis", label: "Lower trunk", reflection: "C8-T1 carry the little finger." })],
    });
    store().askAboutHypothesis(4);
    expect(store().feedbackAsk?.text).toBe('My hypothesis is "Lower trunk": C8-T1 carry the little finger.');
    const first = store().feedbackAsk?.seq;
    store().askAboutHypothesis(4);
    expect(store().feedbackAsk?.seq).toBe((first ?? 0) + 1);
  });

  it("is never asked about as if a patient's path were a hypothesis", () => {
    useCaseStore.setState({ paths: [path({ id: 5, kind: "presentation" })] });
    store().askAboutHypothesis(5);
    expect(store().feedbackAsk).toBeNull();
  });

  it("is sent beside the presentation, never inside it", async () => {
    db.caseDigest.mockResolvedValue({
      case: CASE, ground_truth: "C8-T1.", visits: [], symptoms: [], record_updates: [],
      paths: [path({ id: 1 }), path({ id: 2, kind: "hypothesis", label: "Lower trunk", reflection: "C8-T1." })],
    });

    const context = await virtualPatientContext("s1", () => null);

    expect("case" in context && context.case.paths.map((entry) => entry.label)).toEqual(["Neck to thumb"]);
    expect("case" in context && context.case.hypotheses).toEqual([
      expect.objectContaining({ label: "Lower trunk", reflection: "C8-T1.", spread: "radiating" }),
    ]);
  });
});
