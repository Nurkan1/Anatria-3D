import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { BridgeStatus } from "@/lib/ipc";
import { SceneCommandSchema } from "@/lib/schemas";
import { UNKNOWN_BRIDGE, useBridgeStore } from "@/stores/bridgeStore";
import { useSceneStore } from "@/stores/sceneStore";
import { BridgeProse } from "./BridgeProse";

const ipc = vi.hoisted(() => ({ bridgeStatus: vi.fn(), startBridge: vi.fn(), stopBridge: vi.fn() }));
vi.mock("@/lib/ipc", () => ipc);
const on = { ...UNKNOWN_BRIDGE, supported: true, running: true };
beforeEach(() => {
  vi.clearAllMocks();
  useBridgeStore.setState({ status: on, busy: false, error: null, prose: [] });
  ipc.stopBridge.mockResolvedValue(UNKNOWN_BRIDGE);
});
afterEach(cleanup);

it("keeps only the last twenty entries and labels every entry", () => {
  for (let i = 0; i < 25; i++) useBridgeStore.getState().receiveProse(`bridge-${i}`, `Message ${i}`);
  const entries = useBridgeStore.getState().prose;
  expect(entries).toHaveLength(20);
  expect(entries[0]?.text).toBe("Message 5");
  expect(entries[19]?.text).toBe("Message 24");
  render(<BridgeProse />);
  expect(screen.getAllByText("via the control bridge")).toHaveLength(20);
});

it("clears the lane on confirmed stop and ignores late prose", async () => {
  useBridgeStore.getState().receiveProse("bridge-1", "Before stop");
  render(<BridgeProse />);
  expect(screen.getByText("Before stop")).toBeTruthy();
  await act(async () => useBridgeStore.getState().turnOff());
  act(() => useBridgeStore.getState().receiveProse("bridge-2", "Late"));
  expect(useBridgeStore.getState().prose).toEqual([]);
  expect(screen.queryByRole("region")).toBeNull();
  ipc.startBridge.mockResolvedValue(on);
  await act(async () => useBridgeStore.getState().turnOn());
  expect(useBridgeStore.getState().prose).toEqual([]);
});

it("keeps messages and exposes the error when stopping fails", async () => {
  useBridgeStore.getState().receiveProse("bridge-1", "Kept");
  ipc.stopBridge.mockRejectedValue(new Error("Stop failed"));
  await useBridgeStore.getState().turnOff();
  expect(useBridgeStore.getState().status?.running).toBe(true);
  expect(useBridgeStore.getState().prose[0]?.text).toBe("Kept");
  expect(useBridgeStore.getState().error).toContain("Stop failed");
});

it("rejects prose during shutdown and cannot be reopened by an older status poll", async () => {
  let poll!: (status: BridgeStatus) => void;
  let stop!: (status: BridgeStatus) => void;
  ipc.bridgeStatus.mockImplementation(() => new Promise((resolve) => { poll = resolve; }));
  ipc.stopBridge.mockImplementation(() => new Promise((resolve) => { stop = resolve; }));
  const refreshing = useBridgeStore.getState().refresh();
  const stopping = useBridgeStore.getState().turnOff();
  useBridgeStore.getState().receiveProse("bridge-1", "During shutdown");
  expect(useBridgeStore.getState().prose).toEqual([]);
  stop(UNKNOWN_BRIDGE);
  await stopping;
  poll(on);
  await refreshing;
  expect(useBridgeStore.getState().status?.running).toBe(false);
});

it("also clears when Rust reports an already stopped bridge", async () => {
  useBridgeStore.getState().receiveProse("bridge-1", "Before poll");
  ipc.bridgeStatus.mockResolvedValue(UNKNOWN_BRIDGE);
  await useBridgeStore.getState().refresh();
  expect(useBridgeStore.getState().prose).toEqual([]);
});

it.each(["x", "🫀"])("validates 4000/4001 Unicode characters (%s) without truncation", (character) => {
  const text = character.repeat(4000);
  expect(SceneCommandSchema.parse({ action: "say", text })).toEqual({ action: "say", text });
  const invalid = SceneCommandSchema.safeParse({ action: "say", text: text + character });
  expect(invalid.success).toBe(false);
  if (!invalid.success) expect(invalid.error.issues[0]?.message).toBe("Text must contain at most 4000 characters.");
});

it("renders Markdown without active structure pins, HTML, links or remote images", () => {
  useSceneStore.setState({ organs: { corpus_callosum: {
    organ_id: "corpus_callosum", name_en: "Corpus callosum", ta2_latin: "Corpus callosum",
    system: "nervous", path: [], mesh_file: "nervous.glb", node: "corpus_callosum",
  } } });
  useBridgeStore.getState().receiveProse("bridge-1", [
    "**External** [[corpus_callosum]] [pin](anatria-ref:corpus_callosum)",
    "[unsafe](javascript:alert(1)) [link](https://example.invalid)",
    '<script>alert(1)</script><button>fake action</button>',
    "![remote](https://example.invalid/tracker.png)",
  ].join("\n\n"));
  const { container } = render(<BridgeProse />);
  expect(container.querySelector("strong")?.textContent).toBe("External");
  expect(container.querySelector("button, a, img, script")).toBeNull();
  expect(screen.getByText(/\[\[corpus_callosum\]\]/)).toBeTruthy();
});
