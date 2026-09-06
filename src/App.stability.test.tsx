import { useEffect } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const callbacks = vi.hoisted(() => ({ detach: vi.fn() }));
vi.mock("@/features/chat/ChatPanel", () => ({ ChatPanel: () => {
  useEffect(() => callbacks.detach, []);
  return <textarea aria-label="Chat draft" defaultValue="Unsent question" />;
} }));
vi.mock("@/features/layout/LeftPanel", () => ({ LeftPanel: () => <textarea aria-label="Note draft" defaultValue="Unsaved note" /> }));
vi.mock("@/features/viewer/AnatomyViewer", () => ({ AnatomyViewer: () => null }));
vi.mock("@/features/study/PrintSheet", () => ({ PrintSheet: () => null }));
vi.mock("@/features/help/GuideOverlay", () => ({ GuideOverlay: () => null }));
vi.mock("@/features/help/useFirstRun", () => ({ useFirstRun: () => ({ firstRun: false, markSeen: vi.fn() }) }));
vi.mock("@/features/idle/useIdleScreen", () => ({ useIdleScreen: () => ({ showing: false }) }));
vi.mock("@/features/splash/useSplash", () => ({ useSplash: () => ({ visible: false }) }));
vi.mock("@/stores/persistView", () => ({ startViewPersistence: vi.fn() }));
vi.mock("@/lib/localStore", () => ({ checkStorage: vi.fn(), confirmStoragePersists: vi.fn(), readLocal: () => null, writeLocal: vi.fn() }));
import App from "./App";
afterEach(cleanup);

it("hides panels without unmounting their subscriptions or drafts", () => {
  render(<App />);
  const chat = screen.getByLabelText("Chat draft");
  const note = screen.getByLabelText("Note draft");
  fireEvent.change(chat, { target: { value: "Keep chat" } });
  fireEvent.change(note, { target: { value: "Keep note" } });
  fireEvent.click(screen.getByTitle("Hide the assistant"));
  fireEvent.click(screen.getByTitle("Hide the anatomy panel"));
  expect(callbacks.detach).not.toHaveBeenCalled();
  expect(chat.isConnected).toBe(true);
  expect(chat.closest("aside")?.hidden).toBe(true);
  expect(chat.closest("aside")?.hasAttribute("inert")).toBe(true);
  fireEvent.click(screen.getByTitle("Show the assistant"));
  fireEvent.click(screen.getByTitle("Show the anatomy panel"));
  expect((screen.getByLabelText("Chat draft") as HTMLTextAreaElement).value).toBe("Keep chat");
  expect((screen.getByLabelText("Note draft") as HTMLTextAreaElement).value).toBe("Keep note");
});
