import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { encodeImageBytes, IMAGE_FOOTER } = await import("./exportView");
const { labelTargets } = await import("./LabelOverlay");

const organ = (organ_id: string, ta2_latin: string) => ({ organ_id, ta2_latin });

describe("labelTargets", () => {
  const organs = {
    a: organ("a", "Musculus deltoideus"),
    b: organ("b", "Musculus biceps brachii"),
    c: organ("c", "Humerus"),
  };

  it("names what is selected", () => {
    expect(labelTargets(organs, ["a", "b"], null).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("names the isolated region when nothing is selected", () => {
    expect(labelTargets(organs, [], ["b", "c"]).map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("prefers the selection over the isolation around it", () => {
    // Someone who selected two muscles inside an isolated region wants those
    // two named, not the whole region.
    expect(labelTargets(organs, ["c"], ["a", "b", "c"]).map((t) => t.id)).toEqual(["c"]);
  });

  it("names nothing when nothing has been chosen", () => {
    // Never "everything visible": three thousand names is not a plate, it is a
    // wall, and choosing is the reader's job.
    expect(labelTargets(organs, [], null)).toEqual([]);
  });

  it("labels with the Terminologia Anatomica name", () => {
    expect(labelTargets(organs, ["a"], null)[0]!.text).toBe("Musculus deltoideus");
  });

  it("skips a structure that is no longer loaded", () => {
    expect(labelTargets(organs, ["a", "gone"], null).map((t) => t.id)).toEqual(["a"]);
  });

  it("caps a huge isolation rather than trying to name all of it", () => {
    const many = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`s${i}`, organ(`s${i}`, `S${i}`)]),
    );
    const ids = Object.keys(many);
    expect(labelTargets(many, [], ids).length).toBeLessThan(ids.length);
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
  it("carries the attribution the asset licence requires", () => {
    // The anatomy is CC BY-SA 4.0. An image that leaves the app takes the
    // obligation with it — that is the licence, not a courtesy.
    expect(IMAGE_FOOTER.ATTRIBUTION).toMatch(/Z-Anatomy/);
    expect(IMAGE_FOOTER.ATTRIBUTION).toMatch(/CC BY-SA 4\.0/);
    expect(IMAGE_FOOTER.ATTRIBUTION).toMatch(/BodyParts3D/);
  });

  it("carries the educational-use line", () => {
    // A picture of a diseased heart with no context is exactly what should not
    // circulate without one.
    expect(IMAGE_FOOTER.DISCLAIMER).toMatch(/educational use only/i);
    expect(IMAGE_FOOTER.DISCLAIMER).toMatch(/not a medical device/i);
  });
});
