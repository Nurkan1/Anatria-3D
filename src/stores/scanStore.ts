import { create } from "zustand";

import { readLocal, writeLocal } from "@/lib/localStore";

/**
 * The scanner, as the reader controls it.
 *
 * # Why this is a store and not a prop
 *
 * Several things drive the same sweep and none of them can see each other: a
 * switch in the corner of the viewport, a slider under it, a pin beside that,
 * and the ring itself under the pointer. Threading that through the scene would
 * mean lifting state out of `AnatomyScene` and back down through a WebGL canvas
 * for the sake of a boolean and a number.
 *
 * # What is deliberately *not* here
 *
 * Where the sweep currently is. That changes sixty times a second and belongs
 * in `SWEEP_PROGRESS`, which the slider reads in its own frame loop. Putting it
 * in the store would re-render a tree with 3,478 meshes in it to move a
 * slider's thumb — the same mistake the crossing readout was built to avoid.
 *
 * Everything here changes when a person moves, which is rarely and never per
 * frame.
 */

const SWEEP_ON_ANSWER_KEY = "anatria3d.scan.sweepOnAnswer.v1";

/**
 * Whether the sweep runs by itself while an answer is written.
 *
 * Remembered across launches, and that is the point of it rather than a
 * convenience: somebody who turned it off did so because their machine
 * struggles with it, and asking them to turn it off again every morning would
 * be the application forgetting the one thing it was told.
 */
function storedSweepOnAnswer(): boolean {
  return readLocal(SWEEP_ON_ANSWER_KEY) !== "off";
}

interface ScanStore {
  /** The reader asked for the scanner. Off at every launch, like the bridge. */
  enabled: boolean;
  /**
   * The reader has the sweep under a finger right now.
   *
   * Transient: set while a slider or the ring is being dragged, cleared on
   * release. For a light that should stay put after the hand leaves, see
   * `pinned`.
   */
  held: boolean;
  /**
   * The sweep stays where it was put until this is switched off.
   *
   * A control of its own rather than a modifier held down while dragging.
   * Ctrl-drag was the obvious shape and it is the wrong one: it binds a feature
   * to a keyboard layout, it cannot be discovered by looking, and it is
   * unreachable on a machine driven by touch or one hand.
   */
  pinned: boolean;
  /** Where it is held or pinned, 0 at the feet and 1 at the head. */
  at: number;
  /** Sweep by itself while the assistant is composing an answer. */
  sweepOnAnswer: boolean;

  toggle: () => void;
  /** Take hold of the sweep and put it at `at`. */
  hold: (at: number) => void;
  /** Let the finger go. The light stays only if it is pinned. */
  release: () => void;
  togglePin: () => void;
  setSweepOnAnswer: (on: boolean) => void;
}

export const useScanStore = create<ScanStore>()((set, get) => ({
  enabled: false,
  held: false,
  pinned: false,
  at: 0.5,
  sweepOnAnswer: storedSweepOnAnswer(),

  // Letting go and unpinning on the way out, so switching the scanner off never
  // leaves the next session holding an invisible sweep at somebody's ankle.
  toggle: () =>
    set((state) => ({ enabled: !state.enabled, held: false, pinned: false })),
  hold: (at) => set({ held: true, at: Math.max(0, Math.min(1, at)) }),
  release: () => set({ held: false }),
  togglePin: () => set((state) => ({ pinned: !state.pinned })),
  setSweepOnAnswer: (on) => {
    if (on === get().sweepOnAnswer) return;
    writeLocal(SWEEP_ON_ANSWER_KEY, on ? "on" : "off");
    set({ sweepOnAnswer: on });
  },
}));

/** True while the sweep should stay where it was put rather than travel. */
export function scanIsStill(state: Pick<ScanStore, "held" | "pinned">): boolean {
  return state.held || state.pinned;
}
