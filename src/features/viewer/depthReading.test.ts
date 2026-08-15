import { describe, expect, it } from "vitest";

import {
  depthReadingState,
  DISMISS_HINT,
  HEADING,
  SUBHEADING,
  type DepthReading,
} from "./depthReading";

const ALL: DepthReading[] = ["live", "held", "pinned"];

describe("depthReadingState", () => {
  it("lets a click win over whatever the pointer is crossing", () => {
    // Both are true at once while a reading is pinned — the probe keeps
    // running underneath, because suppressing it would make the next click
    // pin the previous column. When they disagree the reader's click is the
    // one that meant something.
    expect(depthReadingState(true, true)).toBe("pinned");
    expect(depthReadingState(false, true)).toBe("pinned");
  });

  it("says live only while a reading is actually arriving", () => {
    expect(depthReadingState(true, false)).toBe("live");
  });

  it("falls back to held rather than to live", () => {
    // The safe direction. A stale list labelled "under the cursor" is a wrong
    // claim; a live one labelled "where you last pointed" is merely modest.
    expect(depthReadingState(false, false)).toBe("held");
  });
});

describe("what the panel says about itself", () => {
  it("has wording for every state, with none left to fall through", () => {
    // The failure this guards is not a wrong pixel: it is a fourth state
    // arriving later and quietly reusing whichever branch happened to be last.
    for (const state of ALL) {
      expect(HEADING[state]).toBeTruthy();
      expect(SUBHEADING[state]).toBeTruthy();
      expect(DISMISS_HINT[state]).toBeTruthy();
    }
  });

  it("never claims the pointer is somewhere it is not", () => {
    // "Under the cursor" is a claim about where the pointer is, and only one
    // of these three states can honestly make it.
    expect(HEADING.live).toMatch(/cursor/i);
    expect(HEADING.held).not.toMatch(/cursor/i);
    expect(HEADING.pinned).not.toMatch(/cursor/i);
  });

  it("gives each state its own heading, so the change is visible", () => {
    expect(new Set(ALL.map((state) => HEADING[state])).size).toBe(ALL.length);
  });
});
