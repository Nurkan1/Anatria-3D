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
