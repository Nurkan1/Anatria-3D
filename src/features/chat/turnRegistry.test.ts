import { describe, expect, it, vi } from "vitest";
import { TurnRegistry, type TurnContext } from "./turnRegistry";

const context: TurnContext = {
  sessionId: "s1", sessionRevision: 0, mode: "tutor", genderModel: "male",
  caseId: null, provider: "openai", model: null, profile: "student", language: "en",
  organIds: ["a"], title: "Question",
};

describe("request lifetimes", () => {
  it.each([
    { sessionId: "s2" }, { sessionRevision: 1 }, { genderModel: "female" as const },
    { caseId: "patient2" }, { mode: "case" as const },
  ])("invalidates synchronously when scope changes: %o", (change) => {
    let scope = { ...context };
    const cancelled = vi.fn();
    const turns = new TurnRegistry(() => scope, cancelled);
    turns.begin("r", scope);
    turns.markSent("r");
    scope = { ...scope, ...change };
    expect(turns.accepts("r")).toBe(false);
    expect(cancelled).toHaveBeenCalledExactlyOnceWith("r", true);
    expect(turns.take("r")).toMatchObject({ active: false, context: { sessionId: "s1" } });
    expect(turns.take("r")).toBeUndefined();
  });

  it("freezes provenance and accounts for cancellation without resurrecting it", () => {
    const scope = { ...context, organIds: ["a"] };
    const turns = new TurnRegistry(() => scope, vi.fn());
    turns.begin("r", scope);
    turns.markSent("r");
    scope.organIds.push("b");
    scope.language = "es";
    expect(turns.take("r")?.context).toMatchObject({ language: "en", organIds: ["a"] });
    turns.begin("cancelled", scope);
    turns.markSent("cancelled");
    turns.invalidate();
    expect(turns.accepts("cancelled")).toBe(false);
    expect(turns.take("cancelled")?.context).toEqual({ sessionId: "s1", provider: "openai" });
  });

  it("does not dispatch a preparation after its session has changed", () => {
    let scope = context;
    const turns = new TurnRegistry(() => scope, vi.fn());
    turns.begin("r", context);
    scope = { ...context, sessionRevision: 1 };
    expect(turns.markSent("r")).toBe(false);
    expect(turns.take("r")).toBeUndefined();
  });
});
