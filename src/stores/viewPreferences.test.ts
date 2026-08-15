import { describe, expect, it } from "vitest";

import type { AnatomicalSystem } from "@/lib/schemas";

import { sanitiseViewPreferences } from "./viewPreferences";

const KNOWN: AnatomicalSystem[] = ["skeletal", "muscular", "nervous", "cardiovascular"];

describe("sanitiseViewPreferences", () => {
  it("carries a whole saved view through", () => {
    const clean = sanitiseViewPreferences(
      {
        hiddenSystems: ["muscular"],
        systemOpacity: { skeletal: 0.3 },
        eyeTracking: false,
        labelsVisible: true,
        background: "light",
      },
      KNOWN,
    );
    expect(clean).toEqual({
      hiddenSystems: ["muscular"],
      systemOpacity: { skeletal: 0.3 },
      eyeTracking: false,
      labelsVisible: true,
      background: "light",
    });
  });

  it("never restores a cross section", () => {
    // It was stored once, and a body that opens already sliced through the neck
    // reads as a broken render rather than a setting being honoured. A file
    // written by that build has to be ignored on the way in, not obeyed.
    const clean = sanitiseViewPreferences(
      { crossSection: { plane: "axial", position: 0.4 }, eyeTracking: true },
      KNOWN,
    );
    expect(clean).toEqual({ eyeTracking: true });
    expect("crossSection" in clean).toBe(false);
  });

  it("drops a system this build no longer ships", () => {
    // The one that would be unrecoverable: a system hidden by a preference,
    // with no row in the tree to switch it back on.
    const clean = sanitiseViewPreferences(
      { hiddenSystems: ["muscular", "gills"], systemOpacity: { gills: 0.2 } },
      KNOWN,
    );
    expect(clean.hiddenSystems).toEqual(["muscular"]);
    expect(clean.systemOpacity).toEqual({});
  });

  it("treats a stored opacity of 1 as no ghosting at all", () => {
    // Solid is the absence of an entry. A stored 1 would answer "yes" to "is
    // anything ghosted?", which is what the reset button reads.
    const clean = sanitiseViewPreferences({ systemOpacity: { skeletal: 1 } }, KNOWN);
    expect(clean.systemOpacity).toEqual({});
  });

  it("clamps an opacity that would make a layer invisible or solid", () => {
    const clean = sanitiseViewPreferences(
      { systemOpacity: { skeletal: -4, muscular: 0.5 } },
      KNOWN,
    );
    expect(clean.systemOpacity!.skeletal).toBeGreaterThan(0);
    expect(clean.systemOpacity!.muscular).toBe(0.5);
  });

  it("leaves out anything that was not stored, rather than blanking it", () => {
    // A file written by an older build must not wipe this build's defaults for
    // settings it never knew about.
    expect(sanitiseViewPreferences({ eyeTracking: true }, KNOWN)).toEqual({
      eyeTracking: true,
    });
  });

  it.each([null, undefined, 42, "corrupt", [], { hiddenSystems: "muscular" }])(
    "survives %p in storage",
    (raw) => {
      expect(() => sanitiseViewPreferences(raw, KNOWN)).not.toThrow();
      expect(sanitiseViewPreferences(raw, KNOWN).hiddenSystems).toBeUndefined();
    },
  );

  it("carries the background choice across sessions", () => {
    expect(sanitiseViewPreferences({ background: "light" }, KNOWN).background).toBe(
      "light",
    );
    expect(sanitiseViewPreferences({ background: "dark" }, KNOWN).background).toBe("dark");
  });

  it("refuses a background it does not have", () => {
    // Anything else would reach `backgroundTheme` and fall through to a
    // default, which is a silent wrong answer rather than a rejected one.
    expect(sanitiseViewPreferences({ background: "sepia" }, KNOWN).background)
      .toBeUndefined();
    expect(sanitiseViewPreferences({ background: 3 }, KNOWN).background).toBeUndefined();
  });

  it("carries whether the cursor list is switched off", () => {
    // The one preference whose *false* is the interesting value: someone on a
    // small screen turned it off because it covered the chest, and a reader
    // who has to turn it off again on every launch will conclude it does not
    // stay off rather than that it was never saved.
    expect(sanitiseViewPreferences({ depthProbeVisible: false }, KNOWN).depthProbeVisible)
      .toBe(false);
    expect(sanitiseViewPreferences({ depthProbeVisible: true }, KNOWN).depthProbeVisible)
      .toBe(true);
  });

  it("leaves the cursor list alone when nothing was stored", () => {
    // Absent must not read as off. It is on by default, and a journal written
    // by a build that predates the setting has no opinion about it.
    expect(sanitiseViewPreferences({}, KNOWN).depthProbeVisible).toBeUndefined();
    expect(sanitiseViewPreferences({ depthProbeVisible: "no" }, KNOWN).depthProbeVisible)
      .toBeUndefined();
  });

  it("ignores a value of the wrong type rather than storing it", () => {
    const clean = sanitiseViewPreferences(
      { eyeTracking: "yes", systemOpacity: { skeletal: "half" } },
      KNOWN,
    );
    expect(clean.eyeTracking).toBeUndefined();
    expect(clean.systemOpacity).toEqual({});
  });
});
