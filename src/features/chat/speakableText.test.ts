import { describe, expect, it } from "vitest";

import { MAX_SPOKEN_CHARS, speakableText } from "./speakableText";

/**
 * What matters here is what a listener would hear. A speech engine reads what
 * it is given literally, so every Markdown construct left in the string
 * becomes a spoken word: "hash hash", "asterisk", "bracket bracket
 * left_ventricle".
 */
describe("speakableText", () => {
  it("drops the organ markers the viewport uses", () => {
    const spoken = speakableText("The left ventricle [[left_ventricle]] pumps blood.");
    expect(spoken).toBe("The left ventricle pumps blood.");
  });

  it("reads emphasis as the word, not the punctuation", () => {
    expect(speakableText("The **aorta** is the *largest* artery.")).toBe(
      "The aorta is the largest artery.",
    );
    expect(speakableText("__Systole__ and _diastole_.")).toBe("Systole and diastole.");
  });

  it("strips headings and bullets at the start of a line", () => {
    const spoken = speakableText("## The heart\n\n- Left ventricle\n- Right atrium");
    expect(spoken).toBe("The heart. Left ventricle Right atrium");
  });

  it("keeps a hyphen inside a word", () => {
    // The bullet rule is line-anchored precisely so this survives.
    expect(speakableText("The atrio-ventricular node.")).toBe(
      "The atrio-ventricular node.",
    );
  });

  it("keeps a link's words and loses its URL", () => {
    expect(speakableText("See [the atlas](https://example.com/a/b) for more.")).toBe(
      "See the atlas for more.",
    );
  });

  it("says nothing about a code block", () => {
    const spoken = speakableText("Before\n\n```\nnot speech\n```\n\nAfter");
    expect(spoken).not.toContain("not speech");
    expect(spoken).toContain("Before");
    expect(spoken).toContain("After");
  });

  it("turns a paragraph break into a pause", () => {
    // A full stop is what makes the voice pause where the writing did.
    expect(speakableText("First point.\n\nSecond point.")).toBe(
      "First point.. Second point.",
    );
  });

  it("does not read table pipes aloud", () => {
    expect(speakableText("| Artery | Supplies |")).not.toContain("|");
  });

  it("cuts a long answer at a sentence, not mid-word", () => {
    const sentence = "The left ventricle pumps blood into the aorta. ";
    const spoken = speakableText(sentence.repeat(40));

    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    // Ends where a thought ended, so it sounds finished rather than broken.
    expect(spoken.endsWith(".")).toBe(true);
  });

  it("falls back to a word boundary when there is no sentence to cut at", () => {
    const spoken = speakableText("word ".repeat(400));
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS + 1);
    expect(spoken.endsWith("…")).toBe(true);
    expect(spoken).not.toMatch(/wor…$/);
  });

  it("leaves an ordinary answer completely alone", () => {
    const plain = "The aorta carries oxygenated blood from the left ventricle.";
    expect(speakableText(plain)).toBe(plain);
  });
});
