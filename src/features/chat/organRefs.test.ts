import { describe, expect, it } from "vitest";

import { collectOrganRefs, linkifyOrganRefs, REF_SCHEME, stripOrganRefs } from "./organRefs";

const LOADED = new Set(["left_ventricle", "right_atrium", "aortic_valve"]);
const isKnown = (organId: string) => LOADED.has(organId);

describe("collectOrganRefs", () => {
  it("numbers structures in order of first mention", () => {
    const refs = collectOrganRefs(
      "The right atrium [[right_atrium]] fills, then the left ventricle [[left_ventricle]] ejects.",
      isKnown,
    );
    expect(refs).toEqual([
      { organId: "right_atrium", index: 1 },
      { organId: "left_ventricle", index: 2 },
    ]);
  });

  it("keeps one entry per structure however often it is marked", () => {
    const refs = collectOrganRefs(
      "[[left_ventricle]] … [[left_ventricle]] … [[right_atrium]]",
      isKnown,
    );
    expect(refs.map((r) => r.organId)).toEqual(["left_ventricle", "right_atrium"]);
  });

  it("ignores structures that are not loaded", () => {
    // The engine already rejects invented ids at the tool boundary, but nothing
    // validates ids the model merely writes in prose. This is that check.
    const refs = collectOrganRefs("Look at the [[spleen_of_omelas]] here.", isKnown);
    expect(refs).toEqual([]);
  });
});

describe("linkifyOrganRefs", () => {
  it("turns markers into numbered links the renderer can pick up", () => {
    const text = "The left ventricle [[left_ventricle]] is thick.";
    const refs = collectOrganRefs(text, isKnown);
    expect(linkifyOrganRefs(text, refs)).toBe(
      `The left ventricle [1](${REF_SCHEME}left_ventricle) is thick.`,
    );
  });

  it("drops markers for structures that are not loaded", () => {
    // A hallucinated id must cost the reader a link, never leave literal
    // brackets sitting in the middle of a sentence.
    const text = "The [[spleen_of_omelas]] sits nearby.";
    expect(linkifyOrganRefs(text, collectOrganRefs(text, isKnown))).toBe(
      "The  sits nearby.",
    );
  });

  it("reuses the same number for repeated mentions", () => {
    const text = "[[left_ventricle]] and again [[left_ventricle]]";
    const refs = collectOrganRefs(text, isKnown);
    const linked = linkifyOrganRefs(text, refs);
    expect(linked.match(/\[1\]/g)).toHaveLength(2);
  });

  it("survives markers inside other markup", () => {
    const text = "- **Left ventricle** [[left_ventricle]] — thickened";
    const refs = collectOrganRefs(text, isKnown);
    // Emitting a link rather than a bespoke token is what keeps the surrounding
    // list item and bold run parsing normally.
    expect(linkifyOrganRefs(text, refs)).toContain(`[1](${REF_SCHEME}left_ventricle)`);
    expect(linkifyOrganRefs(text, refs)).toContain("**Left ventricle**");
  });
});

describe("stripOrganRefs", () => {
  it("removes markers for copied text", () => {
    expect(stripOrganRefs("The left ventricle [[left_ventricle]] is thick.")).toBe(
      "The left ventricle is thick.",
    );
  });

  it("does not leave a space before punctuation", () => {
    expect(stripOrganRefs("…the aortic valve [[aortic_valve]].")).toBe(
      "…the aortic valve.",
    );
  });
});
