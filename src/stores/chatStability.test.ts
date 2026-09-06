import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore";

const chat = () => useChatStore.getState();
beforeEach(() => chat().beginSession("tutor"));

describe("bounded complete conversation context", () => {
  it("sends the latest 50 complete pairs without deleting the transcript", () => {
    for (let i = 0; i < 51; i++) {
      chat().startTurn(String(i), `Question ${i}`);
      chat().appendDelta(String(i), `Answer ${i}`);
      chat().finishTurn(String(i));
    }
    expect(chat().history()).toHaveLength(100);
    expect(chat().history()[0]?.content).toBe("Question 1");
    expect(chat().messages).toHaveLength(102);
  });

  it("excludes the user half of cancelled, empty, failed and streaming turns", () => {
    chat().startTurn("cancelled", "Cancelled question");
    chat().markCancelled("cancelled");
    chat().startTurn("empty", "Empty question");
    chat().finishTurn("empty");
    chat().startTurn("failed", "Failed question");
    chat().failTurn("failed", "Failure");
    chat().startTurn("pending", "Still answering");
    expect(chat().history()).toEqual([]);
  });
});

describe("terminal turns", () => {
  it.each(["cancelled", "complete", "error"] as const)("ignores text, tools, scores and commands after %s", (status) => {
    chat().startTurn("r", "Question");
    chat().appendDelta("r", "Original");
    if (status === "cancelled") chat().markCancelled("r");
    if (status === "complete") chat().finishTurn("r");
    if (status === "error") chat().failTurn("r", "Failure");
    const before = chat().messages;
    chat().appendDelta("r", "Late");
    chat().noteTool("r", "reset_view");
    chat().noteCommand("r", { action: "reset_view" });
    chat().noteScore("r", 99);
    expect(chat().messages).toEqual(before);
  });
});
