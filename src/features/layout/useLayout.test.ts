import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { CHAT_LIMITS, TREE_LIMITS, clamp, useLayout } from "./useLayout";

const STORAGE_KEY = "anatria3d.layout.v1";

beforeEach(() => localStorage.clear());

describe("clamp", () => {
  it("keeps a value inside its bounds", () => {
    expect(clamp(50, 100, 400)).toBe(100);
    expect(clamp(900, 100, 400)).toBe(400);
    expect(clamp(250, 100, 400)).toBe(250);
  });
});

describe("useLayout", () => {
  it("starts at the default widths", () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout.treeWidth).toBe(TREE_LIMITS.default);
    expect(result.current.layout.chatWidth).toBe(CHAT_LIMITS.default);
  });

  it("refuses to shrink a panel past its minimum", () => {
    // Without this a fast drag would collapse a panel to nothing, and there
    // would be no handle left to drag it back out with.
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setChatWidth(20));
    expect(result.current.layout.chatWidth).toBe(CHAT_LIMITS.min);
  });

  it("refuses to grow a panel past its maximum", () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setTreeWidth(5000));
    expect(result.current.layout.treeWidth).toBe(TREE_LIMITS.max);
  });

  it("toggles each panel independently", () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.toggleTree());
    expect(result.current.layout.treeCollapsed).toBe(true);
    expect(result.current.layout.chatCollapsed).toBe(false);
  });

  it("restores a persisted layout", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ treeWidth: 320, chatWidth: 500, treeCollapsed: true, chatCollapsed: false }),
    );
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout).toEqual({
      treeWidth: 320,
      chatWidth: 500,
      treeCollapsed: true,
      chatCollapsed: false,
    });
  });

  it("clamps a persisted width that is now out of range", () => {
    // A layout saved by an older build with different limits must not restore
    // a panel wider than the window, leaving no viewport at all.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ treeWidth: 4000, chatWidth: 10 }));
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout.treeWidth).toBe(TREE_LIMITS.max);
    expect(result.current.layout.chatWidth).toBe(CHAT_LIMITS.min);
  });

  it("falls back to defaults when the stored value is corrupt", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useLayout());
    expect(result.current.layout.treeWidth).toBe(TREE_LIMITS.default);
  });

  it("reset returns every panel to its default", () => {
    const { result } = renderHook(() => useLayout());
    act(() => {
      result.current.setTreeWidth(500);
      result.current.toggleChat();
    });
    act(() => result.current.reset());
    expect(result.current.layout.treeWidth).toBe(TREE_LIMITS.default);
    expect(result.current.layout.chatCollapsed).toBe(false);
  });
});

describe("repeated adjustments", () => {
  it("accumulates several keyboard steps rather than collapsing them", () => {
    // Arrow keys fire faster than React re-renders. With absolute updates every
    // press in a frame reads the same rendered width and they all land on the
    // same target — five presses moved one step.
    const { result } = renderHook(() => useLayout());
    const start = result.current.layout.treeWidth;
    act(() => {
      for (let i = 0; i < 5; i++) result.current.setTreeWidth((w) => w + 16);
    });
    expect(result.current.layout.treeWidth).toBe(start + 80);
  });

  it("still clamps when accumulating", () => {
    const { result } = renderHook(() => useLayout());
    act(() => {
      for (let i = 0; i < 100; i++) result.current.setTreeWidth((w) => w + 16);
    });
    expect(result.current.layout.treeWidth).toBe(TREE_LIMITS.max);
  });
});
