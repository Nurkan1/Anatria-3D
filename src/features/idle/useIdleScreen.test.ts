import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIdleScreen } from "./useIdleScreen";

/** Short enough to step over, long enough that one tick is not the whole wait. */
const IDLE = 5_000;

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function press(key: string, over: Partial<KeyboardEventInit> = {}, target?: EventTarget) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...over,
  });
  act(() => {
    (target ?? window).dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the resting screen's clock", () => {
  it("appears once nothing has happened for long enough", () => {
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));

    expect(result.current.showing).toBe(false);
    wait(IDLE + 1_000);
    expect(result.current.showing).toBe(true);
  });

  it("never covers work in flight", () => {
    // A reader who walks away mid-answer comes back to the answer. `armed` is
    // false while a request is streaming or a question sits unsent.
    const { result } = renderHook(() => useIdleScreen({ armed: false, idleMs: IDLE }));

    wait(IDLE * 3);

    expect(result.current.showing).toBe(false);
  });

  it("starts the wait again once the work is done, rather than firing at once", () => {
    // Otherwise finishing a long answer at minute fourteen produces a
    // screensaver a second later, which reads as a glitch.
    const { rerender, result } = renderHook(
      ({ armed }) => useIdleScreen({ armed, idleMs: IDLE }),
      { initialProps: { armed: false } },
    );

    wait(IDLE * 2);
    rerender({ armed: true });
    wait(IDLE - 2_000);
    expect(result.current.showing).toBe(false);

    wait(3_000);
    expect(result.current.showing).toBe(true);
  });

  it("does not count time the window was not visible", () => {
    // Waking to a screensaver you never watched arrive is disorienting, and
    // animating behind another window costs battery for nobody.
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));

    wait(IDLE * 3);

    expect(result.current.showing).toBe(false);
  });

  it("goes away on any sign of a human", () => {
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));
    wait(IDLE + 1_000);
    expect(result.current.showing).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("pointermove"));
    });

    expect(result.current.showing).toBe(false);
  });

  it("does not swallow the key that dismissed it", () => {
    // Focus never moved, so the keystroke reaches whatever had it and the
    // reader carries on with the sentence they had started.
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));
    wait(IDLE + 1_000);

    const event = press("a");

    expect(result.current.showing).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("the Ctrl+X chord", () => {
  it("opens and closes, rather than only opening", () => {
    // Both the activity handler and the toggle see this keystroke. Before they
    // agreed on whose it was, one closed the screen and the other reopened it
    // in the same tick, so the chord could open but never close.
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));

    press("x", { ctrlKey: true });
    expect(result.current.showing).toBe(true);

    press("x", { ctrlKey: true });
    expect(result.current.showing).toBe(false);
  });

  it("works even when the timer is held back", () => {
    // The gate is for the automatic screen. Refusing an explicit request
    // because a draft is open would be the software second-guessing the reader.
    const { result } = renderHook(() => useIdleScreen({ armed: false, idleMs: IDLE }));

    press("x", { ctrlKey: true });

    expect(result.current.showing).toBe(true);
  });

  it("still cuts text when the reader is typing", () => {
    // `Ctrl+X` is "cut" on every desktop there is. Stealing it inside a
    // textarea would break the composer for the sake of a screensaver.
    const box = document.createElement("textarea");
    document.body.append(box);
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));

    const event = press("x", { ctrlKey: true }, box);

    expect(result.current.showing).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    box.remove();
  });

  it("answers to Cmd+X as well, for a Mac keyboard", () => {
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));

    press("x", { metaKey: true });

    expect(result.current.showing).toBe(true);
  });

  it("leaves plain X to the explode shortcut", () => {
    const { result } = renderHook(() => useIdleScreen({ armed: true, idleMs: IDLE }));

    press("x");

    expect(result.current.showing).toBe(false);
  });
});
