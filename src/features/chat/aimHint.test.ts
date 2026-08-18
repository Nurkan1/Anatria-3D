import { describe, expect, it } from "vitest";

import { shouldShowAimHint, type AimHintInput } from "./aimHint";

function input(over: Partial<AimHintInput> = {}): AimHintInput {
  return { drafting: true, hasAim: false, mode: "tutor", learned: false, ...over };
}

describe("shouldShowAimHint", () => {
  it("asks a reader typing at nothing to point first", () => {
    // The case it exists for. With no selection the prompt carries no subject,
    // so the assistant is handed a summary of thousands of structures and has
    // to search before it can start — a vaguer answer for a larger bill.
    expect(shouldShowAimHint(input())).toBe(true);
  });

  it("stays quiet until there is a question being typed", () => {
    // Not a banner. A permanent strip above the composer would be furniture
    // within a day, and invisible on the day it mattered.
    expect(shouldShowAimHint(input({ drafting: false }))).toBe(false);
  });

  it("says nothing when the assistant already has a subject", () => {
    expect(shouldShowAimHint(input({ hasAim: true }))).toBe(false);
  });

  it("never appears again once the reader has shown they know", () => {
    // Retired by dismissing it, or by asking once with something selected —
    // which is the behaviour it was asking for.
    expect(shouldShowAimHint(input({ learned: true }))).toBe(false);
  });

  it("keeps out of a case drill", () => {
    // A drill's subject is the patient, and what is being typed is an answer
    // rather than a question about a structure. Telling someone mid-diagnosis
    // to go and click an organ is advice for a different task.
    expect(shouldShowAimHint(input({ mode: "case" }))).toBe(false);
  });

  it("appears in review, where the reader can still point at anatomy", () => {
    expect(shouldShowAimHint(input({ mode: "review" }))).toBe(true);
  });
});
