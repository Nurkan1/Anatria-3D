import { describe, expect, it } from "vitest";

import { SCANNER_CROSSING_MAX, scannerAim, type ScannerAimInput } from "./scannerContext";

const HEART = {
  organ_id: "heart",
  ta2_latin: "Cor",
  name_en: "Heart",
  system: "cardiovascular" as const,
};

/** The scanner pinned at T8 in a tutoring session, nothing selected. */
function at(overrides: Partial<ScannerAimInput> = {}): ScannerAimInput {
  return {
    enabled: true,
    still: true,
    plane: "axial",
    mode: "tutor",
    selected: 0,
    level: "T8",
    organIds: ["heart", "unknown"],
    total: 180,
    organ: (id) => (id === "heart" ? HEART : null),
    ...overrides,
  };
}

describe("scannerAim", () => {
  it("tells the assistant the level and what the plane crosses", () => {
    expect(scannerAim(at())).toEqual({ level: "T8", crossing: [HEART], total: 180 });
  });

  it("gives way to a selection", () => {
    // The selection is the more specific statement of what the reader means.
    expect(scannerAim(at({ selected: 1 }))).toBeNull();
  });

  it("says nothing while the light is travelling", () => {
    expect(scannerAim(at({ still: false }))).toBeNull();
  });

  it("says nothing with the scanner off", () => {
    expect(scannerAim(at({ enabled: false }))).toBeNull();
  });

  it("says nothing for a frontal plane", () => {
    // "This part" of a plane that runs head to foot is most of the body.
    expect(scannerAim(at({ plane: "front" }))).toBeNull();
  });

  it("stays out of drills and reviews", () => {
    expect(scannerAim(at({ mode: "case" }))).toBeNull();
    expect(scannerAim(at({ mode: "review" }))).toBeNull();
  });

  it("still helps between two vertebrae, from what is crossed", () => {
    expect(scannerAim(at({ level: null }))?.crossing).toEqual([HEART]);
  });

  it("says nothing when there is nothing to say", () => {
    expect(scannerAim(at({ level: null, organIds: [] }))).toBeNull();
  });

  it("names a handful and counts the rest", () => {
    const many = Array.from({ length: 30 }, (_, index) => `s${index}`);
    const aim = scannerAim(
      at({ organIds: many, total: 30, organ: (id) => ({ ...HEART, organ_id: id }) }),
    );
    expect(aim?.crossing).toHaveLength(SCANNER_CROSSING_MAX);
    expect(aim?.total).toBe(30);
  });
});
