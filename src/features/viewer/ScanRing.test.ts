import { expect, it } from "vitest";

import { nameplateText } from "./ScanRing";

it("names the instrument, whose hand is on it, and which way it reads", () => {
  expect(nameplateText(false)).toBe("ANATRIA 3D");
  expect(nameplateText(true)).toBe("ANATRIA 3D AI");
  expect(nameplateText(false, "front")).toBe("ANATRIA 3D FRONT");
  expect(nameplateText(true, "front")).toBe("ANATRIA 3D AI FRONT");
});
