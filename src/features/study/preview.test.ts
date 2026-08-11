import { describe, expect, it } from "vitest";

import { isLongNote, NOTE_CLAMP_LINES, preview } from "./StudyPanel";

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

describe("deciding when a note needs clamping", () => {
  it("leaves a short note alone", () => {
    // A "Show more" under two lines is noise pretending to be a feature.
    expect(isLongNote("Mitral valve has two leaflets, not three.")).toBe(false);
  });

  it("offers the control on an answer saved from the assistant", () => {
    expect(isLongNote("x".repeat(400))).toBe(true);
  });

  it("counts a bulleted note by its lines, not its characters", () => {
    // Five short bullets are five lines and barely thirty characters. Length
    // alone would call this short and clamp it anyway, cutting a bullet off
    // with no way to see it.
    const bullets = ["- one", "- two", "- three", "- four", "- five"].join("\n");

    expect(bullets.length).toBeLessThan(40);
    expect(isLongNote(bullets)).toBe(true);
  });

  it("counts a paragraph by how many lines it wraps to", () => {
    const oneLine = "x".repeat(50);
    const fiveLines = "x".repeat(50 * 5);

    expect(isLongNote(oneLine)).toBe(false);
    expect(isLongNote(fiveLines)).toBe(true);
  });

  it("lets exactly the clamped number of lines through unclamped", () => {
    const exactly = Array.from({ length: NOTE_CLAMP_LINES }, () => "short").join("\n");
    const oneMore = Array.from({ length: NOTE_CLAMP_LINES + 1 }, () => "short").join("\n");

    expect(isLongNote(exactly)).toBe(false);
    expect(isLongNote(oneMore)).toBe(true);
  });

  it("counts a blank line, because the clamp does", () => {
    expect(isLongNote("a\n\nb\n\nc")).toBe(true);
  });
});
