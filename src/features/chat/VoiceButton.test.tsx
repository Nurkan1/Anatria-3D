import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceButton } from "./VoiceButton";

/**
 * The regression this file exists for.
 *
 * The first version of this component returned *only* a message when the
 * recorder reported `unavailable`, which replaced the button outright. Pressing
 * Speak on a machine whose microphone could not be opened made the control
 * disappear, leaving a line of `text-slate-600` — near-invisible on a dark
 * panel — under the composer. Reported from a real build as "you press Speak
 * and it vanishes and does nothing", which is precisely what it did.
 *
 * Two things must hold: the button survives the failure so it can be pressed
 * again, and the explanation is actually readable.
 */

vi.mock("@/lib/ipc", () => ({
  newRequestId: () => "test-request",
  onEngineEvent: () => Promise.resolve(() => {}),
  transcribeAudio: vi.fn().mockResolvedValue(undefined),
}));

const originalMediaDevices = navigator.mediaDevices;

function setMediaDevices(value: unknown): void {
  Object.defineProperty(navigator, "mediaDevices", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setMediaDevices(originalMediaDevices);
  vi.unstubAllGlobals();
});

describe("VoiceButton", () => {
  it("keeps the button after a failed start, so it can be tried again", async () => {
    // WebKitGTK inside the AppImage: the permission is granted and then no
    // capture device is found, because the bundle has no GStreamer audio
    // source plugin. `getUserMedia` rejects.
    setMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError")),
    });

    render(<VoiceButton language="en" disabled={false} onTranscript={() => {}} />);

    const button = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(button);
    });

    // The button is still on screen — this is the whole point.
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
    expect(screen.getByRole("button")).toBe(button);
  });

  it("explains the failure in a colour that can be read", async () => {
    setMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError")),
    });

    render(<VoiceButton language="en" disabled={false} onTranscript={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("microphone");
    // slate-600 on a dark panel was the bug, not the fix.
    expect(status.className).not.toContain("slate-600");
    expect(status.className).toContain("amber");
  });

  it("says so on the button itself, not only in the message", async () => {
    setMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError")),
    });

    render(<VoiceButton language="en" disabled={false} onTranscript={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toContain("unavailable"),
    );
  });
});
