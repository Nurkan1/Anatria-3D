import { describe, expect, it } from "vitest";

import { layoutLabels, type LabelAnchor } from "./labelLayout";

const VIEW = { width: 1000, height: 600, lineHeight: 20, margin: 10, padding: 16, gap: 64 };

const anchor = (id: string, x: number, y: number): LabelAnchor => ({ id, text: id, x, y });

/** The property the whole layout exists for. */
function noOverlaps(labels: { side: string; labelY: number }[], lineHeight: number) {
  for (const side of ["left", "right"]) {
    const column = labels
      .filter((label) => label.side === side)
      .map((label) => label.labelY)
      .sort((a, b) => a - b);
    for (let i = 1; i < column.length; i += 1) {
      expect(column[i]! - column[i - 1]!).toBeGreaterThanOrEqual(lineHeight - 1e-6);
    }
  }
}

describe("layoutLabels", () => {
  it("stands the columns off from the anatomy, not from the window", () => {
    // Pinned to the viewport edges, two labels on a wide screen produced two
    // metre-long leader lines crossing an empty background.
    const placed = layoutLabels([anchor("a", 400, 300), anchor("b", 600, 300)], VIEW);
    const byId = Object.fromEntries(placed.map((label) => [label.id, label]));

    expect(byId.a!.side).toBe("left");
    expect(byId.a!.labelX).toBe(400 - VIEW.gap);
    expect(byId.b!.side).toBe("right");
    expect(byId.b!.labelX).toBe(600 + VIEW.gap);
  });

  it("falls back to the window edge when the subject fills the frame", () => {
    const placed = layoutLabels([anchor("a", 20, 300), anchor("b", 980, 300)], VIEW);
    const byId = Object.fromEntries(placed.map((label) => [label.id, label]));

    expect(byId.a!.labelX).toBe(VIEW.margin);
    expect(byId.b!.labelX).toBe(VIEW.width - VIEW.margin);
  });

  it("splits about the anatomy's midline, not the window's", () => {
    // A subject off to one side would otherwise send every name to one column.
    const placed = layoutLabels(
      [anchor("a", 700, 200), anchor("b", 900, 400)],
      VIEW,
    );
    const sides = Object.fromEntries(placed.map((l) => [l.id, l.side]));
    expect(sides).toEqual({ a: "left", b: "right" });
  });

  it("keeps a label level with its structure when nothing is in the way", () => {
    const [placed] = layoutLabels([anchor("a", 100, 300)], VIEW);
    expect(placed!.labelY).toBe(300);
    // The anchor is untouched — the leader line has to reach the real place.
    expect(placed!.x).toBe(100);
    expect(placed!.y).toBe(300);
  });

  it("separates labels that would otherwise sit on top of each other", () => {
    // Seventeen parts of a heart project into a few dozen pixels. Unstacked,
    // the names are one illegible smear.
    const crowded = Array.from({ length: 12 }, (_, index) =>
      anchor(`part${index}`, 300, 300 + index),
    );
    const placed = layoutLabels(crowded, VIEW);

    expect(placed).toHaveLength(12);
    noOverlaps(placed, VIEW.lineHeight);
  });

  it("keeps a full column inside the viewport", () => {
    // The downward pass alone runs the last labels off the bottom.
    const many = Array.from({ length: 24 }, (_, index) =>
      anchor(`part${index}`, 200, 560 + index),
    );
    const placed = layoutLabels(many, VIEW);

    for (const label of placed) {
      expect(label.labelY).toBeGreaterThanOrEqual(VIEW.padding - 1e-6);
      expect(label.labelY).toBeLessThanOrEqual(VIEW.height - VIEW.padding + 1e-6);
    }
    noOverlaps(placed, VIEW.lineHeight);
  });

  it("keeps the vertical order of the structures it names", () => {
    // A leader line that crosses its neighbour's is worse than no line.
    const placed = layoutLabels(
      [anchor("low", 200, 500), anchor("high", 200, 100), anchor("mid", 200, 300)],
      VIEW,
    );
    const order = placed.sort((a, b) => a.labelY - b.labelY).map((label) => label.id);
    expect(order).toEqual(["high", "mid", "low"]);
  });

  it("drops a structure that is behind the camera", () => {
    // Its projection lands mirrored in front, so the label would point
    // confidently at the wrong place.
    const placed = layoutLabels(
      [{ ...anchor("back", 500, 300), behind: true }, anchor("front", 400, 300)],
      VIEW,
    );
    expect(placed.map((label) => label.id)).toEqual(["front"]);
  });

  it("drops a structure that is off screen", () => {
    const placed = layoutLabels(
      [anchor("off", -40, 300), anchor("below", 300, 900), anchor("on", 300, 300)],
      VIEW,
    );
    expect(placed.map((label) => label.id)).toEqual(["on"]);
  });

  it("refuses more labels than a column can hold rather than piling them up", () => {
    const capacity = Math.floor((VIEW.height - 2 * VIEW.padding) / VIEW.lineHeight) + 1;
    const flood = Array.from({ length: 200 }, (_, index) =>
      anchor(`part${index}`, 200, 300),
    );
    const placed = layoutLabels(flood, VIEW);

    expect(placed.length).toBe(capacity);
    noOverlaps(placed, VIEW.lineHeight);
  });

  it("survives a viewport too small for anything", () => {
    expect(() =>
      layoutLabels([anchor("a", 5, 5)], { width: 10, height: 10 }),
    ).not.toThrow();
  });

  it("returns nothing for nothing", () => {
    expect(layoutLabels([], VIEW)).toEqual([]);
  });

  it("ignores a projection that came out as NaN", () => {
    const placed = layoutLabels([{ id: "x", text: "x", x: NaN, y: 300 }], VIEW);
    expect(placed).toEqual([]);
  });
});
