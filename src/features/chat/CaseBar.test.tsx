import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaseFile } from "@/lib/studyDb";

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
  getStudySession: vi.fn(),
  MAX_VISITS: 20,
  MAX_SEVERITY: 10,
}));

const db = vi.mocked(await import("@/lib/studyDb"));
const { useCaseStore } = await import("@/stores/caseStore");
const { CaseBar } = await import("./CaseBar");

const PATIENT: CaseFile = {
  id: "c1",
  title: "01M46_1980",
  sex: "male",
  age_years: 46,
  height_cm: 171,
  weight_kg: 98,
  findings: "BMI 33. BP 158/94.",
  sealed_at: 1_000,
  revealed_at: null,
  profile: "student",
  language: "es",
  created_at: 1_000,
  updated_at: 1_000,
  visit_count: 7,
};

function open() {
  useCaseStore.setState({
    cases: [PATIENT],
    activeCaseId: "c1",
    symptoms: [],
    visits: [],
    record: [],
    error: null,
    loaded: true,
  });
  render(<CaseBar profile="student" language="es" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.listCases.mockResolvedValue([PATIENT]);
  db.caseDigest.mockResolvedValue(null);
});

describe("reaching the record", () => {
  it("offers to write to the record without expanding anything first", () => {
    // The failure this exists for, and it was not a bug in any function: the
    // only way in was a button inside a panel that starts collapsed, so the
    // reader never saw it. They typed "weight down 5 kg" into the chat, where
    // it was filed as a visit, and the assistant went on answering from the
    // opening findings — correctly, and uselessly. A control nobody can find
    // is a feature nobody has.
    open();

    expect(screen.getByRole("button", { name: /\+ record/i })).toBeTruthy();
  });

  it("opens the composer ready to type in, in one click", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: /\+ record/i }));

    // Expanding the panel is not enough — it has to land on the box, or the
    // reader is one undiscovered click further on than they were.
    expect(screen.getByPlaceholderText(/what is known now/i)).toBeTruthy();
  });

  it("writes what was typed to the record, not to the conversation", async () => {
    db.addCaseFinding.mockResolvedValue({
      id: 1,
      visit_no: 8,
      body: "Weight down 5 kg. BP 130/85.",
      created_at: 2_000,
    });
    open();

    fireEvent.click(screen.getByRole("button", { name: /\+ record/i }));
    fireEvent.change(screen.getByPlaceholderText(/what is known now/i), {
      target: { value: "Weight down 5 kg. BP 130/85." },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    });

    expect(db.addCaseFinding).toHaveBeenCalledWith({
      case_id: "c1",
      body: "Weight down 5 kg. BP 130/85.",
    });
  });

  it("shows the entry stamped with its visit once it is in", () => {
    useCaseStore.setState({
      cases: [PATIENT],
      activeCaseId: "c1",
      symptoms: [],
      visits: [],
      record: [
        { id: 1, visit_no: 8, body: "Weight down 5 kg. BP 130/85.", created_at: 2_000 },
      ],
      error: null,
      loaded: true,
    });
    render(<CaseBar profile="student" language="es" />);

    fireEvent.click(screen.getByRole("button", { name: /\+ record/i }));

    // The stamp is the point, and it has to be *on the entry* — the chip says
    // "visit 8" too, so matching the text anywhere would pass with the record
    // rendered bare. A figure that moved between visits is a different case
    // from one that was always there, and only the stamp says which.
    const entry = screen.getByText(/weight down 5 kg/i);
    expect(entry.parentElement?.textContent).toMatch(/visit 8/i);
  });

  it("does not reveal the answer without asking first", async () => {
    // The confirmation is the whole mechanism. Everything else in this panel
    // is one click from everything else, and an answer written weeks ago is
    // exactly what must not surface from a misclick.
    open();

    fireEvent.click(screen.getByRole("button", { name: /\+ record/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reveal the sealed answer/i }));
    });

    expect(db.revealCaseAnswer).not.toHaveBeenCalled();
  });

  it("stops offering to reveal a case that is already open", () => {
    // `revealed_at` is a fact in the file, not a flag in the window: a case
    // opened yesterday must not read as sealed again today.
    useCaseStore.setState({
      cases: [{ ...PATIENT, revealed_at: 2_000 }],
      activeCaseId: "c1",
      symptoms: [],
      visits: [],
      record: [],
      error: null,
      loaded: true,
    });
    render(<CaseBar profile="student" language="es" />);

    fireEvent.click(screen.getByRole("button", { name: /\+ record/i }));

    expect(screen.queryByRole("button", { name: /reveal the sealed answer/i })).toBeNull();
    expect(screen.getByRole("button", { name: /no longer sealed/i })).toBeTruthy();
  });

  it("stops promising a seal that has been opened", () => {
    // The label and the behaviour are two reads of one fact, and they drifted:
    // `virtualPatientContext` was taught about `revealed_at` and this call
    // site was not, so the button offered "answer stays sealed" while the
    // answer sat unsealed on the screen above it and the review used it.
    useCaseStore.setState({
      cases: [{ ...PATIENT, revealed_at: 2_000 }],
      activeCaseId: "c1",
      symptoms: [],
      visits: [{ session_id: "v1", visit_no: 1, score: null, verdict: null, structures: [], created_at: 1 }],
      record: [],
      error: null,
      loaded: true,
    });
    render(<CaseBar profile="student" language="es" />);

    fireEvent.click(screen.getByRole("button", { name: /\+ record/i }));

    expect(screen.getByRole("button", { name: /review this case/i }).textContent)
      .not.toMatch(/stays sealed/i);
  });

  it("still promises it on a case nobody has opened", () => {
    open();
    useCaseStore.setState({
      visits: [{ session_id: "v1", visit_no: 1, score: null, verdict: null, structures: [], created_at: 1 }],
    });
    fireEvent.click(screen.getByRole("button", { name: /\+ record/i }));

    expect(screen.getByRole("button", { name: /review this case/i }).textContent)
      .toMatch(/stays sealed/i);
  });

  it("counts the next visit on the chip, not the last one filed", () => {
    // `visit_count` is 7 and the chip must read 8: it names the visit this
    // conversation will become. It went stale for a whole session once,
    // because filing a turn reloaded the journal and not the cases.
    open();

    expect(screen.getByText(/visit 8/i)).toBeTruthy();
  });
});
