import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider, EngineEvent, Language, UserProfile } from "@/lib/schemas";
import { PROTOCOL_VERSION } from "@/lib/schemas";
import { useChatStore } from "@/stores/chatStore";
import { useSceneStore } from "@/stores/sceneStore";
import { useStudyStore } from "@/stores/studyStore";
import { useUsageStore } from "@/stores/usageStore";
import { useCaseStore } from "@/stores/caseStore";

const ipc = vi.hoisted(() => ({
  ask: vi.fn(), cancel: vi.fn(), detach: vi.fn(), subscribe: vi.fn(), patient: vi.fn(),
  event: undefined as ((event: EngineEvent) => void) | undefined,
  violation: undefined as ((payload: unknown, issues: string) => void) | undefined,
}));
vi.mock("@/lib/ipc", async (original) => ({
  ...await original<object>(),
  engineStatus: async () => ({ ready: true, protocol_version: PROTOCOL_VERSION, error: null }),
  askAgent: ipc.ask, cancelRequest: ipc.cancel,
  onEngineEvent: ipc.subscribe,
}));
vi.mock("@/stores/caseStore", async (original) => ({ ...await original<object>(), virtualPatientContext: ipc.patient }));
vi.mock("./SettingsDrawer", () => ({ SettingsDrawer: (props: {
  onProviderChange: (provider: AiProvider) => void;
  onLanguageChange: (language: Language) => void;
  onProfileChange: (profile: UserProfile) => void;
}) => <button onClick={() => { props.onProviderChange("anthropic"); props.onLanguageChange("es"); props.onProfileChange("clinician"); }}>Change preferences</button> }));
vi.mock("./CaseBar", () => ({ CaseBar: () => null }));
vi.mock("./BridgeIndicator", () => ({ BridgeIndicator: () => null }));
vi.mock("./SpeakAnswerButton", () => ({ SpeakAnswerButton: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { ChatPanel } from "./ChatPanel";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ipc.ask.mockResolvedValue(undefined);
  ipc.cancel.mockResolvedValue(undefined);
  ipc.patient.mockResolvedValue({});
  ipc.subscribe.mockImplementation(async (event, options) => {
    ipc.event = event;
    ipc.violation = options.onProtocolViolation;
    return ipc.detach;
  });
  useChatStore.getState().beginSession("tutor");
  useSceneStore.setState({ organs: {}, selectedOrganIds: [], hiddenSystems: [], genderModel: "male" });
  useCaseStore.setState({ activeCaseId: null });
  useStudyStore.setState({ saveTurn: vi.fn().mockResolvedValue(true), recordVerdict: vi.fn() });
  useUsageStore.setState({ record: vi.fn().mockResolvedValue(undefined) });
});
afterEach(cleanup);

async function mountAndSend(prompt = "Explain the anatomy") {
  render(<ChatPanel />);
  const draft = await screen.findByPlaceholderText("Ask about the anatomy…");
  fireEvent.change(draft, { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(ipc.ask).toHaveBeenCalledTimes(1));
  return { draft, id: ipc.ask.mock.calls[0]![0].request_id as string };
}

function emit(event: EngineEvent) { act(() => ipc.event!(event)); }
const usage = { input_tokens: 100, output_tokens: 12, cache_read_tokens: 80 };

describe("live event routing", () => {
  it("files the preferences used at send, not the ones selected during the answer", async () => {
    const { id } = await mountAndSend();
    const request = ipc.ask.mock.calls[0]![0];
    fireEvent.click(screen.getByRole("button", { name: "Change preferences" }));
    emit({ type: "text_delta", request_id: id, text: "Answer" });
    emit({ type: "done", request_id: id, model: "test-model", usage });
    expect(useStudyStore.getState().saveTurn).toHaveBeenCalledWith(expect.objectContaining({ profile: request.profile, language: request.language }));
    expect(useUsageStore.getState().record).toHaveBeenCalledWith(expect.objectContaining({ provider: request.provider }));
    expect(ipc.subscribe).toHaveBeenCalledTimes(1);
  });

  it("cancels when reopening the same session from the journal", async () => {
    const { id } = await mountAndSend();
    const sessionId = useChatStore.getState().sessionId;
    act(() => useChatStore.getState().loadSession({
      session: { id: sessionId, kind: "tutor", title: "Saved", profile: "student", language: "en",
        score: null, verdict: null, message_count: 0, structure_count: 0, case_id: null,
        visit_no: null, created_at: 0, updated_at: 0 },
      messages: [], structures: [],
    }));
    expect(ipc.cancel).toHaveBeenCalledWith(id);
    emit({ type: "text_delta", request_id: id, text: "Stale" });
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("does not stop a new turn for an unreadable frame from an old request", async () => {
    const { id } = await mountAndSend();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => ipc.violation!({ request_id: "old-request" }, "stale invalid frame"));
    expect(useChatStore.getState().pendingRequestId).toBe(id);
    log.mockRestore();
  });
  it("keeps one subscription across deltas and files completion exactly once", async () => {
    const { id } = await mountAndSend();
    emit({ type: "text_delta", request_id: id, text: "An answer" });
    expect(ipc.subscribe).toHaveBeenCalledTimes(1);
    emit({ type: "done", request_id: id, usage, model: "test-model" });
    emit({ type: "done", request_id: id, usage, model: "test-model" });
    expect(useStudyStore.getState().saveTurn).toHaveBeenCalledTimes(1);
    expect(useUsageStore.getState().record).toHaveBeenCalledTimes(1);
  });

  it.each(["session", "atlas", "case", "cancel"])("rejects stale commands after %s and keeps original cost attribution", async (change) => {
    const session = useChatStore.getState().sessionId;
    const { id } = await mountAndSend();
    if (change === "session") act(() => useChatStore.getState().beginSession("tutor"));
    if (change === "atlas") act(() => useSceneStore.getState().setGenderModel("female"));
    if (change === "case") act(() => useCaseStore.setState({ activeCaseId: "other" }));
    if (change === "cancel") fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(ipc.cancel).toHaveBeenCalledWith(id);
    const before = useSceneStore.getState().systemOpacity.skeletal;
    emit({ type: "scene_command", request_id: id, command: { action: "set_layer_opacity", system: "skeletal", opacity: 0.23 } });
    emit({ type: "text_delta", request_id: id, text: "Stale answer" });
    emit({ type: "case_verdict", request_id: id, score: 99, verdict: "Stale grade" });
    expect(useSceneStore.getState().systemOpacity.skeletal).toBe(before);
    expect(useChatStore.getState().messages.some((message) => message.content.includes("Stale"))).toBe(false);
    emit({ type: "done", request_id: id, usage, model: "test-model" });
    expect(useStudyStore.getState().saveTurn).not.toHaveBeenCalled();
    expect(useStudyStore.getState().recordVerdict).not.toHaveBeenCalled();
    expect(useUsageStore.getState().record).toHaveBeenCalledWith(expect.objectContaining({ session_id: session, ...usage }));
    emit({ type: "scene_command", request_id: "bridge-17", command: { action: "set_layer_opacity", system: "skeletal", opacity: 0.37 } });
    expect(useSceneStore.getState().systemOpacity.skeletal).toBe(0.37);
  });

  it("releases a turn on malformed events and lets the user retry", async () => {
    await mountAndSend();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => ipc.violation!({}, "invalid test frame"));
    expect(useChatStore.getState().pendingRequestId).toBeNull();
    expect(screen.getAllByText(/unreadable response/)).toHaveLength(2);
    log.mockRestore();
  });
});

describe("preflight validation", () => {
  it("does not duplicate calls or erase new drafts while awaiting dispatch acknowledgement", async () => {
    let acknowledge!: () => void;
    ipc.ask.mockImplementation(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const { draft } = await mountAndSend();
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(ipc.ask).toHaveBeenCalledTimes(1);
    act(() => useChatStore.getState().beginSession("tutor"));
    fireEvent.change(draft, { target: { value: "New draft" } });
    await act(async () => acknowledge());
    expect((draft as HTMLTextAreaElement).value).toBe("New draft");
  });

  it("discards asynchronous patient preparation after a case switch", async () => {
    let finish!: (value: object) => void;
    ipc.patient.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    useChatStore.getState().beginSession("case");
    useCaseStore.setState({ activeCaseId: "old" });
    render(<ChatPanel />);
    const draft = await screen.findByPlaceholderText("Answer the case, or ask for a new one…");
    fireEvent.change(draft, { target: { value: "Follow up" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(ipc.patient).toHaveBeenCalledTimes(1);
    act(() => useCaseStore.setState({ activeCaseId: "new" }));
    await act(async () => finish({}));
    expect(ipc.ask).not.toHaveBeenCalled();
    expect((draft as HTMLTextAreaElement).value).toBe("Follow up");
  });
  it.each([8000, 8001])("handles %i characters without losing an invalid draft", async (length) => {
    render(<ChatPanel />);
    const draft = await screen.findByPlaceholderText("Ask about the anatomy…");
    fireEvent.change(draft, { target: { value: "x".repeat(length) } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {});
    expect(ipc.ask).toHaveBeenCalledTimes(length === 8000 ? 1 : 0);
    if (length === 8001) {
      expect((draft as HTMLTextAreaElement).value).toHaveLength(length);
      expect(useChatStore.getState().messages).toHaveLength(0);
    }
  });

  it.each([64, 65])("handles %i selected structures without silent truncation", async (count) => {
    const organs = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), {
      organ_id: String(i), ta2_latin: "Humerus", name_en: "Humerus", system: "skeletal" as const,
      path: [], mesh_file: "bones.glb", node: String(i),
    }]));
    useSceneStore.setState({ organs, selectedOrganIds: Object.keys(organs) });
    render(<ChatPanel />);
    const draft = await screen.findByPlaceholderText("Ask about the anatomy…");
    fireEvent.change(draft, { target: { value: "Compare the selection" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {});
    expect(ipc.ask).toHaveBeenCalledTimes(count === 64 ? 1 : 0);
    if (count === 64) expect(ipc.ask.mock.calls[0]![0].selection).toHaveLength(64);
    else expect((draft as HTMLTextAreaElement).value).toBe("Compare the selection");
  });
});
