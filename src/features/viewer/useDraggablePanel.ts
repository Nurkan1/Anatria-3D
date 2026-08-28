import { useCallback, useEffect, useRef, useState } from "react";
import { readLocal, removeLocal, writeLocal } from "@/lib/localStore";

/**
 * A floating panel the reader can put where they want it, remembered.
 *
 * An overlay pinned to one spot is always in someone's way eventually — the
 * study list sits over the top of the model, which is exactly where the feet
 * are when you are looking at a skeleton from below. Where it belongs depends
 * on what is being studied, so it is the reader's call, not ours.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Keep a panel inside its container.
 *
 * Fully inside, not merely overlapping: a panel dragged half off the edge can
 * be dropped somewhere its own drag handle is unreachable, and then there is no
 * way back except clearing storage. Exported for its own test — this is the
 * part with the arithmetic.
 */
export function clampToBounds(
  point: Point,
  panel: { width: number; height: number },
  container: { width: number; height: number },
): Point {
  const maxX = Math.max(container.width - panel.width, 0);
  const maxY = Math.max(container.height - panel.height, 0);
  return {
    x: Math.min(Math.max(point.x, 0), maxX),
    y: Math.min(Math.max(point.y, 0), maxY),
  };
}

function load(key: string): Point | null {
  try {
    const raw = readLocal(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Point>;
    const { x, y } = parsed;
    // A stored value from a corrupted write must not become `NaN` px, which
    // silently removes the panel from the page.
    return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : null;
  } catch {
    return null;
  }
}

/**
 * A panel's open/closed state, remembered between sessions.
 *
 * Same argument as its position: an overlay that reopens every launch in the
 * state *we* chose rather than the one the reader left it in is a chore
 * repeated daily. The default only decides the very first launch.
 *
 * `localStorage` rather than the Tauri store, for the same reason the panel
 * widths use it: it reads synchronously, so the first frame is already right
 * and nothing is seen opening and then shutting.
 */
export function useRememberedFlag(
  storageKey: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = readLocal(storageKey);
      return raw === null ? fallback : raw === "true";
    } catch {
      return fallback;
    }
  });

  const remember = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        writeLocal(storageKey, String(next));
      } catch {
        // A full or disabled store costs the reader this preference next time,
        // which is not worth interrupting the session for.
      }
    },
    [storageKey],
  );

  return [value, remember];
}

export function useDraggablePanel(storageKey: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Point | null>(() => load(storageKey));
  /** Where inside the panel the pointer grabbed it, so it does not jump. */
  const grab = useRef<Point | null>(null);

  const measure = useCallback(() => {
    const node = ref.current;
    const container = node?.offsetParent as HTMLElement | null;
    if (!node || !container) return null;
    return { node: node.getBoundingClientRect(), container: container.getBoundingClientRect() };
  }, []);

  // A window narrowed since the position was saved would otherwise leave the
  // panel parked outside the viewport, with nothing to grab.
  useEffect(() => {
    if (!position) return;
    const reclamp = () => {
      const rects = measure();
      if (!rects) return;
      setPosition((current) =>
        current ? clampToBounds(current, rects.node, rects.container) : current,
      );
    };
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [position, measure]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // The header carries the panel's own controls; a press on one of those is
      // a click, not the start of a drag.
      if ((event.target as HTMLElement).closest("button, input, a")) return;
      const rects = measure();
      if (!rects) return;

      grab.current = {
        x: event.clientX - rects.node.left,
        y: event.clientY - rects.node.top,
      };
      // Seeded from where the panel actually is, so a first drag from the
      // default centred position does not snap it to the corner.
      setPosition(
        clampToBounds(
          {
            x: rects.node.left - rects.container.left,
            y: rects.node.top - rects.container.top,
          },
          rects.node,
          rects.container,
        ),
      );
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [measure],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const held = grab.current;
      const rects = measure();
      if (!held || !rects) return;
      setPosition(
        clampToBounds(
          {
            x: event.clientX - rects.container.left - held.x,
            y: event.clientY - rects.container.top - held.y,
          },
          rects.node,
          rects.container,
        ),
      );
    },
    [measure],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!grab.current) return;
      grab.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      // Written once, on release, rather than on every pointer move.
      try {
        if (position) writeLocal(storageKey, JSON.stringify(position));
      } catch {
        // Losing the remembered spot is not worth interrupting a drag over.
      }
    },
    [position, storageKey],
  );

  /** Put it back where it started. */
  const reset = useCallback(() => {
    grab.current = null;
    setPosition(null);
    try {
      removeLocal(storageKey);
    } catch {
      // Nothing to undo if the store is unavailable.
    }
  }, [storageKey]);

  return {
    ref,
    position,
    moved: position !== null,
    reset,
    /** Spread onto the drag handle. */
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
