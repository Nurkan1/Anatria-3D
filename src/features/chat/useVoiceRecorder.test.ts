import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useVoiceRecorder } from "./useVoiceRecorder";

/**
 * What is worth testing here is the degradation, not the happy path.
 *
 * A machine with no microphone and a reader who refuses the permission are
 * both ordinary, and both must land back on the typed interface with a
 * sentence saying why. The failure this guards against is the silent one: a
 * button that does nothing, which is indistinguishable from a broken app.
 *
 * jsdom has no `MediaRecorder` and no real microphone, so the browser side is
 * stubbed. That is the boundary this hook owns — everything past it belongs to
 * WebKitGTK and is verified by running the app.
 */

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

describe("useVoiceRecorder", () => {
  it("degrades to the typed interface when there is no microphone API", async () => {
    setMediaDevices(undefined);
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("unavailable");
    expect(result.current.error).toBeTruthy();
  });

  it("says the microphone was refused, and invites typing instead", async () => {
    setMediaDevices({
      getUserMedia: vi
        .fn()
        .mockRejectedValue(new DOMException("denied", "NotAllowedError")),
    });
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("unavailable");
    expect(result.current.error).toContain("refused");
    expect(result.current.error).toContain("type");
  });

  it("treats a stream with no audio track as unavailable, and releases it", async () => {
    // The WebKitGTK failure the permission handler exists to prevent:
    // `getUserMedia` resolves, but nothing is actually being captured.
    const stop = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({
        getAudioTracks: () => [],
        getTracks: () => [{ stop }],
      }),
    });
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("unavailable");
    // The microphone must not be left open just because it gave us nothing.
    expect(stop).toHaveBeenCalled();
  });

  it("stopping without having started yields nothing rather than throwing", async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    let clip: unknown;
    await act(async () => {
      clip = await result.current.stop();
    });

    expect(clip).toBeNull();
  });

  it("releases the microphone when the component goes away mid-recording", async () => {
    const stop = vi.fn();
    const track = { stop };
    class FakeRecorder {
      state = "recording";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      addEventListener = vi.fn();
    }
    vi.stubGlobal(
      "MediaRecorder",
      Object.assign(FakeRecorder, { isTypeSupported: () => true }),
    );
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      }),
    });

    const { result, unmount } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    unmount();

    // A recording indicator still burning after the reader has moved on is
    // alarming, and on Linux entirely believable as a bug.
    expect(stop).toHaveBeenCalled();
  });
});
