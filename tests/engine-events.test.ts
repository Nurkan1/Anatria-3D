import { describe, expect, it } from "vitest";

import { EngineEventSchema } from "../src/lib/schemas";

/**
 * Frames are parsed before they are dispatched, and a frame that fails to
 * parse is dropped. That is the right call for a scene command — a malformed
 * payload must never reach the viewport — but it makes the reader's tolerance
 * of *unknown-but-harmless* input part of the protocol rather than a detail.
 *
 * These tests exist because getting it wrong once already cost three features
 * at the same time. `tauri build` does not rebuild the Python sidecar, so a
 * build from source can pair a new window with an engine several days old. When
 * a newly added field was required on the way in, that engine's `done` frame
 * stopped parsing — and `done` is the frame that clears the composer, files the
 * turn in the journal and records what it cost. The answer still streamed and
 * still looked perfect on screen; nothing behind it happened, and the send
 * button stayed on "Stop" forever.
 *
 * The rule this pins down: **a new field on an event is optional on the way
 * in.** Never required, however sure you are that both sides ship together.
 */

describe("done", () => {
  it("parses a frame from an engine that predates the model field", () => {
    const parsed = EngineEventSchema.safeParse({
      type: "done",
      request_id: "r1",
      usage: { input_tokens: 800, output_tokens: 400 },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "done",
      request_id: "r1",
      // Absent reads as "not reported", which is exactly what it means.
      model: null,
    });
  });

  it("parses a frame that reports neither cost nor model", () => {
    // What closes a model-list request: it ran on nothing and cost nothing.
    const parsed = EngineEventSchema.safeParse({
      type: "done",
      request_id: "r2",
      usage: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps the model when the engine does report one", () => {
    const parsed = EngineEventSchema.safeParse({
      type: "done",
      request_id: "r3",
      usage: null,
      model: "claude-haiku-3-5",
    });
    expect(parsed.success && parsed.data).toMatchObject({ model: "claude-haiku-3-5" });
  });

  /** Tolerant about absence is not the same as tolerant about nonsense. */
  it("still refuses a frame with no request id", () => {
    expect(
      EngineEventSchema.safeParse({ type: "done", usage: null }).success,
    ).toBe(false);
  });

  it("still refuses a model of the wrong type", () => {
    expect(
      EngineEventSchema.safeParse({
        type: "done",
        request_id: "r4",
        usage: null,
        model: 42,
      }).success,
    ).toBe(false);
  });
});
