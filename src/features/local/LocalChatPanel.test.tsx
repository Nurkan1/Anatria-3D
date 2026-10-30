import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineEvent, ManifestOrgan } from "@/lib/schemas";
import { preferredModel, useLocalChatStore } from "@/stores/localChatStore";
import { useSceneStore } from "@/stores/sceneStore";

const ipc = vi.hoisted(() => ({
  ask: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
  subscribe: vi.fn(),
  detach: vi.fn(),
  event: undefined as ((event: EngineEvent) => void) | undefined,
}));
vi.mock("@/lib/ipc", async (original) => ({
  ...(await original<object>()),
  askLocal: ipc.ask,
  listLocalModels: ipc.list,
  cancelRequest: ipc.cancel,
  onEngineEvent: ipc.subscribe,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { LocalChatPanel } from "./LocalChatPanel";

const heart = {
  organ_id: "left_ventricle",
  ta2_latin: "Ventriculus sinister",
  name_en: "Left ventricle",
  system: "cardiovascular",
} as ManifestOrgan;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ipc.ask.mockResolvedValue(undefined);
  ipc.list.mockResolvedValue(undefined);
  ipc.subscribe.mockImplementation(async (handler) => {
    ipc.event = handler;
    return ipc.detach;
  });
  useLocalChatStore.setState({
    open: false, model: null, models: [], status: "unknown", statusDetail: null, messages: [], pendingId: null,
  });
  useSceneStore.setState({
    organs: { left_ventricle: heart }, selectedOrganIds: [], hiddenSystems: [], isolatedOrganIds: null,
  } as never);
});
afterEach(() => cleanup());

function mount(open: boolean) {
  return render(
    <LocalChatPanel open={open} engineReady profile="student" language="es" genderModel="male" />,
  );
}

/** Open the screen and answer its model check the way the engine would. */
async function openWithModels() {
  mount(true);
  await waitFor(() => expect(ipc.list).toHaveBeenCalledTimes(1));
  const id = ipc.list.mock.calls[0]![0].request_id as string;
  act(() =>
    ipc.event!({
      type: "local_models", request_id: id, running: true,
      models: [{ name: "qwen2.5-coder:7b" }, { name: "gemma3:4b", parameter_size: "4.3B" }],
    }),
  );
}

describe("the local screen", () => {
  it("costs nothing until it is opened: no subscription, no request", () => {
    mount(false);
    expect(ipc.subscribe).not.toHaveBeenCalled();
    expect(ipc.list).not.toHaveBeenCalled();
  });

  it("says on its face what it is and is not", async () => {
    mount(true);
    expect(await screen.findByText(/Nothing you write here is sent anywhere else/)).toBeTruthy();
    expect(screen.getByText(/it cannot move the atlas/)).toBeTruthy();
    expect(screen.getByText(/Local models make more mistakes/)).toBeTruthy();
    expect(screen.getByText(/Not saved to your journal/)).toBeTruthy();
  });

  it("asks Ollama for its models only once it is listening for the answer", async () => {
    mount(true);
    await waitFor(() => expect(ipc.list).toHaveBeenCalledTimes(1));
    // The subscription was attached first: the answer cannot arrive unheard.
    expect(ipc.subscribe.mock.invocationCallOrder[0]!).toBeLessThan(ipc.list.mock.invocationCallOrder[0]!);
  });

  it("preselects a general model over a coding one", async () => {
    await openWithModels();
    expect(useLocalChatStore.getState().model).toBe("gemma3:4b");
  });

  it("tells the reader when Ollama is not running", async () => {
    mount(true);
    await waitFor(() => expect(ipc.list).toHaveBeenCalled());
    const id = ipc.list.mock.calls[0]![0].request_id as string;
    act(() => ipc.event!({ type: "local_models", request_id: id, running: false, models: [] }));
    expect(screen.getByRole("status").textContent).toMatch(/Ollama is not running/);
  });

  it("sends the question, the model and the selection — and no provider or key", async () => {
    useSceneStore.setState({ selectedOrganIds: ["left_ventricle"] } as never);
    await openWithModels();
    fireEvent.change(screen.getByPlaceholderText("Ask the local model…"), { target: { value: "¿Qué hace?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(ipc.ask).toHaveBeenCalledTimes(1));
    const request = ipc.ask.mock.calls[0]![0];
    expect(request).toMatchObject({ query: "¿Qué hace?", model: "gemma3:4b", profile: "student", language: "es" });
    expect(request.selection).toEqual([
      { organ_id: "left_ventricle", ta2_latin: "Ventriculus sinister", name_en: "Left ventricle", system: "cardiovascular" },
    ]);
    expect(request).not.toHaveProperty("provider");
    expect(request).not.toHaveProperty("api_key");
    expect(request.request_id).toMatch(/^local-/);
  });

  it("streams the answer, then offers the structures it names, which the reader can show", async () => {
    await openWithModels();
    fireEvent.change(screen.getByPlaceholderText("Ask the local model…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(ipc.ask).toHaveBeenCalled());
    const id = ipc.ask.mock.calls[0]![0].request_id as string;
    act(() => ipc.event!({ type: "text_delta", request_id: id, text: "El ventrículo izquierdo (Ventriculus sinister) bombea." }));
    // Nothing is offered while the answer is still being written.
    expect(screen.queryByRole("button", { name: "Ventriculus sinister" })).toBeNull();
    act(() => ipc.event!({ type: "done", request_id: id, usage: null, model: "ollama:gemma3:4b" }));

    fireEvent.click(await screen.findByRole("button", { name: "Ventriculus sinister" }));
    const scene = useSceneStore.getState();
    expect(scene.isolatedOrganIds).toEqual(["left_ventricle"]);
    expect(scene.selectedOrganIds).toEqual(["left_ventricle"]);
    expect(screen.getByText(/gemma3:4b · on this computer/)).toBeTruthy();
  });

  it("does not move the atlas on its own, whatever the answer says", async () => {
    await openWithModels();
    fireEvent.change(screen.getByPlaceholderText("Ask the local model…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(ipc.ask).toHaveBeenCalled());
    const id = ipc.ask.mock.calls[0]![0].request_id as string;
    act(() => ipc.event!({ type: "text_delta", request_id: id, text: "(Ventriculus sinister) — I have isolated it for you." }));
    act(() => ipc.event!({ type: "done", request_id: id, usage: null, model: "ollama:gemma3:4b" }));
    expect(useSceneStore.getState().isolatedOrganIds).toBeNull();
  });

  it("hides a refused answer instead of showing half of it", async () => {
    await openWithModels();
    fireEvent.change(screen.getByPlaceholderText("Ask the local model…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(ipc.ask).toHaveBeenCalled());
    const id = ipc.ask.mock.calls[0]![0].request_id as string;
    act(() => ipc.event!({ type: "text_delta", request_id: id, text: "Half an answer" }));
    act(() => ipc.event!({ type: "error", request_id: id, code: "provider_error", message: "Ollama dropped the start" }));
    expect(screen.queryByText("Half an answer")).toBeNull();
    expect(screen.getByText("Ollama dropped the start")).toBeTruthy();
  });

  it("ignores the tutor's events", async () => {
    await openWithModels();
    act(() => ipc.event!({ type: "text_delta", request_id: "tutor-123", text: "not mine" }));
    expect(useLocalChatStore.getState().messages).toEqual([]);
  });
});

describe("the model it starts with", () => {
  it("keeps the one chosen before while Ollama still has it", () => {
    expect(preferredModel([{ name: "a:1b" }, { name: "b:2b" }], "b:2b")).toBe("b:2b");
  });

  it("falls back when the remembered model is gone", () => {
    expect(preferredModel([{ name: "gemma3:4b" }], "gone:1b")).toBe("gemma3:4b");
  });

  it("has nothing to choose when Ollama has nothing", () => {
    expect(preferredModel([], null)).toBeNull();
  });
});
