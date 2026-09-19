import { describe, expect, it } from "vitest";

import { calloutPlacement, freeMargins } from "./layout";

const W = 1600;
const H = 900;

describe("freeMargins", () => {
  it("leaves the whole screen when nothing is open", () => {
    expect(freeMargins([], W, H)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("gives up the side a standing panel is on", () => {
    const margins = freeMargins(
      [
        { left: 40, top: 120, right: 400, bottom: 700 },
        { left: 1200, top: 120, right: 1560, bottom: 760 },
      ],
      W,
      H,
      0,
    );
    expect(margins.left).toBe(400);
    expect(margins.right).toBe(400);
  });

  it("gives up the edge a lying panel is on", () => {
    const margins = freeMargins([{ left: 40, top: 520, right: 1560, bottom: 880 }], W, H, 0);
    expect(margins.bottom).toBe(380);
    expect(margins.left).toBe(0);
  });

  it("always keeps a third of the screen for the brain", () => {
    const margins = freeMargins(
      [
        { left: 0, top: 0, right: 700, bottom: 900 },
        { left: 800, top: 0, right: 1600, bottom: 900 },
      ],
      W,
      H,
    );
    expect(W - margins.left - margins.right).toBeGreaterThanOrEqual(W / 3 - 0.001);
  });

  it("ignores panels that are collapsed to nothing", () => {
    expect(freeMargins([{ left: 10, top: 10, right: 10, bottom: 500 }], W, H)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe("calloutPlacement", () => {
  it("goes right when the label fits before the reader", () => {
    expect(calloutPlacement(600, 300, 0, 1400)).toEqual({ side: "right", maxWidth: 744 });
  });

  it("turns left when the reader is in the way and there is more room there", () => {
    const placed = calloutPlacement(1200, 420, 400, 1440);
    expect(placed.side).toBe("left");
    expect(placed.maxWidth).toBe(1200 - 44 - 412);
  });

  it("stays right when it is short enough to fit, even with more room on the left", () => {
    expect(calloutPlacement(1200, 150, 0, 1440).side).toBe("right");
  });

  it("is cut to the room it has, never less than nothing", () => {
    expect(calloutPlacement(20, 500, 0, 60).maxWidth).toBe(0);
  });
});
