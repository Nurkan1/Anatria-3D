import { create } from "zustand";

import type { AuxiliaryView } from "@/features/viewer/studyLayout";

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

/** Every auxiliary view, in the order they are laid out when all are on. */
export const AUXILIARY_VIEWS: AuxiliaryView[] = ["anterior", "left", "superior"];

interface StudyViewsStore {
  /** What the reader asked for. Not the same as what is on screen. */
  wanted: boolean;
  setWanted: (wanted: boolean) => void;
  /**
   * Which auxiliary views are switched on, in layout order.
   *
   * A list rather than a set of flags, because the order is part of the answer:
   * the panels are laid out in it, and switching one off and on again must not
   * shuffle the two that never moved.
   */
  active: AuxiliaryView[];
  toggleView: (view: AuxiliaryView) => void;
}

export const useStudyViewsStore = create<StudyViewsStore>()((set) => ({
  wanted: false,
  setWanted: (wanted) => set({ wanted }),
  active: [...AUXILIARY_VIEWS],
  toggleView: (view) =>
    set((state) => ({
      active: state.active.includes(view)
        ? state.active.filter((each) => each !== view)
        : // Reinserted where it belongs rather than appended, so a view that
          // comes back lands in the panel it left rather than at the end.
          AUXILIARY_VIEWS.filter(
            (each) => each === view || state.active.includes(each),
          ),
    })),
}));
