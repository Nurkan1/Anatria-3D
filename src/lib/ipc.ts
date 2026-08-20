import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  AgentRequestSchema,
  EngineEventSchema,
  ListModelsRequestSchema,
  type AgentRequest,
  type AiProvider,
  type EngineEvent,
  type ListModelsRequest,
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
  // The default logs *what was wrong*, never the frame it was wrong about.
  // Zod's message already names the failing paths and the types it expected,
  // which is what a person debugging this needs; the payload adds only the
  // data. And the data is a reader's note, a patient record, an answer — none
  // of which should reach a console log because a schema drifted. A caller that
  // genuinely needs the frame still receives it and can decide for itself.
  const onViolation =
    options.onProtocolViolation ??
    ((_payload, issues) => {
      console.error("[engine] protocol violation", issues);
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

/** Correlation id for one request/response exchange. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
