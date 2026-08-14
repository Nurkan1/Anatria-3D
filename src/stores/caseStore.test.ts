import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaseFile, CaseSymptom } from "@/lib/studyDb";

vi.mock("@/lib/studyDb", () => ({
  listCases: vi.fn(),
  caseDigest: vi.fn(),
  createCase: vi.fn(),
  deleteCase: vi.fn(),
  revealCaseAnswer: vi.fn(),
  caseSymptoms: vi.fn(),
  addCaseSymptom: vi.fn(),
  deleteCaseSymptom: vi.fn(),
  addCaseFinding: vi.fn(),
  caseFindings: vi.fn(),
  deleteCaseFinding: vi.fn(),
  MAX_VISITS: 20,
}));

const db = vi.mocked(await import("@/lib/studyDb"));
const {
  useCaseStore,
  isFull,
  visitLabel,
  activeCase,
  matchesQuery,
  reviewMaySeeTheAnswer,
  reviewReadiness,
} = await import("./caseStore");

const store = () => useCaseStore.getState();

const CASE: CaseFile = {
  id: "c1",
  title: "Chest pain",
  sex: "female",
  age_years: 58,
  height_cm: 164,
  weight_kg: 71.5,
  findings: "BMI 26. BP 158/94.",
  sealed_at: 1_000,
  revealed_at: null,
  profile: "student",
  language: "es",
  created_at: 1_000,
  updated_at: 1_000,
  visit_count: 0,
};

const SYMPTOM: CaseSymptom = {
  id: 1,
  organ_id: "free_upper_limb_l",
  organ_label: "Left upper limb",
  symptom: "Pain radiating down the arm",
  severity: 7,
  session_id: null,
  created_at: 1_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  useCaseStore.setState({
    cases: [],
    activeCaseId: null,
    symptoms: [],
    visits: [],
    record: [],
    error: null,
    loaded: false,
  });
  db.listCases.mockResolvedValue([]);
  db.caseSymptoms.mockResolvedValue([]);
  db.caseDigest.mockResolvedValue(null);
});

