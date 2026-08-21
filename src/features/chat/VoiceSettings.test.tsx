import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VOICE_MAX_SPEED, VOICE_MIN_SPEED } from "@/lib/schemas";

import { VoiceSettings } from "./VoiceSettings";

/**
 * What this file guards.
 *
 * The pace control has one failure mode that produces no error anywhere: a
 * slider wired backwards still moves, still changes the voice, and does the
 * opposite of its own label. `test_pace_is_inverted_into_piper_s_units` covers
 * the engine's half of that; these cover the interface's — that the slider
 * reports the value it was given and hands back the value it was moved to.
 *
 * The rest is the lesson from `VoiceButton`: a control that vanishes, or whose
 * explanation cannot be read, is the same silent failure as one that does
 * nothing.
 */

function renderPanel(overrides: Partial<Parameters<typeof VoiceSettings>[0]> = {}) {
  const props = {
    language: "en" as const,
    spokenLimit: 0,
    onSpokenLimitChange: vi.fn(),
    spokenSpeed: 1,
    onSpokenSpeedChange: vi.fn(),
    spokenVolume: 1,
    onSpokenVolumeChange: vi.fn(),
    ...overrides,
  };
  render(<VoiceSettings {...props} />);
  return props;
}

describe("VoiceSettings", () => {
  it("shows the pace control without needing anything expanded", () => {
    // The reason this panel was asked for. Behind a disclosure it would be the
    // one setting people want and the one they cannot find.
    renderPanel();
    expect(screen.getByLabelText("Speaking speed")).toBeTruthy();
    expect(screen.getByText("1×")).toBeTruthy();
  });

  it("reports the speed it was given rather than a default", () => {
    renderPanel({ spokenSpeed: 0.8 });
    const slider = screen.getByLabelText("Speaking speed") as HTMLInputElement;
    expect(slider.value).toBe("0.8");
    expect(screen.getByText("0.8×")).toBeTruthy();
  });

  it("hands back the value the slider was moved to", () => {
    const props = renderPanel();
    fireEvent.change(screen.getByLabelText("Speaking speed"), { target: { value: "1.25" } });
    // A number, not the string an input event carries: the preference is
    // clamped numerically and would silently reject a string.
    expect(props.onSpokenSpeedChange).toHaveBeenCalledWith(1.25);
  });

  it("offers the whole range the engine accepts, and no more", () => {
    // Drift here reads to the user as speech failing at exactly the setting
    // they chose, because the engine clamps to its own copy of these bounds.
    renderPanel();
    const slider = screen.getByLabelText("Speaking speed") as HTMLInputElement;
    expect(Number(slider.min)).toBe(VOICE_MIN_SPEED);
    expect(Number(slider.max)).toBe(VOICE_MAX_SPEED);
  });

  it("marks a preset as pressed only when the slider is sitting on it", () => {
    renderPanel({ spokenSpeed: 0.8 });
    expect(screen.getByText("Slower").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Normal").getAttribute("aria-pressed")).toBe("false");
  });

  it("explains which way the slider was moved", () => {
    // The one line telling a reader what they just did. Three distinct
    // sentences, so it is never stale relative to the number beside it.
    renderPanel({ spokenSpeed: 0.8 });
    expect(screen.getByText(/more slowly/i)).toBeTruthy();
  });

  it("keeps volume and length out of the way until asked", () => {
    // Both are set once, if ever. Pace is not.
    renderPanel();
    expect(screen.queryByLabelText("Speaking volume")).toBeNull();

    fireEvent.click(screen.getByText("More options"));
    expect(screen.getByLabelText("Speaking volume")).toBeTruthy();
    expect(screen.getByText("Whole answer")).toBeTruthy();
  });

  it("does not offer a second choice of language", () => {
    // Two language settings that could disagree would produce an answer
    // written in one language and spoken in another, which is worse than
    // either. This reports the answer language; it never competes with it.
    renderPanel({ language: "bg" });
    fireEvent.click(screen.getByText("More options"));
    expect(screen.getByText(/spoken in the answer language above \(BG\)/i)).toBeTruthy();
  });
});
