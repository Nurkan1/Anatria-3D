import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { attributionLine, encodeImageBytes, IMAGE_FOOTER } = await import("./exportView");
const { labelTargets } = await import("./LabelOverlay");

// `name_en` is what carries the side, so a label fixture without it cannot
// exercise the thing labels are for.
const organ = (organ_id: string, ta2_latin: string, name_en = ta2_latin) => ({
  organ_id,
  ta2_latin,
  name_en,
});

describe("labelTargets", () => {
  const organs = {
    a: organ("a", "Musculus deltoideus"),
    b: organ("b", "Musculus biceps brachii"),
    c: organ("c", "Humerus"),
  };

  it("names the side of a paired structure, which the Latin does not carry", () => {
    // Two identical labels on one screen is the failure this prevents: the
    // atlas holds a left and a right vagus under the same Latin term.
    const paired = {
      l: organ("l", "Nervus vagus (X)", "Vagus nerve (X) (left)"),
      r: organ("r", "Nervus vagus (X)", "Vagus nerve (X) (right)"),
    };
    expect(labelTargets(paired, ["l", "r"], null, true).map((t) => t.text)).toEqual([
      "Nervus vagus (X) · left",
      "Nervus vagus (X) · right",
    ]);
  });

  it("names what is selected", () => {
    expect(labelTargets(organs, ["a", "b"], null, true).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("names the isolated region when nothing is selected", () => {
    expect(labelTargets(organs, [], ["b", "c"], true).map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("prefers the selection over the isolation around it", () => {
    // Someone who selected two muscles inside an isolated region wants those
    // two named, not the whole region.
    expect(labelTargets(organs, ["c"], ["a", "b", "c"], true).map((t) => t.id)).toEqual(["c"]);
  });

  it("names nothing when nothing has been chosen", () => {
    // Never "everything visible": three thousand names is not a plate, it is a
    // wall, and choosing is the reader's job.
    expect(labelTargets(organs, [], null, true)).toEqual([]);
  });

  it("labels with the Terminologia Anatomica name", () => {
    expect(labelTargets(organs, ["a"], null, true)[0]!.text).toBe("Musculus deltoideus");
  });

  it("skips a structure that is no longer loaded", () => {
    expect(labelTargets(organs, ["a", "gone"], null, true).map((t) => t.id)).toEqual(["a"]);
  });

  it("caps a huge isolation rather than trying to name all of it", () => {
    const many = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`s${i}`, organ(`s${i}`, `S${i}`)]),
    );
    const ids = Object.keys(many);
    expect(labelTargets(many, [], ids, true).length).toBeLessThan(ids.length);
  });
});

describe("encodeImageBytes", () => {
  it("encodes a small payload the same as btoa would", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(encodeImageBytes(bytes)).toBe(btoa("Hello"));
  });

  it("survives a payload larger than the argument limit", () => {
    // `String.fromCharCode(...bytes)` on a multi-megabyte image throws. A stack
    // overflow is a poor way to learn the export works on a small window and
    // not on a large one.
    const bytes = new Uint8Array(500_000).fill(65);
    expect(() => encodeImageBytes(bytes)).not.toThrow();
    expect(encodeImageBytes(bytes)).toBe(btoa("A".repeat(500_000)));
  });

  it("handles an empty payload", () => {
    expect(encodeImageBytes(new Uint8Array())).toBe("");
  });
});

describe("the exported image's footer", () => {
  const male = {
    credit: "Z-Anatomy / BodyParts3D (DBCLS)",
    attribution: "Meshes adapted from Z-Anatomy…",
    license: "CC-BY-SA-4.0",
  };
  const female = {
    credit: "NIH Human Reference Atlas / Visible Human Female (NLM)",
    attribution: "Meshes from the Human Reference Atlas…",
    license: "CC-BY-4.0",
  };

  it("credits the male atlas and its share-alike licence", () => {
    // The obligation travels with an image that leaves the app — that is the
    // licence, not a courtesy.
    const line = attributionLine(male);
    expect(line).toMatch(/Z-Anatomy/);
    expect(line).toMatch(/BodyParts3D/);
    expect(line).toMatch(/CC BY-SA 4\.0/);
  });

  it("credits the female atlas to the people who actually made it", () => {
    // This line used to be a constant. Every plate exported from the female
    // atlas went out crediting Z-Anatomy — whose work is not in it — under a
    // share-alike licence the HRA's authors never imposed. Wrong in both
    // directions at once.
    const line = attributionLine(female);
    expect(line).toMatch(/Human Reference Atlas/);
    expect(line).toMatch(/CC BY 4\.0/);
    expect(line).not.toMatch(/Z-Anatomy/);
    expect(line).not.toMatch(/BY-SA/);
  });

  it("falls back to the full sentence rather than guessing", () => {
    // Long under a picture, and correct. There is no third option that is
    // honest.
    const line = attributionLine({ attribution: "Meshes from somewhere", license: "CC-BY-4.0" });
    expect(line).toMatch(/Meshes from somewhere/);
  });

  it("carries the educational-use line", () => {
    // A picture of a diseased heart with no context is exactly what should not
    // circulate without one.
    expect(IMAGE_FOOTER.DISCLAIMER).toMatch(/educational use only/i);
    expect(IMAGE_FOOTER.DISCLAIMER).toMatch(/not a medical device/i);
  });
});

describe("labelTargets with the setting off", () => {
  it("still names a single selected structure", () => {
    // The setting is a standing preference about a plate full of labels. It was
    // also, accidentally, what decided whether a numbered reference in an answer
    // pointed at anything — click ④ and nothing on screen said which structure
    // it was. One label cannot clutter a plate.
    const organs = { a: { organ_id: "a", ta2_latin: "Aorta", name_en: "Aorta" } };

    expect(labelTargets(organs, ["a"], null, false).map((t) => t.id)).toEqual(["a"]);
  });

  it("stays quiet for more than one, which is what the setting is about", () => {
    const organs = {
      a: { organ_id: "a", ta2_latin: "Aorta", name_en: "Aorta" },
      b: { organ_id: "b", ta2_latin: "Vena cava", name_en: "Vena cava" },
    };

    expect(labelTargets(organs, ["a", "b"], null, false)).toEqual([]);
  });

  it("does not label a whole isolated region behind the reader's back", () => {
    const organs = { a: { organ_id: "a", ta2_latin: "Aorta", name_en: "Aorta" } };

    expect(labelTargets(organs, [], ["a"], false)).toEqual([]);
  });
});
