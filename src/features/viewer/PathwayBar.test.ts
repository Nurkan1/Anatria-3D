import { describe, expect, it } from "vitest";

import type { AnatomicalSystem } from "@/lib/schemas";

import { unloadedSystems } from "./PathwayBar";

const stop = (system: AnatomicalSystem) => ({ system });

describe("unloadedSystems", () => {
  it("says nothing when the whole route is on screen", () => {
    expect(unloadedSystems([stop("digestive"), stop("muscular")], [])).toEqual([]);
  });

  it("names the system a missing stop belongs to", () => {
    // The viewer skips stops it cannot measure, so without this the badge lists
    // three stops while the curve joins two — a wrong picture with nothing to
    // explain it.
    expect(unloadedSystems([stop("digestive")], ["digestive"])).toEqual(["digestive"]);
  });

  it("asks for each switch once, however many stops need it", () => {
    const route = [stop("digestive"), stop("digestive"), stop("digestive")];
    expect(unloadedSystems(route, ["digestive"])).toEqual(["digestive"]);
  });

  it("keeps the systems that are loaded out of the warning", () => {
    const route = [stop("nervous"), stop("digestive"), stop("muscular")];
    expect(unloadedSystems(route, ["digestive", "renal"])).toEqual(["digestive"]);
  });
});