describe("case store", () => {
  it("never throws a failed read into the rest of the app", async () => {
    // The atlas and the assistant work with no journal at all. A locked file
    // should cost the reader their cases, not their lesson.
    db.listCases.mockRejectedValue(new Error("database is locked"));

    await expect(store().refresh()).resolves.toBeUndefined();
    expect(store().error).toBe("database is locked");
    expect(store().loaded).toBe(true);
  });

  it("makes a newly opened case the active one", async () => {
    db.createCase.mockResolvedValue(CASE);

    const opened = await store().open({
      id: "c1",
      title: "Chest pain",
      sex: "female",
      findings: "BMI 26.",
      ground_truth: "Inferior myocardial infarction.",
      profile: "student",
      language: "es",
    });

    expect(opened?.id).toBe("c1");
    expect(store().activeCaseId).toBe("c1");
    expect(store().cases).toHaveLength(1);
  });

  it("reports a refused case rather than pretending it opened", async () => {
    db.createCase.mockRejectedValue(new Error("a case cannot be sealed without its answer"));

    const opened = await store().open({
      id: "c1",
      title: "",
      sex: "female",
      findings: "BMI 26.",
      ground_truth: "  ",
      profile: "student",
      language: "es",
    });

    expect(opened).toBeNull();
    expect(store().activeCaseId).toBeNull();
    expect(store().error).toMatch(/sealed without its answer/);
  });

  it("clears the previous presentation when another case is selected", async () => {
    // Complaints belong to a patient. Carrying them across would show one
    // case's symptoms on another, which is worse than showing none.
    useCaseStore.setState({ activeCaseId: "c1", symptoms: [SYMPTOM] });

    store().select("c2");

    expect(store().symptoms).toEqual([]);
    expect(store().activeCaseId).toBe("c2");
  });

  it("going back to one-off drills reads nothing", async () => {
    store().select(null);

    expect(store().activeCaseId).toBeNull();
    expect(db.caseSymptoms).not.toHaveBeenCalled();
  });

  it("keeps a marked complaint in the order it was reported", async () => {
    useCaseStore.setState({ activeCaseId: "c1", symptoms: [SYMPTOM] });
    const later: CaseSymptom = { ...SYMPTOM, id: 2, symptom: "Breathlessness" };
    db.addCaseSymptom.mockResolvedValue(later);

    await store().mark({ case_id: "c1", organ_id: "thorax", symptom: "Breathlessness" });

    expect(store().symptoms.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("a refused mark leaves the presentation untouched", async () => {
    useCaseStore.setState({ activeCaseId: "c1", symptoms: [SYMPTOM] });
    db.addCaseSymptom.mockRejectedValue(new Error("severity must be between 0 and 10"));

    const marked = await store().mark({
      case_id: "c1",
      organ_id: "thorax",
      symptom: "Pain",
      severity: 50,
    });

    expect(marked).toBeNull();
    expect(store().symptoms).toHaveLength(1);
    expect(store().error).toMatch(/between 0 and 10/);
  });

  it("deleting the active case drops its presentation and goes back to one-off", async () => {
    useCaseStore.setState({ cases: [CASE], activeCaseId: "c1", symptoms: [SYMPTOM] });
    db.deleteCase.mockResolvedValue(undefined);

    await store().remove("c1");

    expect(store().cases).toEqual([]);
    expect(store().activeCaseId).toBeNull();
    expect(store().symptoms).toEqual([]);
  });

  it("deleting another case leaves the active one alone", async () => {
    const other: CaseFile = { ...CASE, id: "c2" };
    useCaseStore.setState({ cases: [CASE, other], activeCaseId: "c1", symptoms: [SYMPTOM] });
    db.deleteCase.mockResolvedValue(undefined);

    await store().remove("c2");

    expect(store().activeCaseId).toBe("c1");
    expect(store().symptoms).toHaveLength(1);
  });

  it("returns the answer and reloads, so the case reads as opened", async () => {
    // The journal stamps `revealed_at` on the way out, and the panel decides
    // what to offer from it. Without the reload the button would still say
    // "reveal" on a case that is already open.
    useCaseStore.setState({ cases: [CASE] });
    db.revealCaseAnswer.mockResolvedValue("Inferior myocardial infarction.");
    db.listCases.mockResolvedValue([{ ...CASE, revealed_at: 2_000 }]);

    const answer = await store().reveal("c1");

    expect(answer).toMatch(/myocardial/);
    expect(store().cases[0]?.revealed_at).toBe(2_000);
  });

  it("never reveals as a side effect of listing or opening a case", async () => {
    // The guarantee the seal actually rests on: only the deliberate call
    // reads `ground_truth`, and it is the only one that stamps.
    useCaseStore.setState({ activeCaseId: "c1" });

    await store().refresh();

    expect(db.revealCaseAnswer).not.toHaveBeenCalled();
  });
});

describe("case helpers", () => {
  it("counts the next visit, not the last", () => {
    expect(visitLabel({ ...CASE, visit_count: 0 })).toBe("visit 1");
    expect(visitLabel({ ...CASE, visit_count: 2 })).toBe("visit 3");
  });

  it("calls a case complete once it has no room left", () => {
    expect(isFull({ ...CASE, visit_count: 19 })).toBe(false);
    expect(isFull({ ...CASE, visit_count: 20 })).toBe(true);
    expect(visitLabel({ ...CASE, visit_count: 20 })).toBe("complete");
  });

  it("resolves the active case, and nothing when there is none", () => {
    expect(activeCase({ ...store(), cases: [CASE], activeCaseId: "c1" })?.id).toBe("c1");
    expect(activeCase({ ...store(), cases: [CASE], activeCaseId: null })).toBeUndefined();
  });
});

describe("the record the panel is given", () => {
  const digest = {
    case: CASE,
    ground_truth: "Inferior myocardial infarction; atypical presentation.",
    visits: [
      {
        session_id: "v1",
        visit_no: 1,
        score: 72,
        verdict: "Read the ischaemia, missed the timing.",
        structures: [],
        created_at: 1_000,
      },
    ],
    symptoms: [SYMPTOM],
    record_updates: [
      { id: 1, visit_no: 2, body: "Weight down 5 kg. BP 130/85.", created_at: 2_000 },
    ],
  };

  it("never takes the sealed answer into the store", async () => {
    // The strongest form of the rule: what the panel is never handed, it can
    // never render. Filtering at each render site would rely on remembering.
    useCaseStore.setState({ activeCaseId: "c1" });
    db.caseDigest.mockResolvedValue(digest);

    await store().refresh();

    const held = JSON.stringify({
      cases: store().cases,
      symptoms: store().symptoms,
      visits: store().visits,
    });
    expect(held).not.toContain("myocardial");
  });

  it("carries the visits and the presentation", async () => {
    useCaseStore.setState({ activeCaseId: "c1" });
    db.caseDigest.mockResolvedValue(digest);

    await store().refresh();

    expect(store().visits.map((visit) => visit.visit_no)).toEqual([1]);
    expect(store().visits[0]?.score).toBe(72);
    expect(store().symptoms).toHaveLength(1);
  });

  it("reads no history at all with no patient open", async () => {
    await store().refresh();

    expect(db.caseDigest).not.toHaveBeenCalled();
    expect(store().visits).toEqual([]);
  });

  it("empties the record when the reader leaves the patient", () => {
    useCaseStore.setState({ activeCaseId: "c1", symptoms: [SYMPTOM], visits: digest.visits });

    store().select(null);

    expect(store().visits).toEqual([]);
    expect(store().symptoms).toEqual([]);
  });
});

describe("matchesQuery", () => {
  const named = (title: string): CaseFile => ({ ...CASE, title });

  it("shows everything when nothing has been typed", () => {
    expect(matchesQuery(named("Chest pain"), "")).toBe(true);
    expect(matchesQuery(named("Chest pain"), "   ")).toBe(true);
  });

  it("ignores case and matches anywhere in the title", () => {
    expect(matchesQuery(named("Chest pain, 58"), "CHEST")).toBe(true);
    expect(matchesQuery(named("Chest pain, 58"), "pain")).toBe(true);
    expect(matchesQuery(named("Chest pain, 58"), "58")).toBe(true);
  });

  it("finds an accented title from an unaccented search, and the reverse", () => {
    // The reader types in a hurry, in Spanish, with a 3D model in front of
    // them. A search that only works when both spellings agree fails exactly
    // when it is needed.
    expect(matchesQuery(named("Dolor cardíaco"), "cardiaco")).toBe(true);
    expect(matchesQuery(named("Dolor cardiaco"), "cardíaco")).toBe(true);
    expect(matchesQuery(named("Migraña"), "migrana")).toBe(true);
  });

  it("says no when it means no", () => {
    expect(matchesQuery(named("Chest pain"), "abdomen")).toBe(false);
  });

  it("does not search the findings", () => {
    // They run to a paragraph of vitals. A search for "hypertension" that
    // returned every case mentioning blood pressure would be a list, not an
    // answer.
    const entry = { ...CASE, title: "Chest pain", findings: "BP 158/94, hypertension" };
    expect(matchesQuery(entry, "hypertension")).toBe(false);
  });
});

describe("reviewMaySeeTheAnswer", () => {
  const visit = (visit_no: number, score: number | null) => ({
    session_id: `v${visit_no}`,
    visit_no,
    score,
    verdict: score === null ? null : "Read it correctly.",
    structures: [],
    created_at: 1_000,
  });

  it("keeps the answer sealed while any visit is unattempted", () => {
    // The reader has a question in front of them that they have not answered.
    // A summary quoting the verdicts would answer it for them.
    expect(reviewMaySeeTheAnswer([visit(1, 72), visit(2, null)])).toBe(false);
    expect(reviewMaySeeTheAnswer([visit(1, null)])).toBe(false);
  });

  it("opens it once every visit has been graded", () => {
    // Grading already states the reasoning the reader should have reached —
    // the drill prompt requires the verdict to. Withholding the sealed answer
    // afterwards protects nothing and makes the summary worse.
    expect(reviewMaySeeTheAnswer([visit(1, 72), visit(2, 88)])).toBe(true);
  });

  it("opens once the reader has deliberately looked, whatever the grades say", () => {
    // The door added after measuring the grading rule against a real journal:
    // 1 visit graded out of 13, because most visits are conversations rather
    // than examinations and will never carry a score. A rule that is correct
    // and never fires protects nothing.
    expect(reviewMaySeeTheAnswer([visit(1, null)], 1_700_000_000_000)).toBe(true);
    expect(reviewMaySeeTheAnswer([], 1_700_000_000_000)).toBe(true);
  });

  it("stays shut while nobody has looked and nothing is graded", () => {
    // `null` is sealed, and it is the default — a caller that forgets to pass
    // the stamp gets the strict answer, never the permissive one.
    expect(reviewMaySeeTheAnswer([visit(1, null)], null)).toBe(false);
    expect(reviewMaySeeTheAnswer([visit(1, null)])).toBe(false);
  });

  it("treats a case with no visits as still sealed", () => {
    // Nothing has been attempted at all, which is the strongest reason of any
    // to keep it shut.
    expect(reviewMaySeeTheAnswer([])).toBe(false);
  });

  it("counts a zero as a grade, not as an absence", () => {
    // A student who scored nothing has still answered, and `0` is falsy in a
    // way that has bitten this kind of check before.
    expect(reviewMaySeeTheAnswer([visit(1, 0)])).toBe(true);
  });
});

describe("the record that accrues", () => {
  const ENTRY = { id: 1, visit_no: 3, body: "Weight down 5 kg.", created_at: 2_000 };

  it("appends rather than replacing", async () => {
    // The rule the whole feature rests on. An answer given at visit 3 has to
    // be readable against what visit 3 had been told.
    useCaseStore.setState({ activeCaseId: "c1", record: [ENTRY] });
    db.addCaseFinding.mockResolvedValue({ ...ENTRY, id: 2, body: "BP 130/85." });

    await store().note("BP 130/85.");

    expect(store().record.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("refuses a blank entry without troubling the journal", async () => {
    // A blank row in a medical record is worse than none: it reads as an
    // observation that was made and found to be nothing.
    useCaseStore.setState({ activeCaseId: "c1" });

    await expect(store().note("   ")).resolves.toBeNull();
    expect(db.addCaseFinding).not.toHaveBeenCalled();
  });

  it("writes nothing when no case is open", async () => {
    await expect(store().note("Weight down 5 kg.")).resolves.toBeNull();
    expect(db.addCaseFinding).not.toHaveBeenCalled();
  });

  it("trims before it stores", async () => {
    useCaseStore.setState({ activeCaseId: "c1" });
    db.addCaseFinding.mockResolvedValue(ENTRY);

    await store().note("  Weight down 5 kg.\n");

    expect(db.addCaseFinding).toHaveBeenCalledWith({
      case_id: "c1",
      body: "Weight down 5 kg.",
    });
  });

  it("a refused write leaves the record untouched", async () => {
    useCaseStore.setState({ activeCaseId: "c1", record: [ENTRY] });
    db.addCaseFinding.mockRejectedValue(new Error("database is locked"));

    await expect(store().note("BP 130/85.")).resolves.toBeNull();
    expect(store().record).toHaveLength(1);
    expect(store().error).toMatch(/locked/);
  });

  it("switching patients drops the previous one's record", async () => {
    // Same rule as the complaints: showing one patient's history under another
    // is worse than showing none.
    useCaseStore.setState({ activeCaseId: "c1", record: [ENTRY] });

    store().select("c2");

    expect(store().record).toEqual([]);
  });

  it("never lets the sealed answer in beside it", async () => {
    // The record is given to the reader; the answer is not. They arrive on the
    // same digest, so this is where a careless destructure would leak.
    useCaseStore.setState({ activeCaseId: "c1" });
    db.caseDigest.mockResolvedValue({
      case: CASE,
      ground_truth: "Inferior myocardial infarction.",
      visits: [],
      symptoms: [],
      record_updates: [ENTRY],
    });

    await store().refresh();

    expect(store().record).toHaveLength(1);
    expect(JSON.stringify(store().record)).not.toContain("myocardial");
  });
});

describe("reviewReadiness", () => {
  const visit = (visit_no: number, score: number | null) => ({
    session_id: `v${visit_no}`,
    visit_no,
    score,
    verdict: score === null ? null : "Read it correctly.",
    structures: [],
    created_at: 1_000,
  });

  it("counts what the summary will be built from", () => {
    const file = reviewReadiness(CASE, [SYMPTOM], [visit(1, 80), visit(2, null)]);

    expect(file).toEqual({
      ungraded: 1,
      visits: 2,
      complaints: 1,
      updates: 0,
      bare: false,
    });
  });

  it("reports a case opened before findings existed as bare", () => {
    // The panel says so before the reader spends a question on a summary that
    // has the complaints, the visit count and nothing else to reason from.
    expect(reviewReadiness({ ...CASE, findings: "" }, [SYMPTOM], []).bare).toBe(true);
  });

  it("stops calling it bare once the record has been caught up", () => {
    // The way out of a pre-v7 case, and the reason the warning must read the
    // record and not just the sealed opening.
    const caught = reviewReadiness({ ...CASE, findings: "" }, [SYMPTOM], [], [
      { id: 1, visit_no: 1, body: "BP 130/85.", created_at: 2_000 },
    ]);

    expect(caught.bare).toBe(false);
    expect(caught.updates).toBe(1);
  });

  it("treats whitespace-only findings as bare", () => {
    // A record holding a newline is empty to a reader and empty to the engine.
    expect(reviewReadiness({ ...CASE, findings: "  \n " }, [], []).bare).toBe(true);
  });

  it("counts a zero grade as graded here too", () => {
    // Same falsy trap as the seal check, and the two must not disagree: the
    // panel would announce an ungraded visit while the answer was revealed.
    const file = reviewReadiness(CASE, [], [visit(1, 0)]);

    expect(file.ungraded).toBe(0);
    expect(reviewMaySeeTheAnswer([visit(1, 0)])).toBe(true);
  });

  it("agrees with the seal check on every count of ungraded visits", () => {
    // The panel's explanation and the redaction it explains are two reads of
    // one fact. Drift between them is worse than either being wrong alone.
    const cases = [[], [visit(1, null)], [visit(1, 70)], [visit(1, 70), visit(2, null)]];

    for (const visits of cases) {
      const file = reviewReadiness(CASE, [], visits);
      const sealed = !reviewMaySeeTheAnswer(visits);
      expect(sealed).toBe(file.ungraded > 0 || file.visits === 0);
    }
  });
});
