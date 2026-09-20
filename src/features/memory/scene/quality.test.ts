import { describe, expect, it } from "vitest";

import { classifyAdapter, FrameGovernor, FULL, LEVELS, pixelRatioFor, startingLevel } from "./quality";

describe("classifyAdapter", () => {
  it.each([
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", "dedicated"],
    ["ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)", "dedicated"],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)", "integrated"],
    ["ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)", "integrated"],
    ["ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)", "software"],
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))", "software"],
  ])("reads %s as %s", (renderer, kind) => {
    expect(classifyAdapter(renderer)).toBe(kind);
  });

  it("says unknown when the adapter will not say", () => {
    expect(classifyAdapter(null)).toBe("unknown");
  });

  it("starts software lightest, integrated one step down, the rest full", () => {
    expect(startingLevel("software")).toBe(0);
    expect(startingLevel("integrated")).toBe(FULL - 1);
    expect(startingLevel("dedicated")).toBe(FULL);
    expect(startingLevel("unknown")).toBe(FULL);
  });
});

describe("pixelRatioFor", () => {
  it("draws at the screen's own density at the full level", () => {
    expect(pixelRatioFor(LEVELS[FULL]!, 1)).toBe(1);
    expect(pixelRatioFor(LEVELS[FULL]!, 1.25)).toBe(1.25);
  });

  it("eases by the same share whatever the screen's density", () => {
    const share = (dpr: number) => pixelRatioFor(LEVELS[0]!, dpr) / dpr;
    expect(share(1)).toBeCloseTo(share(1.25));
    expect(share(1)).toBeCloseTo(share(2));
  });

  it("never draws below half a pixel, nor beyond what is worth drawing", () => {
    expect(pixelRatioFor(LEVELS[0]!, 0.5)).toBe(0.5);
    expect(pixelRatioFor(LEVELS[FULL]!, 4)).toBe(1.75);
    expect(pixelRatioFor(LEVELS[FULL]!, Number.NaN || 0)).toBe(1);
  });
});

describe("FrameGovernor", () => {
  const feed = (governor: FrameGovernor, ms: number, frames: number) => {
    const changes: number[] = [];
    for (let i = 0; i < frames; i++) {
      const next = governor.sample(ms);
      if (next !== null) changes.push(next);
    }
    return changes;
  };

  it("leaves a smooth machine alone", () => {
    expect(feed(new FrameGovernor(FULL), 16.7, 1200)).toEqual([]);
  });

  it("steps down one level for each slow two seconds", () => {
    expect(feed(new FrameGovernor(FULL), 33, 240)).toEqual([FULL - 1, FULL - 2]);
  });

  it("never goes below the lightest level", () => {
    const governor = new FrameGovernor(FULL);
    feed(governor, 60, 2000);
    expect(governor.level).toBe(0);
    expect(LEVELS[governor.level]).toBeDefined();
  });

  it("ignores long gaps, which are loads and hidden windows", () => {
    expect(feed(new FrameGovernor(FULL), 400, 500)).toEqual([]);
  });

  it("climbs back after a steady stretch, but never past where it may go", () => {
    const governor = new FrameGovernor(FULL);
    feed(governor, 33, 120);
    expect(governor.level).toBe(FULL - 1);
    expect(feed(governor, 16.7, 120 * 10)).toEqual([FULL]);
    expect(feed(governor, 16.7, 120 * 30)).toEqual([]);
  });

  it("starts at the ceiling it is given", () => {
    expect(new FrameGovernor(1).level).toBe(1);
    expect(new FrameGovernor(FULL, 1).level).toBe(1);
  });
});
