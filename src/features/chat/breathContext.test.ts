import { describe, expect, it } from "vitest";

import { BREATH_PATTERNS, type BreathPatternId } from "@/features/viewer/breathing";
import { RHYTHMS } from "@/features/viewer/rhythms";
import { BreathContextSchema } from "@/lib/schemas";

import { breathAim, type BreathAimInput } from "./breathContext";

function breathing(overrides: Partial<BreathAimInput> = {}): BreathAimInput {
  return { enabled: true, mode: "tutor", pattern: "deep", heartEnabled: false, rhythm: "normal", ...overrides };
}

describe("breathAim", () => {
  it("tells the assistant the breathing as the panel shows it", () => {
    expect(breathAim(breathing())).toMatchObject({ pattern: "Deep breathing", rate: "6 / min", heart: null });
  });

  it("says what the breath does to a beating heart", () => {
    expect(breathAim(breathing({ heartEnabled: true }))?.heart).toMatch(/rises as the breath comes in/);
    expect(breathAim(breathing({ heartEnabled: true, rhythm: "atrial_fibrillation" }))?.heart).toMatch(
      /does not follow/,
    );
  });

  it("says nothing with breathing off", () => {
    expect(breathAim(breathing({ enabled: false }))).toBeNull();
  });

  it("says nothing in a drill or a review", () => {
    expect(breathAim(breathing({ mode: "case" }))).toBeNull();
    expect(breathAim(breathing({ mode: "review" }))).toBeNull();
  });

  it("fits the protocol for every pattern and every rhythm", () => {
    // The captions live in the app; a long one must fail here, not drop a turn.
    for (const pattern of Object.keys(BREATH_PATTERNS) as BreathPatternId[]) {
      for (const definition of RHYTHMS) {
        const context = breathAim(breathing({ pattern, heartEnabled: true, rhythm: definition.id }));
        expect(BreathContextSchema.safeParse(context).success).toBe(true);
      }
    }
  });
});
