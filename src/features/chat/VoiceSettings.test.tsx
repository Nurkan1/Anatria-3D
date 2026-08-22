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
  it("says which language it cannot speak, and where to look", () => {
    voices.current = [voice("en-US")];
    renderPanel("bg");

    expect(screen.getByText(/No Bulgarian voice is available/)).toBeTruthy();
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

  it("says which languages it can speak, and which it cannot, on auto", () => {
    // The real case: a Windows PC with Spanish and Bulgarian voices and no
    // English one. `auto` speaks English, so the app fell silent on a machine
    // with two perfectly good voices sitting there.
    voices.current = [voice("es-ES"), voice("bg-BG")];
    renderPanel("auto");

    expect(screen.getByText(/Spanish and Bulgarian/)).toBeTruthy();
    expect(screen.getByText(/English answers cannot be read aloud/)).toBeTruthy();
    // Neither installing a voice nor changing a setting would help here: the
    // voice already follows the language the answer is written in.
    expect(screen.queryByText(/Time & language/)).toBeNull();
    expect(screen.queryByText(/setting the assistant to one of those/)).toBeNull();
  });

  it("falls back to install instructions when auto has nothing to offer", () => {
    voices.current = [voice("fr-FR"), voice("de-DE")];
    renderPanel("auto");

    expect(screen.getByText(/No English voice is available/)).toBeTruthy();
  });

  it("never suggests switching away from a language the reader chose", () => {
    // A reader who picked Bulgarian wants Bulgarian. Offering Spanish would
    // answer a question they did not ask.
    voices.current = [voice("es-ES"), voice("en-US")];
    renderPanel("bg");

    expect(screen.getByText(/No Bulgarian voice is available/)).toBeTruthy();
    expect(screen.queryByText(/setting the assistant to one of those/)).toBeNull();
  });

  it("never claims to know what the computer has installed", () => {
    // It cannot know. On Linux this said "no Spanish voice is installed" to a
    // machine carrying 14,805 of them — WebKitGTK returns four hardcoded names
    // whatever the system has, and marks them all non-local, which the privacy
    // filter rejects. The reader was being sent to install what they had.
    voices.current = [voice("en-US")];
    const { container } = renderPanel("es");

    expect(container.textContent).not.toMatch(/is installed on this computer/);
    expect(container.textContent).toMatch(/available to this app/);
  });
});
