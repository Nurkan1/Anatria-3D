import { describe, expect, it, vi } from "vitest";

import { loadVoices, speakableLanguages, voicesForLanguage } from "./speech";

/**
 * The rule these protect is not a preference: a voice with
 * `localService === false` sends the text to the vendor's servers, and an
 * answer about a reader's anatomy question is not something to hand to a third
 * party. Losing a voice is the acceptable outcome; using a remote one is not.
 */

function voice(partial: Partial<SpeechSynthesisVoice>): SpeechSynthesisVoice {
  return {
    name: "Test",
    lang: "en-US",
    localService: true,
    default: false,
    voiceURI: "test",
    ...partial,
  } as SpeechSynthesisVoice;
}

describe("voicesForLanguage", () => {
  it("never returns a network-backed voice", () => {
    const voices = [
      voice({ name: "Cloud", lang: "es-ES", localService: false }),
      voice({ name: "Installed", lang: "es-ES", localService: true }),
    ];

    expect(voicesForLanguage(voices, "es").map((v) => v.name)).toEqual(["Installed"]);
  });

  it("reports nothing rather than falling back to a remote voice", () => {
    // The honest outcome on a machine whose only Bulgarian voice is a cloud
    // one: the feature is unavailable for that language, and says so.
    const voices = [voice({ name: "Cloud", lang: "bg-BG", localService: false })];

    expect(voicesForLanguage(voices, "bg")).toEqual([]);
  });

  it("matches on the primary subtag, in either separator", () => {
    const voices = [
      voice({ name: "Hyphen", lang: "es-MX" }),
      voice({ name: "Underscore", lang: "es_ES" }),
      voice({ name: "Bare", lang: "es" }),
      voice({ name: "Other", lang: "en-GB" }),
    ];

    expect(voicesForLanguage(voices, "es").map((v) => v.name).sort()).toEqual([
      "Bare",
      "Hyphen",
      "Underscore",
    ]);
  });

  it("does not mistake a different language that starts the same", () => {
    // `bg` must not match `bn`, and a naive prefix test would.
    const voices = [voice({ name: "Bengali", lang: "bn-IN" })];

    expect(voicesForLanguage(voices, "bg")).toEqual([]);
  });

  it("puts the platform's default for the language first", () => {
    const voices = [
      voice({ name: "Alpha", lang: "en-US", default: false }),
      voice({ name: "Zulu", lang: "en-US", default: true }),
    ];

    expect(voicesForLanguage(voices, "en")[0]?.name).toBe("Zulu");
  });

  it("speaks English when the reader never chose a language", () => {
    const voices = [
      voice({ name: "Spanish", lang: "es-ES" }),
      voice({ name: "English", lang: "en-GB" }),
    ];

    expect(voicesForLanguage(voices, "auto").map((v) => v.name)).toEqual(["English"]);
  });
});

describe("speakableLanguages", () => {
  it("reports only the app's own languages, in a stable order", () => {
    const voices = [
      voice({ lang: "bg-BG" }),
      voice({ lang: "fr-FR" }),
      voice({ lang: "es-ES" }),
    ];

    // French is installed and irrelevant: the assistant does not write in it.
    expect(speakableLanguages(voices)).toEqual(["es", "bg"]);
  });

  it("does not count a cloud voice as something this computer can speak", () => {
    const voices = [voice({ lang: "es-ES", localService: false })];

    expect(speakableLanguages(voices)).toEqual([]);
  });
});

describe("loadVoices", () => {
  function fakeSynth(script: { first: SpeechSynthesisVoice[]; later?: SpeechSynthesisVoice[] }) {
    const listeners: Array<() => void> = [];
    let current = script.first;

    return {
      synth: {
        getVoices: () => current,
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: vi.fn(),
      } as unknown as SpeechSynthesis,
      announce: () => {
        current = script.later ?? script.first;
        for (const fn of listeners) fn();
      },
    };
  }

  it("returns immediately when the platform already has them", async () => {
    const { synth } = fakeSynth({ first: [voice({ name: "Ready" })] });

    await expect(loadVoices(synth)).resolves.toHaveLength(1);
  });

  it("waits for voiceschanged when the first read is empty", async () => {
    // Chromium's first `getVoices()` is empty on every launch. Reading once and
    // believing it is how a machine with thirty voices reports having none.
    const { synth, announce } = fakeSynth({ first: [], later: [voice({ name: "Late" })] });

    const pending = loadVoices(synth);
    announce();

    expect((await pending).map((v) => v.name)).toEqual(["Late"]);
  });

  it("gives up quietly when the event never comes", async () => {
    // WebKitGTK can be built without speech synthesis. That is a supported
    // state, not an error, so it resolves empty rather than rejecting.
    vi.useFakeTimers();
    const { synth } = fakeSynth({ first: [] });

    const pending = loadVoices(synth, 2000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toEqual([]);
    vi.useRealTimers();
  });
});
