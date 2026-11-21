import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaseFile, CasePath } from "@/lib/studyDb";

vi.mock("@/lib/studyDb", () => ({
  listCases: vi.fn(),
  caseDigest: vi.fn(),
  addCasePath: vi.fn(),
  setCasePathActive: vi.fn().mockResolvedValue(undefined),
  deleteCasePath: vi.fn().mockResolvedValue(undefined),
  MAX_VISITS: 20,
  MAX_PATH_POINTS: 12,
}));

const db = vi.mocked(await import("@/lib/studyDb"));
const { useCaseStore } = await import("@/stores/caseStore");
const { SymptomPathsPanel } = await import("./SymptomPathsPanel");

const CASE = { id: "c1", title: "Neck and arm pain", visit_count: 0 } as CaseFile;

const SAVED: CasePath = {
  id: 7,
  kind: "presentation",
  label: "Neck to thumb",
  spread: "radiating",
  trigger: null,
  reflection: null,
  points: [
    { organ_id: "a", organ_label: "A", character: null, intensity: null },
    { organ_id: "b", organ_label: "B", character: null, intensity: null },
  ],
  active: true,
  session_id: null,
  created_at: 1,
  updated_at: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  useCaseStore.setState({ cases: [CASE], activeCaseId: "c1", paths: [], draft: null, error: null });
});
afterEach(() => cleanup());

describe("the symptom paths panel", () => {
  it("takes no room at all until there is a path to show or draw", () => {
    const { container } = render(<SymptomPathsPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("takes no room without a patient, whatever is in the store", () => {
    useCaseStore.setState({ activeCaseId: null, paths: [SAVED] });
    const { container } = render(<SymptomPathsPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("names the stops of a path being drawn, and will not save it nameless", () => {
    useCaseStore.getState().addToPath({ organ_id: "a", organ_label: "Nervus spinalis C6" });
    useCaseStore.getState().addToPath({ organ_id: "b", organ_label: "Nervus radialis" });
    useCaseStore.getState().addToPath({ organ_id: "c", organ_label: "Pollex" });
    render(<SymptomPathsPanel />);

    expect(screen.getByText("Start")).toBeTruthy();
    expect(screen.getByText("Via")).toBeTruthy();
    expect(screen.getByText("End")).toBeTruthy();
    expect(screen.getByText("Give the path a name.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save path" }) as HTMLButtonElement).disabled).toBe(true);
    // The schematic is said in words, beside the thing that draws it.
    expect(screen.getByText(/It is a schematic, not the course of a nerve/)).toBeTruthy();
  });

  it("calls a multifocal set's stops places, because they have no order to follow", () => {
    useCaseStore.getState().addToPath({ organ_id: "a", organ_label: "A" });
    useCaseStore.getState().updateDraft({ spread: "multifocal" });
    render(<SymptomPathsPanel />);
    expect(screen.getByText("Place 1")).toBeTruthy();
  });

  it("switches a saved path off and asks before deleting one", () => {
    useCaseStore.setState({ paths: [SAVED] });
    render(<SymptomPathsPanel />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Show Neck to thumb" }));
    expect(db.setCasePathActive).toHaveBeenCalledWith(7, false);

    fireEvent.click(screen.getByTitle("Delete this path"));
    expect(db.deleteCasePath).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete?" }));
    expect(db.deleteCasePath).toHaveBeenCalledWith(7);
  });
});
