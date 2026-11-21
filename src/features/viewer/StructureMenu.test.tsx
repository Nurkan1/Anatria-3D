import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";
import type { CaseFile } from "@/lib/studyDb";

vi.mock("@/lib/studyDb", () => ({
  listCases: vi.fn(),
  caseDigest: vi.fn(),
  MAX_VISITS: 20,
  MAX_PATH_POINTS: 12,
}));

const { useCaseStore } = await import("@/stores/caseStore");
const { useSceneStore } = await import("@/stores/sceneStore");
const { StructureMenu } = await import("./StructureMenu");

function organ(organ_id: string, ta2_latin: string): ManifestOrgan {
  return { organ_id, ta2_latin, name_en: organ_id, system: "skeletal", path: [] } as unknown as ManifestOrgan;
}

const CASE = { id: "c1", title: "Neck and arm pain", visit_count: 0 } as CaseFile;

beforeEach(() => {
  useSceneStore.setState({
    organs: { vertebra_c6: organ("vertebra_c6", "Vertebra cervicalis VI"), radius_r: organ("radius_r", "Radius") },
  } as never);
  useCaseStore.setState({ cases: [CASE], activeCaseId: "c1", symptoms: [], paths: [], draft: null });
});
afterEach(() => cleanup());

function openOn(organId: string) {
  return render(<StructureMenu target={{ organId, x: 0, y: 0 }} onClose={() => {}} />);
}

describe("symptom paths from the right-click menu", () => {
  it("starts a path at the structure that was right-clicked", () => {
    openOn("vertebra_c6");
    fireEvent.click(screen.getByRole("menuitem", { name: "Start a symptom path here" }));
    expect(useCaseStore.getState().draft?.points.map((point) => point.organ_id)).toEqual(["vertebra_c6"]);
  });

  it("offers the next structure as the following stop", () => {
    useCaseStore.getState().addToPath({ organ_id: "vertebra_c6", organ_label: "C6" });
    openOn("radius_r");
    fireEvent.click(screen.getByRole("menuitem", { name: "Add as stop 2 of the path" }));
    expect(useCaseStore.getState().draft?.points).toHaveLength(2);
  });

  it("says why the last stop cannot be added again, instead of offering it", () => {
    useCaseStore.getState().addToPath({ organ_id: "vertebra_c6", organ_label: "C6" });
    openOn("vertebra_c6");
    expect(screen.queryByRole("menuitem", { name: /Add as stop/ })).toBeNull();
    expect(screen.getByText("Already the last stop of the path being drawn")).toBeTruthy();
  });

  it("offers nothing about paths without a patient: a path has to belong to someone", () => {
    useCaseStore.setState({ activeCaseId: null });
    openOn("vertebra_c6");
    expect(screen.queryByRole("menuitem", { name: /symptom path/ })).toBeNull();
  });
});
