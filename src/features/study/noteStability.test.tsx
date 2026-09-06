import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudyPanel } from "./StudyPanel";
import { useStudyStore } from "@/stores/studyStore";
import { useCaseStore } from "@/stores/caseStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(cleanup);

it("keeps a failed note and accepts only one save at a time", async () => {
  let resolve!: (ok: boolean) => void;
  const save = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
  useStudyStore.setState({ addNote: save, refresh: vi.fn() });
  useCaseStore.setState({ refresh: vi.fn(), cases: [] });
  render(<StudyPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
  const draft = screen.getByPlaceholderText("What is worth remembering here?");
  fireEvent.change(draft, { target: { value: "Keep this note" } });
  const button = screen.getByRole("button", { name: "Save" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect((screen.getByPlaceholderText("What is worth remembering here?") as HTMLTextAreaElement).value).toBe("Keep this note");
  await act(async () => resolve(false));
  expect((draft as HTMLTextAreaElement).value).toBe("Keep this note");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => resolve(true));
  expect(screen.queryByPlaceholderText("What is worth remembering here?")).toBeNull();
});
