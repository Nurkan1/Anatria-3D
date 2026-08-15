import { describe, expect, it } from "vitest";

import { systemIsOpen } from "./AnatomyTree";

/**
 * A default that has to be undone on every launch is not a default.
 *
 * Five systems used to open themselves because they held fewer than sixty
 * structures, so opening the app meant reaching for "Collapse all" before doing
 * anything else. These pin the decision so a future size heuristic — however
 * reasonable it looks in isolation — fails here rather than in someone's daily
 * first click.
 */
describe("systemIsOpen", () => {
  it("starts a system nobody has touched closed", () => {
    expect(systemIsOpen({}, "digestive")).toBe(false);
    expect(systemIsOpen({}, "nervous")).toBe(false);
  });

  it("opens only what was actually opened", () => {
    const expanded = { digestive: true, nervous: false };

    expect(systemIsOpen(expanded, "digestive")).toBe(true);
    expect(systemIsOpen(expanded, "nervous")).toBe(false);
    expect(systemIsOpen(expanded, "skeletal")).toBe(false);
  });

  it("treats a closed system as closed rather than as unset", () => {
    // The difference matters to the global toggle: `undefined` and `false` have
    // to reach the same answer, or "Collapse all" would leave a system open
    // that the button had already counted as shut.
    expect(systemIsOpen({ renal: false }, "renal")).toBe(
      systemIsOpen({}, "renal"),
    );
  });
});
