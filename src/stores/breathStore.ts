import { create } from "zustand";

import type { BreathPatternId } from "@/features/viewer/breathing";

/**
 * Breathing, as the reader controls it. See `breathing.ts`.
 *
 * Neither the switch nor the pattern is remembered, for the heartbeat's
 * reason: a mode that moves the picture starts off at every launch, and the
 * next person to open the atlas meets a body at rest, not the deep breathing
 * somebody left it in.
 */
interface BreathStore {
  enabled: boolean;
  pattern: BreathPatternId;
  toggle: () => void;
  setPattern: (pattern: BreathPatternId) => void;
}

export const useBreathStore = create<BreathStore>()((set) => ({
  enabled: false,
  pattern: "quiet",
  toggle: () => set((state) => ({ enabled: !state.enabled })),
  setPattern: (pattern) => set({ pattern }),
}));
