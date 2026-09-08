import { create } from "zustand";

/**
 * The scanner, as the reader controls it.
 *
 * # Why this is a store and not a prop
 *
 * Three things drive the same sweep and none of them can see each other: a
 * switch in the corner of the viewport, a slider under it, and — later — the
 * ring itself under the pointer. Threading that through the scene would mean
 * lifting state out of `AnatomyScene` and back down through a WebGL canvas for
 * the sake of a boolean and a number.
 *
 * # What is deliberately *not* here
 *
 * Where the sweep currently is. That changes sixty times a second and belongs
 * in `SWEEP_PROGRESS`, which the slider reads in its own frame loop. Putting it
 * in the store would re-render a tree with 3,478 meshes in it to move a
 * slider's thumb — the same mistake the readout was built to avoid.
 *
 * `held` and `at` are here because they change when a person moves, which is
 * rarely and never per frame.
 */
interface ScanStore {
  /** The reader asked for the scanner. Off at every launch, like the bridge. */
  enabled: boolean;
  /**
   * The reader is holding the sweep at `at` rather than letting it travel.
   *
   * Set while a slider or the ring is being dragged, cleared on release. The
   * sweep resumes from the height it was left at, not from where the clock had
   * got to — see `holdScanBand`.
   */
  held: boolean;
  /** Where it is being held, 0 at the feet and 1 at the head. */
  at: number;

  toggle: () => void;
  /** Take hold of the sweep and put it at `at`. */
  hold: (at: number) => void;
  /** Let go, and let it travel again from where it was left. */
  release: () => void;
}

export const useScanStore = create<ScanStore>()((set) => ({
  enabled: false,
  held: false,
  at: 0.5,

  // Letting go on the way out, so switching the scanner off never leaves the
  // next session holding an invisible sweep at somebody's ankle.
  toggle: () => set((state) => ({ enabled: !state.enabled, held: false })),
  hold: (at) => set({ held: true, at: Math.max(0, Math.min(1, at)) }),
  release: () => set({ held: false }),
}));
