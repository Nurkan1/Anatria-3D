import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CEILING_MS, FADE_MS, MINIMUM_MS, useSplash } from "./useSplash";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("useSplash", () => {
  it("is there from the first render", () => {
    const { result } = renderHook(() => useSplash(false));
    expect(result.current.visible).toBe(true);
    expect(result.current.leaving).toBe(false);
  });

  it("stays for its minimum even when the atlas is ready instantly", () => {
    // A warm cache loads the manifest in under a tenth of a second. A screen
    // that appears and vanishes in that time reads as a glitch, not an opening.
    const { result } = renderHook(() => useSplash(true));

    advance(MINIMUM_MS - 50);
    expect(result.current.leaving).toBe(false);

    advance(100);
    expect(result.current.leaving).toBe(true);
  });

  it("waits for the atlas rather than leaving on a timer", () => {
    const { result, rerender } = renderHook(({ ready }) => useSplash(ready), {
      initialProps: { ready: false },
    });

    advance(MINIMUM_MS * 3);
    expect(result.current.leaving).toBe(false);

    rerender({ ready: true });
    advance(1);
    expect(result.current.leaving).toBe(true);
  });

  it("leaves anyway if the atlas never arrives", () => {
    // A corrupt install or a missing asset must not leave the reader staring
    // at a logo with no way forward — whatever error the viewer has to show
    // needs its turn.
    const { result } = renderHook(() => useSplash(false));

    advance(CEILING_MS - 100);
    expect(result.current.leaving).toBe(false);

    advance(200);
    expect(result.current.leaving).toBe(true);
  });

  it("unmounts only after the fade has run", () => {
    const { result } = renderHook(() => useSplash(true));
    advance(MINIMUM_MS);
    expect(result.current.visible).toBe(true);

    advance(FADE_MS - 50);
    expect(result.current.visible).toBe(true);

    advance(100);
    expect(result.current.visible).toBe(false);
  });

  it("does not come back once it is gone", () => {
    // The manifest reloading, or a system being switched on, must not put the
    // opening screen back over a session already in progress.
    const { result, rerender } = renderHook(({ ready }) => useSplash(ready), {
      initialProps: { ready: true },
    });
    // Two steps, not one: the fade timer is only scheduled once React has
    // re-rendered in the "leaving" phase, so a single jump past both would
    // outrun a timer that does not exist yet.
    advance(MINIMUM_MS);
    advance(FADE_MS);
    expect(result.current.visible).toBe(false);

    rerender({ ready: false });
    advance(CEILING_MS * 2);
    expect(result.current.visible).toBe(false);
  });
});
