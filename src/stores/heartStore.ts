import { create } from "zustand";

import { readLocal, writeLocal } from "@/lib/localStore";
import type { RhythmId } from "@/features/viewer/rhythms";

/**
 * The heartbeat, as the reader controls it.
 *
 * `enabled` is not remembered: like the scanner, a mode that moves the picture
 * starts off at every launch, so nobody opens the atlas to a body already in
 * motion they did not ask for.
 *
 * `sound` is remembered, and off until it is asked for. Sound is the one thing
 * here that can embarrass somebody — a lecture theatre, a library, a consulting
 * room — and a tool that makes a noise nobody chose is a tool people close.
 *
 * `rhythm` is not remembered either. Whoever opens the atlas next — a student,
 * or somebody being shown how a heart works — should meet a normal heart, not
 * the ventricular fibrillation the last person was looking at.
 */

const SOUND_KEY = "anatria3d.heart.sound.v1";

function storedSound(): boolean {
  return readLocal(SOUND_KEY) === "on";
}

interface HeartStore {
  /** The heart is beating. Off at every launch. */
  enabled: boolean;
  /** The heart sounds play with each beat. */
  sound: boolean;
  /** Which textbook rhythm the heart is showing. See `rhythms.ts`. */
  rhythm: RhythmId;
  toggle: () => void;
  setSound: (on: boolean) => void;
  setRhythm: (rhythm: RhythmId) => void;
}

export const useHeartStore = create<HeartStore>()((set, get) => ({
  enabled: false,
  sound: storedSound(),
  rhythm: "normal",
  toggle: () => set((state) => ({ enabled: !state.enabled })),
  setSound: (on) => {
    if (on === get().sound) return;
    writeLocal(SOUND_KEY, on ? "on" : "off");
    set({ sound: on });
  },
  setRhythm: (rhythm) => set({ rhythm }),
}));
