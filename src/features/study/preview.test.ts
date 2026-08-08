import { describe, expect, it } from "vitest";

import { preview } from "./StudyPanel";

describe("preview", () => {
  it("shows a short note whole", () => {
    expect(preview("Thickest wall — systemic pressure.")).toBe(
      "Thickest wall — systemic pressure.",
    );
  });

  it("flattens a note that starts with blank lines", () => {
    // The case that matters: quoting the raw body would show empty space in the
    // dialog, exactly when the reader most needs to see what they are deleting.
    expect(preview("\n\n  Revise the conduction system")).toBe(
      "Revise the conduction system",
    );
  });

  it("collapses the internal line breaks of a multi-line note", () => {
    expect(preview("First line\nSecond line")).toBe("First line Second line");
  });

  it("truncates a long note to the limit, ellipsis included", () => {
    const long = "a".repeat(300);
    const shown = preview(long, 20);
    expect(shown).toHaveLength(20);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("does not truncate a note that exactly fits", () => {
    const exact = "b".repeat(20);
    expect(preview(exact, 20)).toBe(exact);
  });
});
