import { beforeEach, describe, expect, it } from "vitest";

import { askToConfirm, useConfirmStore } from "./confirmStore";

const request = {
  title: "Delete this note?",
  body: "It cannot be brought back.",
  confirmLabel: "Delete note",
};

beforeEach(() => {
  useConfirmStore.setState({ pending: null });
});

describe("askToConfirm", () => {
  it("resolves true when the reader goes ahead", async () => {
    const answered = askToConfirm(request);
    useConfirmStore.getState().answer(true);
    await expect(answered).resolves.toBe(true);
  });

  it("resolves false when they back out", async () => {
    const answered = askToConfirm(request);
    useConfirmStore.getState().answer(false);
    await expect(answered).resolves.toBe(false);
  });

  it("puts the question on screen with what is being destroyed", () => {
    void askToConfirm({ ...request, subject: "Thickest wall — systemic pressure." });
    const pending = useConfirmStore.getState().pending;
    expect(pending?.title).toBe("Delete this note?");
    // Naming the thing is what turns a confirmation from a reflex into a check.
    expect(pending?.subject).toContain("systemic pressure");
  });

  it("clears itself once answered, so nothing is left on screen", () => {
    void askToConfirm(request);
    useConfirmStore.getState().answer(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it("declines a question that a second one interrupts", async () => {
    // Otherwise the first promise never settles and whatever was waiting on it
    // hangs for the rest of the session. "No" is the only safe reading of a
    // destructive question nobody answered.
    const first = askToConfirm(request);
    const second = askToConfirm({ ...request, title: "Delete this session?" });

    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().pending?.title).toBe("Delete this session?");

    useConfirmStore.getState().answer(true);
    await expect(second).resolves.toBe(true);
  });

  it("ignores an answer when nothing was asked", () => {
    // A stray Escape after the dialog closed must not throw into the app.
    expect(() => useConfirmStore.getState().answer(true)).not.toThrow();
  });
});
