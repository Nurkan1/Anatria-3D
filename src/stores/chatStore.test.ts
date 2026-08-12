import { beforeEach, describe, expect, it } from "vitest";

import type { SessionDetail } from "@/lib/studyDb";

import { useChatStore } from "./chatStore";

const store = () => useChatStore.getState();

beforeEach(() => {
  useChatStore.setState({ messages: [], pendingRequestId: null });
});

describe("chatStore", () => {
  it("opens a turn with the prompt and a placeholder answer", () => {
    store().startTurn("r1", "How does the heart pump blood?");

    const { messages, pendingRequestId } = store();
    expect(messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "complete"],
      ["assistant", "streaming"],
    ]);
    expect(pendingRequestId).toBe("r1");
  });

  it("accumulates streamed text on the matching turn", () => {
    store().startTurn("r1", "Explain.");
    store().appendDelta("r1", "The left ");
    store().appendDelta("r1", "ventricle");

    expect(store().messages[1]?.content).toBe("The left ventricle");
  });

  it("records the tools used, in call order", () => {
    store().startTurn("r1", "Walk me through it.");
    store().noteTool("r1", "focus_organ");
    store().noteTool("r1", "focus_organ");
    store().noteTool("r1", "set_cross_section");

    expect(store().messages[1]?.tools).toEqual([
      "focus_organ",
      "focus_organ",
      "set_cross_section",
    ]);
  });

  it("routes events to the right turn when two are in flight", () => {
    // Turns are keyed by request id precisely so a late event from an earlier
    // turn cannot land in a later one's answer.
    store().startTurn("r1", "First");
    store().appendDelta("r1", "one");
    store().startTurn("r2", "Second");
    store().appendDelta("r2", "two");
    store().appendDelta("r1", "-more");

    const answers = store()
      .messages.filter((m) => m.role === "assistant")
      .map((m) => m.content);
    expect(answers).toEqual(["one-more", "two"]);
  });

  it("ignores events for a turn that was cleared", () => {
    store().startTurn("r1", "Ask");
    store().beginSession("tutor");
    store().appendDelta("r1", "late text");

    // Resurrecting a message into an empty transcript would be worse than
    // dropping a straggler from a conversation the user has moved on from.
    expect(store().messages).toEqual([]);
  });

  it("completes a turn and releases the pending slot", () => {
    store().startTurn("r1", "Ask");
    store().appendDelta("r1", "Answer");
    store().finishTurn("r1", { input_tokens: 120, output_tokens: 45 });

    expect(store().messages[1]?.status).toBe("complete");
    expect(store().messages[1]?.usage).toEqual({ input_tokens: 120, output_tokens: 45 });
    expect(store().pendingRequestId).toBeNull();
  });

  it("keeps a cancelled turn cancelled when the done event arrives after", () => {
    // Stopping races the engine's own completion; whichever lands second must
    // not relabel the turn as a clean finish.
    store().startTurn("r1", "Ask");
    store().markCancelled("r1");
    store().finishTurn("r1");

    expect(store().messages[1]?.status).toBe("cancelled");
  });

  it("records an error on the turn and frees the slot", () => {
    store().startTurn("r1", "Ask");
    store().failTurn("r1", "invalid_api_key: 401");

    expect(store().messages[1]?.status).toBe("error");
    expect(store().messages[1]?.error).toContain("401");
    expect(store().pendingRequestId).toBeNull();
  });

  it("offers a completed turn to the journal as a question and an answer", () => {
    store().startTurn("r1", "What does the left ventricle do?");
    store().appendDelta("r1", "It drives systemic circulation.");
    store().finishTurn("r1");

    expect(store().turn("r1")).toEqual({
      question: "What does the left ventricle do?",
      answer: "It drives systemic circulation.",
    });
  });

  it.each(["error", "cancelled"] as const)("does not file a %s turn", (outcome) => {
    // A half-answer in the journal reads later as a gap in the student's own
    // understanding rather than as a failed request.
    store().startTurn("r1", "Explain.");
    store().appendDelta("r1", "The left ven");
    if (outcome === "error") store().failTurn("r1", "boom");
    else store().markCancelled("r1");

    expect(store().turn("r1")).toBeNull();
  });

  it("does not file a turn that finished with nothing to say", () => {
    store().startTurn("r1", "Explain.");
    store().finishTurn("r1");

    expect(store().turn("r1")).toBeNull();
  });

  it("gives a new conversation its own journal identity", () => {
    const first = store().sessionId;
    store().startTurn("r1", "Ask");
    store().beginSession("case");

    expect(store().sessionId).not.toBe(first);
    expect(store().mode).toBe("case");
    expect(store().messages).toEqual([]);
  });

  /** A graded drill as the journal hands it back, provenance and all. */
  const reopened = (): SessionDetail => ({
    session: {
      id: "s-42",
      kind: "case",
      title: "Anterior infarction",
      profile: "student",
      language: "es",
      score: 68,
      verdict: "Missed the timing.",
      message_count: 2,
      structure_count: 1,
      created_at: 1,
      updated_at: 2,
    },
    messages: [
      {
        role: "user",
        content: "What would I do?",
        created_at: 1,
        model: null,
        input_tokens: null,
        output_tokens: null,
      },
      {
        role: "assistant",
        content: "Here is the case.",
        created_at: 2,
        model: "gpt-5.2",
        input_tokens: 120,
        output_tokens: 45,
      },
    ],
    structures: ["left_ventricle"],
  });

  it("reopens a session with its transcript and its mode", () => {
    store().loadSession(reopened());

    expect(store().sessionId).toBe("s-42");
    expect(store().mode).toBe("case");
    // Reopened turns are finished by definition — nothing can stream into them.
    expect(store().messages.map((m) => m.status)).toEqual(["complete", "complete"]);
  });

  /**
   * Reported: an answer showed its model and token count while it was on
   * screen, then came back blank after closing and reopening the session. That
   * was the journal forgetting, not a deliberate silence — and a student
   * comparing two models across a week of sessions needs it most at exactly the
   * moment they return to them.
   */
  it("restores which model wrote a reopened answer, and what it cost", () => {
    store().loadSession(reopened());
    const answer = store().messages[1]!;
    expect(answer.model).toBe("gpt-5.2");
    expect(answer.usage).toEqual({ input_tokens: 120, output_tokens: 45 });
  });

  it("attributes nothing to the reader's own question", () => {
    store().loadSession(reopened());
    expect(store().messages[0]!.model).toBeUndefined();
    expect(store().messages[0]!.usage).toBeUndefined();
  });

  /** An answer from before the journal recorded it has no model, and says so. */
  it("leaves an unrecorded answer blank rather than guessing one", () => {
    const detail = reopened();
    detail.messages[1]!.model = null;
    detail.messages[1]!.input_tokens = null;
    detail.messages[1]!.output_tokens = null;

    store().loadSession(detail);
    expect(store().messages[1]!.model).toBeUndefined();
    expect(store().messages[1]!.usage).toBeUndefined();
  });

  it("attaches a case grade to the turn that earned it", () => {
    store().startTurn("r1", "I would give aspirin.");
    store().appendDelta("r1", "Right, and…");
    store().noteScore("r1", 68);
    store().finishTurn("r1");

    expect(store().messages[1]?.score).toBe(68);
  });

  it("offers only completed, non-empty turns as history", () => {
    store().startTurn("r1", "First question");
    store().appendDelta("r1", "First answer");
    store().finishTurn("r1");
    store().startTurn("r2", "Second question");
    store().failTurn("r2", "boom");

    // A failed or still-streaming answer is not something to feed back as
    // context — it would teach the model that half-turns are normal.
    expect(store().history()).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ]);
  });
});
