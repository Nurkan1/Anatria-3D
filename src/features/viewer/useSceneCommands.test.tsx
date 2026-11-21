import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { EngineEvent } from "@/lib/schemas";

const bridge = vi.hoisted(() => ({
  subscribe: vi.fn(), off: vi.fn(), event: undefined as ((event: EngineEvent) => void) | undefined,
}));
vi.mock("@/lib/ipc", () => ({ onEngineEvent: bridge.subscribe }));
import { useSceneCommands } from "./useSceneCommands";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("updates callbacks without a gap in the event subscription", async () => {
  bridge.subscribe.mockImplementation(async (callback) => { bridge.event = callback; return bridge.off; });
  const first = vi.fn();
  const second = vi.fn();
  const hook = renderHook(({ onTextDelta }) => useSceneCommands({ onTextDelta }), { initialProps: { onTextDelta: first } });
  await act(async () => {});
  hook.rerender({ onTextDelta: second });
  act(() => bridge.event!({ type: "text_delta", request_id: "r", text: "Latest" }));
  expect(bridge.subscribe).toHaveBeenCalledTimes(1);
  expect(bridge.off).not.toHaveBeenCalled();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("r", "Latest");
});

it("ignores a subscription that completes after unmount", async () => {
  let resolve!: (off: () => void) => void;
  bridge.subscribe.mockImplementation((callback) => {
    bridge.event = callback;
    return new Promise((done) => { resolve = done; });
  });
  const onTextDelta = vi.fn();
  const hook = renderHook(() => useSceneCommands({ onTextDelta }));
  hook.unmount();
  act(() => bridge.event!({ type: "text_delta", request_id: "r", text: "Late" }));
  await act(async () => resolve(bridge.off));
  expect(onTextDelta).not.toHaveBeenCalled();
  expect(bridge.off).toHaveBeenCalledTimes(1);
});

it("hands a drafted case to the case store, and keeps its failure out of the chat", async () => {
  const { useCaseStore } = await import("@/stores/caseStore");
  const receive = vi.fn();
  const fail = vi.fn();
  const finish = vi.fn();
  useCaseStore.setState({ receiveCaseDraft: receive, failCaseDraft: fail, finishCaseDraft: finish });
  bridge.subscribe.mockImplementation(async (callback) => { bridge.event = callback; return bridge.off; });
  const onError = vi.fn();
  const onDone = vi.fn();
  renderHook(() => useSceneCommands({ onError, onDone }));
  await act(async () => {});

  const draft = { title: "Case", sex: "male" as const, findings: "", ground_truth: "Answer." };
  act(() => bridge.event!({ type: "case_draft", request_id: "draft-1", draft }));
  act(() => bridge.event!({ type: "done", request_id: "draft-1", usage: null, model: "m" }));
  act(() => bridge.event!({ type: "error", request_id: "draft-2", code: "provider_error", message: "no" }));

  expect(receive).toHaveBeenCalledWith("draft-1", draft);
  expect(finish).toHaveBeenCalledWith("draft-1", null, "m");
  expect(fail).toHaveBeenCalledWith("draft-2", "no");
  expect(onError).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});
