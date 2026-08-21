import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VoiceSettings } from "./VoiceSettings";

/**
 * These cover the notice, not the sliders.
 *
 * A missing voice is the one state in this panel that is invisible everywhere
 * else: the Read aloud button simply does not appear, and without a line here
 * the reader has nothing to go on. The default assistant language is Bulgarian
 * and Windows ships no Bulgarian voice, so this is the ordinary first-run case,
 * not an edge one.
 */

const voices = vi.hoisted(() => ({ current: [] as SpeechSynthesisVoice[] }));

vi.mock("./useLocalVoices", () => ({
  useLocalVoices: () => voices.current,
}));

function voice(lang: string): SpeechSynthesisVoice {
  return {
    name: `Voice ${lang}`,
    lang,
    localService: true,
    default: false,
    voiceURI: lang,
  } as SpeechSynthesisVoice;
}

function renderPanel(language: "auto" | "en" | "es" | "bg") {
  return render(
    <VoiceSettings
      language={language}
      spokenLimit={0}
      onSpokenLimitChange={vi.fn()}
      spokenSpeed={1}
      onSpokenSpeedChange={vi.fn()}
      spokenVolume={1}
      onSpokenVolumeChange={vi.fn()}
    />,
  );
}

describe("VoiceSettings", () => {
  it("says which language has no voice, and where to get one", () => {
    voices.current = [voice("en-US")];
    renderPanel("bg");

    expect(screen.getByText(/No Bulgarian voice is installed/)).toBeTruthy();
  });

  it("says nothing when the language has a voice", () => {
    voices.current = [voice("bg-BG")];
    renderPanel("bg");

    expect(screen.queryByText(/No Bulgarian voice/)).toBeNull();
  });

  it("stays quiet while the platform is still enumerating", () => {
    // `getVoices()` is empty on the first call in Chromium. Announcing a
    // missing voice here and withdrawing it a moment later would be worse than
    // waiting.
    voices.current = [];
    renderPanel("bg");

    expect(screen.queryByText(/is installed on this computer/)).toBeNull();
  });

  it("offers the languages this computer can speak, on auto", () => {
    // The real case: a Windows PC with Spanish and Bulgarian voices and no
    // English one. `auto` speaks English, so the app fell silent on a machine
    // with two perfectly good voices sitting there.
    voices.current = [voice("es-ES"), voice("bg-BG")];
    renderPanel("auto");

    expect(screen.getByText(/no English voice/)).toBeTruthy();
    expect(screen.getByText(/Spanish and Bulgarian/)).toBeTruthy();
    // Telling someone to install a voice they do not need is the wrong advice.
    expect(screen.queryByText(/Time & language/)).toBeNull();
  });

  it("falls back to install instructions when auto has nothing to offer", () => {
    voices.current = [voice("fr-FR"), voice("de-DE")];
    renderPanel("auto");

    expect(screen.getByText(/No English voice is installed/)).toBeTruthy();
  });

  it("never suggests switching away from a language the reader chose", () => {
    // A reader who picked Bulgarian wants Bulgarian. Offering Spanish would
    // answer a question they did not ask.
    voices.current = [voice("es-ES"), voice("en-US")];
    renderPanel("bg");

    expect(screen.getByText(/No Bulgarian voice is installed/)).toBeTruthy();
    expect(screen.queryByText(/setting the assistant to one of those/)).toBeNull();
  });
});
