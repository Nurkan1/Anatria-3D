import { describe, expect, it } from "vitest";

import { caseMarksFrom, markSeverity } from "./useCaseMarks";

const complaint = (
  organ_id: string,
  symptom: string,
  severity: number | null = 5,
) => ({ organ_id, symptom, severity });

describe("markSeverity", () => {
  it("maps the reader's 0–10 onto the overlay's 0–1", () => {
    expect(markSeverity(0)).toBe(0);
    expect(markSeverity(7)).toBeCloseTo(0.7, 6);
    expect(markSeverity(10)).toBe(1);
  });

  it("shows an unrated complaint at mid scale rather than not at all", () => {
    // A complaint with no number is not a mild complaint — it is one nobody
    // was asked to rate. Rendering it at zero would make it invisible, which
    // is the one reading the reader definitely did not mean.
    expect(markSeverity(null)).toBe(0.5);
  });

  it("clamps a figure the journal would have refused anyway", () => {
    expect(markSeverity(-3)).toBe(0);
    expect(markSeverity(50)).toBe(1);
  });
});

describe("caseMarksFrom", () => {
  it("lights nothing when nothing is marked", () => {
    expect(caseMarksFrom([])).toEqual({});
  });

  it("lights each structure the reader marked", () => {
    const marks = caseMarksFrom([
      complaint("free_upper_limb_l", "Pain radiating down the arm", 7),
      complaint("thorax", "Chest tightness", 4),
    ]);

    expect(Object.keys(marks).sort()).toEqual(["free_upper_limb_l", "thorax"]);
    expect(marks.free_upper_limb_l?.severity).toBeCloseTo(0.7, 6);
    expect(marks.free_upper_limb_l?.pathology).toBe("Pain radiating down the arm");
  });

  it("lights where it was marked and nowhere else", () => {
    // The whole reason the feature exists: the arm is lit, the heart is not,
    // and working out that the second explains the first is the exercise.
    const marks = caseMarksFrom([
      complaint("free_upper_limb_l", "Pain radiating down the arm", 7),
    ]);

    expect(marks).toHaveProperty("free_upper_limb_l");
    expect(marks).not.toHaveProperty("left_ventricle");
  });

  it("lets the worse of two complaints on one structure decide the colour", () => {
    const marks = caseMarksFrom([
      complaint("thorax", "Ache", 3),
      complaint("thorax", "Crushing pain", 9),
    ]);

    expect(Object.keys(marks)).toEqual(["thorax"]);
    expect(marks.thorax?.severity).toBeCloseTo(0.9, 6);
  });

  it("keeps both names when a structure carries two complaints", () => {
    // Colour can only say one thing; the label does not have to drop the other.
    const marks = caseMarksFrom([
      complaint("thorax", "Ache", 9),
      complaint("thorax", "Breathlessness", 3),
    ]);

    expect(marks.thorax?.pathology).toBe("Ache · Breathlessness");
    expect(marks.thorax?.severity).toBeCloseTo(0.9, 6);
  });

  it("keeps an unrated complaint visible beside a rated one", () => {
    const marks = caseMarksFrom([
      complaint("thorax", "Unrated", null),
      complaint("thorax", "Mild", 2),
    ]);

    // 0.5 beats 0.2, so the unrated one is not buried by a low number.
    expect(marks.thorax?.severity).toBe(0.5);
  });
});
