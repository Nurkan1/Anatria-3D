import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Widths of the two side panels, persisted across sessions.
 *
 * Stored in `localStorage` rather than the Tauri store: this is pure window
 * furniture, it must survive a reload with no async round-trip, and reading it
 * synchronously on first render avoids the panels visibly snapping from the
 * default to the saved size.
 */

const STORAGE_KEY = "anatria3d.layout.v1";

export const TREE_LIMITS = { min: 200, max: 560, default: 280 } as const;
export const CHAT_LIMITS = { min: 300, max: 720, default: 380 } as const;

export interface LayoutState {
  treeWidth: number;
  chatWidth: number;
  treeCollapsed: boolean;
  chatCollapsed: boolean;
}

const DEFAULTS: LayoutState = {
  treeWidth: TREE_LIMITS.default,
  chatWidth: CHAT_LIMITS.default,
  treeCollapsed: false,
  chatCollapsed: false,
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * A new width, or a function of the current one — the same shape as `setState`.
 *
 * The functional form is what makes repeated keyboard steps work: several
 * arrow presses in one frame all read the same rendered `width` prop, so
 * absolute updates would collapse into a single step.
 */
export type WidthUpdate = number | ((current: number) => number);

const resolve = (update: WidthUpdate, current: number) =>
  typeof update === "function" ? update(current) : update;

function load(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      // Clamped on read, not just on write: a saved width from an older build
      // with different limits would otherwise restore a panel wider than the
      // window and leave no viewport at all.
      treeWidth: clamp(
        Number(parsed.treeWidth) || DEFAULTS.treeWidth,
        TREE_LIMITS.min,
        TREE_LIMITS.max,
      ),
      chatWidth: clamp(
        Number(parsed.chatWidth) || DEFAULTS.chatWidth,
        CHAT_LIMITS.min,
        CHAT_LIMITS.max,
      ),
      treeCollapsed: Boolean(parsed.treeCollapsed),
      chatCollapsed: Boolean(parsed.chatCollapsed),
    };
  } catch {
    return DEFAULTS;
  }
}

export function useLayout() {
  const [layout, setLayout] = useState<LayoutState>(load);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Debounced: a drag fires dozens of updates a second and every one would
  // otherwise be a synchronous localStorage write on the main thread.
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      } catch {
        // A full or disabled store is not worth interrupting the session for.
      }
    }, 250);
    return () => clearTimeout(saveTimer.current);
  }, [layout]);

  const setTreeWidth = useCallback((width: WidthUpdate) => {
    setLayout((state) => ({
      ...state,
      treeWidth: clamp(resolve(width, state.treeWidth), TREE_LIMITS.min, TREE_LIMITS.max),
    }));
  }, []);

  const setChatWidth = useCallback((width: WidthUpdate) => {
    setLayout((state) => ({
      ...state,
      chatWidth: clamp(resolve(width, state.chatWidth), CHAT_LIMITS.min, CHAT_LIMITS.max),
    }));
  }, []);

  const toggleTree = useCallback(
    () => setLayout((state) => ({ ...state, treeCollapsed: !state.treeCollapsed })),
    [],
  );

  const toggleChat = useCallback(
    () => setLayout((state) => ({ ...state, chatCollapsed: !state.chatCollapsed })),
    [],
  );

  const reset = useCallback(() => setLayout(DEFAULTS), []);

  return { layout, setTreeWidth, setChatWidth, toggleTree, toggleChat, reset };
}
