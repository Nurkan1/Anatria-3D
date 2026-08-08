import { useCallback, useEffect, useRef } from "react";

import type { WidthUpdate } from "./useLayout";

interface ResizeHandleProps {
  /** Current width of the panel this handle resizes. */
  width: number;
  onResize: (width: WidthUpdate) => void;
  /** Which side the panel sits on — decides which way dragging grows it. */
  side: "left" | "right";
  min: number;
  max: number;
  label: string;
  /** Double-click / Home restores this width. */
  defaultWidth: number;
}

/** How much one arrow-key press moves the divider. */
const STEP = 16;

/**
 * A draggable divider between a side panel and the viewport.
 *
 * Uses pointer capture rather than window-level mouse listeners, so the drag
 * keeps tracking when the cursor crosses the 3D canvas — which swallows pointer
 * events for its own orbit controls and would otherwise strand the drag the
 * moment the user moved fast.
 *
 * It is also a real control, not just a hit area: focusable, arrow-key
 * adjustable, and exposed as a separator with its current value, so the layout
 * can be set without a mouse.
 */
export function ResizeHandle({
  width,
  onResize,
  side,
  min,
  max,
  label,
  defaultWidth,
}: ResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  /** Undoes the document-wide cursor lock, or null when nothing is locked. */
  const unlock = useRef<(() => void) | null>(null);

  /**
   * Hold the resize cursor across the whole document for the duration of a drag.
   *
   * Imperative, and paired directly with the pointer events rather than driven
   * from an effect. `dragging` is a ref, so setting it schedules no render — an
   * effect keyed on it therefore runs at the mercy of whatever else happens to
   * re-render, and on release it may never run at all. That is precisely how
   * the cursor used to be left stuck as a resize arrow for the rest of the
   * session.
   */
  const lockCursor = useCallback(() => {
    if (unlock.current) return;
    const { style } = document.body;
    const previousCursor = style.cursor;
    const previousSelect = style.userSelect;
    style.cursor = "col-resize";
    // Crossing a label mid-drag would otherwise highlight it.
    style.userSelect = "none";
    unlock.current = () => {
      style.cursor = previousCursor;
      style.userSelect = previousSelect;
      unlock.current = null;
    };
  }, []);

  // A panel collapsed or unmounted mid-drag never sees a pointerup. Without
  // this the lock would outlive the handle that owns it.
  useEffect(() => () => unlock.current?.(), []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      dragging.current = true;
      startX.current = event.clientX;
      startWidth.current = width;
      lockCursor();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [width, lockCursor],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const delta = event.clientX - startX.current;
      // A handle on the right-hand panel grows the panel as the pointer moves
      // left, so the delta is inverted there.
      onResize(startWidth.current + (side === "left" ? delta : -delta));
    },
    [onResize, side],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    unlock.current?.();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onResize(defaultWidth)}
      onKeyDown={(event) => {
        // Functional updates, not `width + step`: several presses in one frame
        // all see the same rendered prop, and absolute updates would collapse
        // them into a single step.
        const towardsPanel = side === "left" ? -STEP : STEP;
        if (event.key === "ArrowLeft") onResize((current) => current + towardsPanel);
        else if (event.key === "ArrowRight") onResize((current) => current - towardsPanel);
        else if (event.key === "Home") onResize(defaultWidth);
        else return;
        event.preventDefault();
      }}
      className="group relative w-1 shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-sky-600 focus-visible:bg-sky-500 focus-visible:outline-none"
    >
      {/* Widen the grab area well past the visible line — a 4px target is a
          frustrating thing to hunt for. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
