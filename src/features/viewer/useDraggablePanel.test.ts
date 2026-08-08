import { describe, expect, it } from "vitest";

import { clampToBounds } from "./useDraggablePanel";

const PANEL = { width: 600, height: 300 };
const VIEWPORT = { width: 1200, height: 800 };

describe("clampToBounds", () => {
  it("leaves a position that is already inside alone", () => {
    expect(clampToBounds({ x: 100, y: 50 }, PANEL, VIEWPORT)).toEqual({ x: 100, y: 50 });
  });

  it("keeps the panel fully inside rather than merely overlapping", () => {
    // A panel dragged half off the edge can be dropped somewhere its own drag
    // handle is unreachable, and then there is no way back.
    expect(clampToBounds({ x: 5000, y: 5000 }, PANEL, VIEWPORT)).toEqual({
      x: 600,
      y: 500,
    });
  });

  it("stops it going off the top or the left", () => {
    expect(clampToBounds({ x: -400, y: -90 }, PANEL, VIEWPORT)).toEqual({ x: 0, y: 0 });
  });

  it("pins a panel larger than its container to the origin", () => {
    // A narrow window, or a panel opened before the layout settles. Without the
    // floor at zero the clamp would produce a negative bound and push the panel
    // off the screen it is trying to keep it on.
    expect(clampToBounds({ x: 40, y: 40 }, PANEL, { width: 300, height: 100 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
