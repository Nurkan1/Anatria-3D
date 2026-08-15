import { describe, expect, it } from "vitest";

import {
  depthReadingState,
  DISMISS_HINT,
  HEADING,
  SUBHEADING,
  type DepthReading,
} from "./depthReading";

const ALL: DepthReading[] = ["live", "pinned"];

describe("depthReadingState", () => {
  it("lets a click win over whatever the pointer is crossing", () => {
    // Both are true at once while a reading is pinned — the probe keeps
    // running underneath, because suppressing it would make the next click
    // pin the previous column.
    expect(depthReadingState(true)).toBe("pinned");
  });

  it("otherwise the panel is simply following the cursor", () => {
    expect(depthReadingState(false)).toBe("live");
  });
});

describe("what the panel says about itself", () => {
  it("has wording for every state, with none left to fall through", () => {
    // The failure this guards is not a wrong pixel: it is a state arriving
    // later and quietly reusing whichever branch happened to be last.
    for (const state of ALL) {
      expect(HEADING[state]).toBeTruthy();
      expect(SUBHEADING[state]).toBeTruthy();
      expect(DISMISS_HINT[state]).toBeTruthy();
    }
  });

  it("never claims the pointer is somewhere it is not", () => {
    // "Under the cursor" is a claim about where the pointer is, and only one
    // of these two states can honestly make it.
    expect(HEADING.live).toMatch(/cursor/i);
    expect(HEADING.pinned).not.toMatch(/cursor/i);
  });

  it("gives each state its own heading, so the change is visible", () => {
    expect(new Set(ALL.map((state) => HEADING[state])).size).toBe(ALL.length);
  });
});
