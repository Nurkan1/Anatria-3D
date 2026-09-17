import { describe, expect, it } from "vitest";

import { HeartContextSchema } from "@/lib/schemas";
import { RHYTHMS } from "@/features/viewer/rhythms";

import { heartAim, type HeartAimInput } from "./heartContext";

function beating(overrides: Partial<HeartAimInput> = {}): HeartAimInput {
  return { enabled: true, mode: "tutor", rhythm: "atrial_fibrillation", sound: true, ...overrides };
}

describe("heartAim", () => {
  it("tells the assistant the rhythm as the panel shows it", () => {
    expect(heartAim(beating())).toMatchObject({ rhythm: "Atrial fibrillation", sound: true });
  });

  it("says nothing with the heartbeat off", () => {
    expect(heartAim(beating({ enabled: false }))).toBeNull();
  });

  it("says nothing in a drill or a review", () => {
    // Their subject is the patient, not the rhythm left playing in the viewport.
    expect(heartAim(beating({ mode: "case" }))).toBeNull();
    expect(heartAim(beating({ mode: "review" }))).toBeNull();
  });

  it("fits the protocol for every rhythm in the catalogue", () => {
    // The captions live in the app; a long one must fail here, not drop a turn.
    for (const definition of RHYTHMS) {
      const context = heartAim(beating({ rhythm: definition.id }));
      expect(HeartContextSchema.safeParse(context).success).toBe(true);
    }
  });
});
