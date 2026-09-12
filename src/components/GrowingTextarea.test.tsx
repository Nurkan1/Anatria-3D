import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GROW_LIMIT, GrowingTextarea } from "./GrowingTextarea";

/**
 * jsdom does no layout, so `scrollHeight` is 0 for everything and the component
 * would appear to work whatever it did. This stands in for the one measurement
 * it depends on: twenty pixels a line, which is close enough to real and, more
 * to the point, *changes when the content does*.
 */
const LINE = 20;
let restore: PropertyDescriptor | undefined;

beforeAll(() => {
  restore = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return this.value.split("\n").length * LINE;
    },
  });
});

afterAll(() => {
  if (restore) {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", restore);
  }
});

function Field({ start = "" }: { start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <GrowingTextarea
      value={value}
      onChange={(event) => setValue(event.target.value)}
      rows={3}
      placeholder="write here"
    />
  );
}

function box() {
  return screen.getByPlaceholderText("write here") as HTMLTextAreaElement;
}

function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
}

describe("a field that grows with what is in it", () => {
  it("takes the height of the text it is given", () => {
    render(<Field />);

    type("one\ntwo\nthree\nfour\nfive");

    expect(box().style.height).toBe(`${5 * LINE}px`);
  });

  it("comes back down when the text is deleted", () => {
    // The bug this exists for, and it is the one every hand-rolled version of
    // this has: `scrollHeight` returns the box's own height when that is the
    // larger number, so measuring without collapsing first gives a field that
    // only ever grows. Paste a page, clear it, and the empty box is still a
    // page tall.
    render(<Field />);

    type("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten");
    expect(box().style.height).toBe(`${10 * LINE}px`);

    type("one");

    expect(box().style.height).toBe(`${LINE}px`);
  });

  it("measures what it was handed to begin with, not just what is typed", () => {
    // Editing an existing note starts full. Growing only on change would open
    // it at three rows with a paragraph inside, which is the original problem
    // arriving at the one moment the reader is certain to be reading.
    render(<Field start={"a\nb\nc\nd\ne\nf"} />);

    expect(box().style.height).toBe(`${6 * LINE}px`);
  });

  it("stops growing at the limit rather than pushing its neighbour out", () => {
    // The cap is the whole reason this is safe to put in a flex column. Without
    // it a pasted case takes the transcript's space and keeps taking it.
    render(<Field />);

    expect(box().style.maxHeight).toBe(GROW_LIMIT);
    expect(box().className).toMatch(/overflow-y-auto/);
  });

  it("still refuses the browser's own resize handle", () => {
    // The height is computed now; a drag handle beside it would fight the
    // measurement and lose on the next keystroke.
    render(<Field />);

    expect(box().className).toMatch(/resize-none/);
  });
});

describe("a field in a panel that is switched off", () => {
  /** `display: none` answers every measurement with zero. */
  function measuringNothing(): () => void {
    const stubbed = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 0,
    });
    return () => {
      if (stubbed) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", stubbed);
      }
    };
  }

  it("does not pin itself shut while it cannot be measured", () => {
    // The bug the reader saw: mounted inside the folded assistant panel, the
    // field wrote `height: 0px` and kept it, so unfolding gave a squashed strip
    // instead of a composer. Nothing re-measures it until the text changes.
    const show = measuringNothing();
    try {
      render(<Field start={"a\nb\nc"} />);
      expect(box().style.height).toBe("");
    } finally {
      show();
    }
  });

  it("measures itself the moment it is on screen again", () => {
    const callbacks: ResizeObserverCallback[] = [];
    const previous = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const show = measuringNothing();
    try {
      render(<Field start={"a\nb\nc"} />);
      expect(box().style.height).toBe("");

      // The panel is brought back: the box goes from nothing to its real size,
      // which is what the observer is watching for.
      show();
      for (const callback of callbacks) {
        callback([], {} as ResizeObserver);
      }

      expect(box().style.height).toBe(`${3 * LINE}px`);
    } finally {
      show();
      globalThis.ResizeObserver = previous;
    }
  });
});
