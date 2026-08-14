import { useEffect } from "react";

import { onEngineEvent } from "@/lib/ipc";
import type { AiProvider, EngineEvent, ModelInfo, TokenUsage } from "@/lib/schemas";
import { useSceneStore } from "@/stores/sceneStore";

export interface SceneCommandBridgeOptions {
  /** Streamed assistant text, delivered per chunk. */
  onTextDelta?: (requestId: string, text: string) => void;
  onToolStarted?: (requestId: string, tool: string) => void;
  onModels?: (requestId: string, provider: AiProvider, models: ModelInfo[]) => void;
  /** A case drill was graded. Fires before `onDone` for the same request. */
  onCaseVerdict?: (requestId: string, score: number, verdict: string) => void;
  /**
   * The turn finished, with what it cost and which model ran it.
   *
   * `usage` is null when the provider reported none — a cancelled turn, or a
   * model that simply does not return counts — and null has to stay
   * distinguishable from zero, because "we were not told" and "this cost
   * nothing" are different facts and only one of them belongs in a total.
   *
   * `model` is the id the engine actually sent, defaults resolved, so an answer
   * can say what produced it even when the reader never chose one. Null for a
   * `done` that closed something which never reached a provider.
   */
  onDone?: (requestId: string, usage: TokenUsage | null, model: string | null) => void;
  onError?: (code: string, message: string, requestId: string | null) => void;
  onReady?: (protocolVersion: number) => void;
  /**
   * The listener is now attached and no further frame can be missed.
   *
   * `listen()` is asynchronous, so there is a window between mounting and
   * subscribing in which an event is simply gone. Anything that needs to
   * reconcile with state the engine already announced belongs here, not in a
   * mount effect that would run inside that window.
   */
  onAttached?: () => void;
  /**
   * A frame arrived that this build cannot read.
   *
   * Worth surfacing rather than logging, because the shape it takes is not
   * "something looks wrong" — it is silence. A dropped `done` leaves the turn
   * unfiled, uncounted and the composer stuck on "Stop", with a streamed answer
   * on screen that looks perfectly fine. In practice it means an engine binary
   * older than the window: `tauri build` does not rebuild the sidecar, so a
   * source build can pair a new frontend with a stale engine.
   */
  onProtocolViolation?: (payload: unknown, issues: string) => void;
}

/**
 * Bridges engine events into the scene store.
 *
 * Scene commands are applied here and nowhere else, which is what makes the
 * store the single render path: the AI's commands land in exactly the same
 * state the user's clicks write to, so there is no separate "AI view" that
 * could drift from what the viewport actually shows.
 */
export function useSceneCommands(options: SceneCommandBridgeOptions = {}) {
  const applyCommand = useSceneStore((s) => s.applyCommand);

  const {
    onTextDelta,
    onToolStarted,
    onModels,
    onCaseVerdict,
    onDone,
    onError,
    onReady,
    onAttached,
    onProtocolViolation,
  } = options;

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    onEngineEvent((event: EngineEvent) => {
      switch (event.type) {
        case "ready":
          onReady?.(event.protocol_version);
          break;
        case "scene_command":
          applyCommand(event.command);
          break;
        case "text_delta":
          onTextDelta?.(event.request_id, event.text);
          break;
        case "tool_started":
          onToolStarted?.(event.request_id, event.tool);
          break;
        case "models":
          onModels?.(event.request_id, event.provider, event.models);
          break;
        case "case_verdict":
          onCaseVerdict?.(event.request_id, event.score, event.verdict);
          break;
        case "done":
          onDone?.(event.request_id, event.usage, event.model);
          break;
        case "error":
          onError?.(event.code, event.message, event.request_id);
          break;
      }
    }, onProtocolViolation ? { onProtocolViolation } : {}).then(
      (off) => {
        if (cancelled) {
          off();
          return;
        }
        stop = off;
        onAttached?.();
      },
      (err: unknown) => {
        onError?.(
          "internal_error",
          `Could not subscribe to engine events: ${String(err)}`,
          null,
        );
      },
    );

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [
    applyCommand,
    onTextDelta,
    onToolStarted,
    onModels,
    onCaseVerdict,
    onDone,
    onError,
    onReady,
    onAttached,
    onProtocolViolation,
  ]);
}
