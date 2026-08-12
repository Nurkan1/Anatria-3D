import { describe, expect, it } from "vitest";

import { repairGluedHeadings } from "./repairMarkdown";

describe("repairGluedHeadings", () => {
  /**
   * The observed case, from an Italian answer where it happened at every
   * heading: the reader saw literal `##` in their prose and the section title
   * swallowed by the paragraph before it.
   */
  it("splits a heading welded to the end of a sentence", () => {
    expect(
      repairGluedHeadings("...durante uno spavento.## 3. Il quadro comando"),
    ).toBe("...durante uno spavento.\n\n## 3. Il quadro comando");
  });

  it.each(["!", "?", ":"])("splits after %s too", (punctuation) => {
    expect(repairGluedHeadings(`Guarda qui${punctuation}### Titolo`)).toBe(
      `Guarda qui${punctuation}\n\n### Titolo`,
    );
  });

  it("repairs every heading in a long answer, not just the first", () => {
    const repaired = repairGluedHeadings("Uno.## Due\n\nTesto.## Tre");
    expect(repaired.match(/\n\n#/g)).toHaveLength(2);
  });

  it("leaves a heading that already begins its line alone", () => {
    const clean = "Un paragrafo.\n\n## Un titolo\n\nAltro testo.";
    expect(repairGluedHeadings(clean)).toBe(clean);
  });

  it("leaves prose with no hash untouched", () => {
    const prose = "Il nervo vago porta le fibre parasimpatiche al cuore.";
    expect(repairGluedHeadings(prose)).toBe(prose);
  });

  // A false positive damages text that was fine; a missed repair costs two
  // visible hashes. These pin the conservative side of that trade.
  it("does not touch a hash that is not followed by a space", () => {
    expect(repairGluedHeadings("Vedi il problema #3 nel testo.")).toBe(
      "Vedi il problema #3 nel testo.",
    );
  });

  it("does not touch a hash welded to a letter rather than punctuation", () => {
    expect(repairGluedHeadings("C## is a language")).toBe("C## is a language");
  });

  it("does not touch a hash that already has a space before it", () => {
    expect(repairGluedHeadings("la sezione # 3 del manuale")).toBe(
      "la sezione # 3 del manuale",
    );
  });

  it("ignores more than six hashes, which is not a heading", () => {
    expect(repairGluedHeadings("Fine.####### non un titolo")).toBe(
      "Fine.####### non un titolo",
    );
  });

  /** A hash inside fenced code is a comment or a prompt, never a heading. */
  it("leaves fenced code alone", () => {
    const fenced = 'Esempio:\n\n```bash\necho "fatto.";## non un titolo\n```\n';
    expect(repairGluedHeadings(fenced)).toBe(fenced);
  });

  it("resumes repairing after a fence closes", () => {
    const source = "```\ncodice.## dentro\n```\n\nProsa.## Titolo";
    const repaired = repairGluedHeadings(source);
    expect(repaired).toContain("codice.## dentro");
    expect(repaired).toContain("Prosa.\n\n## Titolo");
  });

  it("handles an unterminated fence without repairing inside it", () => {
    // A streaming answer is regularly parsed mid-code-block.
    const source = "Testo.## Titolo\n\n```python\nx = 1  # nota.## non un titolo";
    const repaired = repairGluedHeadings(source);
    expect(repaired).toContain("Testo.\n\n## Titolo");
    expect(repaired).toContain("nota.## non un titolo");
  });

  it("has nothing to do with an empty answer", () => {
    expect(repairGluedHeadings("")).toBe("");
  });
});
