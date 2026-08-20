import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  AgentRequestSchema,
  EngineEventSchema,
  ListModelsRequestSchema,
  SpeakRequestSchema,
  TranscribeRequestSchema,
  type AgentRequest,
  type AiProvider,
  type EngineEvent,
  type ListModelsRequest,
  type SpeakRequest,
  type TranscribeRequest,
} from "./schemas";

/** Channel Rust forwards every engine frame on. Mirrors `sidecar::ENGINE_EVENT`. */
const ENGINE_EVENT = "anatria://engine-event";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * There is no `getApiKey`. Rust exposes no command that returns a key — it
 * reads from the OS keyring only to fill in the frame it writes to the
 * engine's stdin. Keys are write-only and existence-checkable from here.
 */
export function saveApiKey(provider: AiProvider, apiKey: string): Promise<void> {
  return invoke("save_api_key", { provider, apiKey });
}

export function hasApiKey(provider: AiProvider): Promise<boolean> {
  return invoke("has_api_key", { provider });
}

export function deleteApiKey(provider: AiProvider): Promise<void> {
  return invoke("delete_api_key", { provider });
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Requests are validated here before they leave the renderer. A bad request
 * caught at this boundary produces a stack trace pointing at the caller;
 * caught at the Pydantic end it produces an error event with no such context.
 */
export function askAgent(request: AgentRequest): Promise<void> {
  return invoke("ask_agent", { request: AgentRequestSchema.parse(request) });
}

/**
 * Fetch the models the stored key can use. Rust injects the key, so this both
 * populates the picker and validates the credential — a bad key comes back as
 * an `invalid_api_key` error event on the same request id.
 */
export function listModels(request: ListModelsRequest): Promise<void> {
  return invoke("list_models", { request: ListModelsRequestSchema.parse(request) });
}

export interface EngineStatus {
  ready: boolean;
  /** Why it is not running — a failed spawn, or the last crash. */
  error: string | null;
  /** What it announced at boot, or null before it has said anything. */
  protocol_version: number | null;
}

/**
 * Ask what the engine is doing, rather than waiting to be told.
 *
 * `ready` is emitted once, and Rust spawns the sidecar in `setup()` — before
 * the window has run any JavaScript. A frontend that only listens is betting on
 * winning that race, and losing it disables the composer permanently. A spawn
 * failure is worse: reported from the same place, it is *always* lost, leaving
 * a missing engine binary looking like an unexplained "offline".
 *
 * Call this once the listener is attached: whatever already happened is
 * answered here, whatever happens next arrives as an event.
 */
export function engineStatus(): Promise<EngineStatus> {
  return invoke("engine_status");
}

/**
 * Restart the analysis engine after it has died.
 *
 * The window keeps working without the engine — the atlas, the tree and the
 * viewport are all useful on their own — so a crash must be recoverable from
 * inside the app rather than by quitting it.
 */
export function restartEngine(): Promise<void> {
  return invoke("restart_engine");
}

export function cancelRequest(requestId: string): Promise<void> {
  return invoke("cancel_request", { requestId });
}

// ---------------------------------------------------------------------------
// Voice (local experiment — see docs/experiments/voice.md)
// ---------------------------------------------------------------------------

/**
 * Send a recorded clip to be transcribed.
 *
 * The audio goes to the sidecar and stops there: the recogniser runs locally,
 * in-process and offline. Nothing in this file could send it anywhere else even
 * if it tried — the CSP's `connect-src` lists no external host.
 *
 * Note this does **not** go through the credential path: voice needs no key, so
 * Rust routes it with a command that never reads the keyring.
 */
export function transcribeAudio(request: TranscribeRequest): Promise<void> {
  return invoke("transcribe_audio", {
    request: TranscribeRequestSchema.parse(request),
  });
}

/** Ask for an answer already on screen to be spoken. */
export function speakText(request: SpeakRequest): Promise<void> {
  return invoke("speak_text", { request: SpeakRequestSchema.parse(request) });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EngineListenerOptions {
  /**
   * Called when a frame arrives that does not match the protocol. Defaults to
   * a console error. Frames are dropped rather than passed through half-typed —
   * a scene command with a malformed payload must never reach the viewport.
   */
  onProtocolViolation?: (payload: unknown, issues: string) => void;
}

export function onEngineEvent(
  handler: (event: EngineEvent) => void,
  options: EngineListenerOptions = {},
): Promise<UnlistenFn> {
  const onViolation =
    options.onProtocolViolation ??
    ((payload, issues) => {
      // The payload is summarised rather than printed. Frames on this channel
      // can carry base64 audio — a recorded question, or a synthesised
      // answer — and a malformed one would otherwise put somebody's voice in
      // the console, where it is unreadable and does not belong. The issue
      // list is what actually diagnoses a protocol violation.
      console.error("[engine] protocol violation", issues, describeFrame(payload));
    });

  return listen<unknown>(ENGINE_EVENT, (message) => {
    const parsed = EngineEventSchema.safeParse(message.payload);
    if (!parsed.success) {
      onViolation(message.payload, parsed.error.message);
      return;
    }
    handler(parsed.data);
  });
}

/**
 * A one-line description of a frame, safe to log.
 *
 * Names the shape — its `type` and the keys it carried — without reproducing
 * any value. That is enough to find a protocol drift, and carries no audio, no
 * transcript and no key.
 *
 * Exported for its own test — keeping a recording out of the console is the
 * part that can go wrong, and it is worth asserting rather than assuming.
 */
export function describeFrame(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return `<${typeof payload}>`;
  }
  const frame = payload as Record<string, unknown>;
  const type = typeof frame.type === "string" ? frame.type : "<no type>";
  return `${type} { ${Object.keys(frame).sort().join(", ")} }`;
}

/** Correlation id for one request/response exchange. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
