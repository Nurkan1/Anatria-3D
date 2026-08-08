import { describe, expect, it } from "vitest";

import { whenLabel } from "./whenLabel";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

describe("whenLabel", () => {
  it("calls the last day today and the one before it yesterday", () => {
    expect(whenLabel(NOW, NOW)).toBe("today");
    expect(whenLabel(NOW - DAY + 1, NOW)).toBe("today");
    expect(whenLabel(NOW - DAY, NOW)).toBe("yesterday");
  });

  it("counts days inside the week", () => {
    expect(whenLabel(NOW - 3 * DAY, NOW)).toBe("3 days ago");
    expect(whenLabel(NOW - 6 * DAY, NOW)).toBe("6 days ago");
  });

  it("switches to a date once counting stops helping", () => {
    // "43 days ago" is a number the reader has to do arithmetic on.
    expect(whenLabel(NOW - 7 * DAY, NOW)).toMatch(/2026/);
  });

  it("does not report a future timestamp as negative days", () => {
    // Clock skew, or a row written in the same millisecond the panel renders.
    expect(whenLabel(NOW + 5 * DAY, NOW)).toBe("today");
  });
});
