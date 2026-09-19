import { describe, expect, it } from "vitest";

import { acquireDraco, releaseDraco } from "./brainLoader";

describe("the shared Draco decoder", () => {
  it("is one decoder for every overlapping load, freed by the last to let go", () => {
    const brain = acquireDraco("/draco/");
    const figure = acquireDraco("/draco/");
    expect(figure).toBe(brain);
    releaseDraco("/draco/");
    // Still held by the figure: the same one comes back.
    expect(acquireDraco("/draco/")).toBe(brain);
    releaseDraco("/draco/");
    releaseDraco("/draco/");
    // Everyone let go, so a new session gets a fresh one.
    const next = acquireDraco("/draco/");
    expect(next).not.toBe(brain);
    releaseDraco("/draco/");
  });

  it("ignores a release with nothing held", () => {
    expect(() => releaseDraco("/nowhere/")).not.toThrow();
  });
});
