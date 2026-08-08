import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFirstRun } from "./useFirstRun";

/**
 * The hook is thin, and all of its behaviour is in how it fails: a storage that
 * cannot be read must not silently cost a first-time reader the guide.
 */

beforeEach(() => localStorage.clear());

describe("useFirstRun", () => {
  it("treats an untouched machine as a first run", () => {
    const { result } = renderHook(() => useFirstRun());
    expect(result.current.firstRun).toBe(true);
  });

  it("stops being a first run once acknowledged, and stays that way", () => {
    const first = renderHook(() => useFirstRun());
    act(() => first.result.current.markSeen());
    expect(first.result.current.firstRun).toBe(false);

    // The next launch is a fresh mount reading the same store.
    const second = renderHook(() => useFirstRun());
    expect(second.result.current.firstRun).toBe(false);
  });

  it("shows the guide again rather than never, when storage is unreadable", () => {
    // Private browsing, a full quota, a wiped profile. Reading the guide twice
    // is a mild annoyance; never seeing it means never learning the app has a
    // right-click menu.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    const { result } = renderHook(() => useFirstRun());
    expect(result.current.firstRun).toBe(true);
    vi.restoreAllMocks();
  });

  it("does not throw when the acknowledgement cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const { result } = renderHook(() => useFirstRun());
    expect(() => act(() => result.current.markSeen())).not.toThrow();
    // Dismissed for this session even though it could not be recorded.
    expect(result.current.firstRun).toBe(false);
    vi.restoreAllMocks();
  });
});
