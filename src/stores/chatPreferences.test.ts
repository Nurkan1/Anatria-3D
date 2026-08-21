import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_PREFERENCES,
  chatPreferences,
  patchChatPreferences,
  rememberModel,
  reloadChatPreferences,
  sanitiseChatPreferences,
} from "./chatPreferences";

describe("sanitiseChatPreferences", () => {
  it("keeps a complete, valid record", () => {
    expect(
      sanitiseChatPreferences({
        provider: "anthropic",
        profile: "clinician",
        language: "es",
        model: { anthropic: "claude-sonnet-5" },
      }),
    ).toEqual({
      provider: "anthropic",
      profile: "clinician",
      language: "es",
      model: { anthropic: "claude-sonnet-5" },
    });
  });

  it.each([null, undefined, 42, "google", []])("treats %p as absent", (raw) => {
    expect(sanitiseChatPreferences(raw)).toEqual({});
  });

  /**
   * The regression that matters most: one bad field must not cost the others.
   * A provider renamed between builds would otherwise silently reset the
   * reader's answer language too, which is a louder failure than the one it is
   * recovering from.
   */
  it("drops only the fields it cannot read", () => {
    expect(
      sanitiseChatPreferences({ provider: "mistral", profile: "student", language: "bg" }),
    ).toEqual({ profile: "student", language: "bg" });
  });

  it("drops model entries for unknown providers and empty ids", () => {
    expect(
      sanitiseChatPreferences({
        model: { google: "gemini-3.1-flash-lite", mistral: "large", openai: "  " },
      }),
    ).toEqual({ model: { google: "gemini-3.1-flash-lite" } });
  });

  it("ignores a drawer state that is not a boolean", () => {
    expect(sanitiseChatPreferences({ settingsOpen: "yes" })).toEqual({});
  });

  it("ignores a model map that is not an object", () => {
    expect(sanitiseChatPreferences({ model: "gpt-5.2" })).toEqual({});
  });
});

describe("the stored snapshot", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadChatPreferences();
  });

  it("starts from the defaults when nothing is stored", () => {
    expect(chatPreferences()).toEqual(DEFAULT_CHAT_PREFERENCES);
  });

  it("survives a reload", () => {
    patchChatPreferences({ provider: "openai", language: "es" });
    reloadChatPreferences();
    expect(chatPreferences().provider).toBe("openai");
    expect(chatPreferences().language).toBe("es");
    // Untouched fields keep their defaults rather than becoming undefined.
    expect(chatPreferences().profile).toBe(DEFAULT_CHAT_PREFERENCES.profile);
  });

  /**
   * Two owners write this record — the panel and `modelStore`. Neither may
   * erase the other's field, which a read-modify-write from each would do.
   */
  it("merges writes from both owners instead of clobbering", () => {
    patchChatPreferences({ provider: "anthropic" });
    rememberModel("anthropic", "claude-opus-5");
    patchChatPreferences({ language: "en" });

    reloadChatPreferences();
    expect(chatPreferences()).toMatchObject({
      provider: "anthropic",
      language: "en",
      model: { anthropic: "claude-opus-5" },
    });
  });

  it("remembers a model per provider", () => {
    rememberModel("google", "gemini-3.1-pro");
    rememberModel("openai", "gpt-5.2");
    reloadChatPreferences();
    expect(chatPreferences().model).toEqual({
      google: "gemini-3.1-pro",
      openai: "gpt-5.2",
    });
  });

  /**
   * The drawer can open itself when a provider reports no key, and used to have
   * no way back — whatever opened it stayed open for the session and returned
   * at the next launch. Collapsing it has to be a decision that sticks.
   */
  it("remembers the drawer collapsed", () => {
    patchChatPreferences({ settingsOpen: true });
    patchChatPreferences({ settingsOpen: false });
    reloadChatPreferences();
    expect(chatPreferences().settingsOpen).toBe(false);
  });

  it("starts collapsed when nothing has been decided", () => {
    expect(chatPreferences().settingsOpen).toBe(false);
  });

  it("keeps the drawer state independent of the other settings", () => {
    patchChatPreferences({ settingsOpen: true });
    patchChatPreferences({ provider: "openai" });
    reloadChatPreferences();
    expect(chatPreferences()).toMatchObject({ settingsOpen: true, provider: "openai" });
  });

  it("falls back to the defaults when the stored value is not JSON", () => {
    localStorage.setItem("anatria3d.chat.v1", "{not json");
    reloadChatPreferences();
    expect(chatPreferences()).toEqual(DEFAULT_CHAT_PREFERENCES);
  });
});

describe("spoken speed and volume", () => {
  it("defaults to the voice's own pace and level", () => {
    // Nobody should have to opt in to normal. A build that shipped 0.8 here
    // would have every reader wondering why the app talks slowly.
    expect(DEFAULT_CHAT_PREFERENCES.spokenSpeed).toBe(1);
    expect(DEFAULT_CHAT_PREFERENCES.spokenVolume).toBe(1);
  });

  it("keeps a speed the slider could have produced", () => {
    expect(sanitiseChatPreferences({ spokenSpeed: 0.8 })).toEqual({ spokenSpeed: 0.8 });
  });

  it("pulls a stored speed of zero up into range", () => {
    // The one value that must never reach the synthesiser: pace is inverted
    // into `length_scale` there, so zero is a division by zero rather than
    // merely a strange reading.
    expect(sanitiseChatPreferences({ spokenSpeed: 0 })).toEqual({ spokenSpeed: 0.5 });
  });

  it("pulls an absurd speed down rather than discarding it", () => {
    expect(sanitiseChatPreferences({ spokenSpeed: 40 })).toEqual({ spokenSpeed: 2 });
  });

  it("ignores a speed that was never a number", () => {
    // Distinct from clamping: no key at all means the default applies, which
    // is what a corrupted or hand-edited file should get.
    expect(sanitiseChatPreferences({ spokenSpeed: "fast" })).toEqual({});
    expect(sanitiseChatPreferences({ spokenSpeed: Number.NaN })).toEqual({});
  });

  it("clamps volume the same way", () => {
    expect(sanitiseChatPreferences({ spokenVolume: 0 })).toEqual({ spokenVolume: 0.1 });
    expect(sanitiseChatPreferences({ spokenVolume: 9 })).toEqual({ spokenVolume: 1 });
  });
});
