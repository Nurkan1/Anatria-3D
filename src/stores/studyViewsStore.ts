import { create } from "zustand";

/**
 * Whether the viewport is split into four anatomical panels.
 *
 * # Why this is its own store and not part of `sceneStore`
 *
 * `sceneStore` is the assistant's surface: every field in it is something a
 * scene command can set, and everything the assistant does to the model lands
 * there. How many panels the reader is looking through is not anatomy and not
 * something an agent should be able to change — it is the shape of the window,
 * decided by the person in front of it.
 *
 * Keeping it out also keeps it out of the control bridge, which forwards scene
 * commands and nothing else. A program driving the atlas from outside can
 * isolate, light and section; it cannot rearrange the reader's screen.
 *
 * # Why it is not persisted
 *
 * Unlike the panel widths and the reader's provider, this is a mode rather than
 * a preference — entered for one structure and left again. It also depends on
 * something being isolated, which is never true at launch, so a remembered
 * "on" would come back as a switch that does nothing.
 */

interface StudyViewsStore {
  /** What the reader asked for. Not the same as what is on screen. */
  wanted: boolean;
  setWanted: (wanted: boolean) => void;
}

export const useStudyViewsStore = create<StudyViewsStore>()((set) => ({
  wanted: false,
  setWanted: (wanted) => set({ wanted }),
}));
