import { create } from "zustand";

import { readLocal, writeLocal } from "@/lib/localStore";

import { scanTint, type ScanTintId } from "@/features/viewer/scanTints";
import type { SectionPlaneName } from "@/features/viewer/axialSlice";

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
const TINT_KEY = "anatria3d.scan.tint.v1";
const REVEAL_KEY = "anatria3d.scan.reveal.v1";
const READOUT_KEY = "anatria3d.scan.readout.v1";
const PANEL_KEY = "anatria3d.scan.panel.v1";
const GHOST_KEY = "anatria3d.scan.ghost.v1";
const SOUND_KEY = "anatria3d.scan.sound.v1";
const AXIAL_KEY = "anatria3d.scan.axial.v1";
const CUT_KEY = "anatria3d.scan.cut.v1";
const TORCH_KEY = "anatria3d.scan.torch.v1";
const DETAIL_KEY = "anatria3d.scan.detail.v1";
const PLANE_KEY = "anatria3d.scan.plane.v1";

/**
 * Which way the scanner reads the body: across it at a height, or through it
 * at a depth.
 *
 * Axial unless frontal was chosen, and validated on the way in like the tint:
 * an unknown word in a file a person can edit must give the scanner everybody
 * already knows, not one that sweeps along no axis at all.
 */
function storedPlane(): SectionPlaneName {
  return readLocal(PLANE_KEY) === "front" ? "front" : "axial";
}

/**
 * Whether sections are read at the larger size.
 *
 * Off by default, and this is the one setting here aimed squarely at a machine
 * rather than at a preference: it quadruples the readback and holds about a
 * quarter of a gigabyte while it is on. What it buys is how far the enlarged
 * view can be magnified before it runs out of picture, which is the only place
 * a reader ever notices resolution.
 */
function storedDetail(): boolean {
  return readLocal(DETAIL_KEY) === "on";
}

/**
 * Whether the pointer aims the light on the section.
 *
 * Off by default, and this one has a running cost rather than a one-off: the
 * section is retaken while the pointer moves over it, several times a second.
 * It is worth having because raking a light across a surface is how anybody
 * examines a specimen, and it is a switch because nobody should pay for it
 * without having asked.
 */
function storedTorch(): boolean {
  return readLocal(TORCH_KEY) === "on";
}

/**
 * Whether the section is a dissection cut rather than a thin slab.
 *
 * On by default, because it is the more legible of the two and legibility is
 * what the panel is for. The slab is the truthful section — only what lies at
 * that exact level — and it is one press away for anyone who wants it.
 */
function storedCut(): boolean {
  return readLocal(CUT_KEY) !== "off";
}

/**
 * Whether an axial slice is drawn each time the light is let go.
 *
 * Off by default, and this one is not politeness — it is the only setting here
 * that costs real time when it is on. Measured on this atlas: about ten
 * milliseconds at the chest, once, at the moment of release. That is a frame,
 * which is why it is offered at all; it is also not nothing, which is why
 * nobody pays it without asking.
 */
function storedAxial(): boolean {
  return readLocal(AXIAL_KEY) === "on";
}

/**
 * Whether letting the light go makes a sound.
 *
 * Off by default, and not out of caution about performance. Sound is the one
 * thing here that can embarrass somebody — a lecture theatre, a consulting
 * room, a shared office — and a tool that makes a noise nobody chose is a tool
 * they close rather than configure.
 */
function storedSound(): boolean {
  return readLocal(SOUND_KEY) === "on";
}

/**
 * Whether what the plane has already crossed is played down.
 *
 * Off by default. It changes how the whole body looks, and a mode that
 * rearranges the picture the first time somebody presses the switch is a mode
 * they turn off before they understand it.
 */
function storedGhost(): boolean {
  return readLocal(GHOST_KEY) === "on";
}

/**
 * Whether the scanner's own controls are unfolded.
 *
 * Open unless it was folded away: somebody who has just switched the scanner on
 * needs to see that there is a handle and a palette at all. But the panel sits
 * over the viewport, and getting it out of the way must not mean switching the
 * instrument off — stopping the sweep to see the body is the thing this exists
 * to prevent.
 */
function storedPanel(): boolean {
  return readLocal(PANEL_KEY) !== "off";
}

/**
 * Whether the panel naming what is being crossed is shown.
 *
 * On unless it was turned off, because it is the half of the mode that teaches
 * anything — a glowing line that never says *lung* is a screensaver. But it
 * sits over the viewport, and a reader looking closely at what the plane just
 * lit is entitled to move it out of the way.
 */
function storedReadout(): boolean {
  return readLocal(READOUT_KEY) !== "off";
}

/**
 * Whether the sweep gives structures their colour back instead of lighting them.
 *
 * Off by default: the glow is what the mode is recognised by, and a reader who
 * has never seen either should meet the one that explains itself.
 */
function storedReveal(): boolean {
  return readLocal(REVEAL_KEY) === "on";
}

/**
 * The colour of the light, remembered.
 *
 * Validated through `scanTint` on the way in rather than trusted: this is a
 * string a previous version wrote into a file a person can edit, and an
 * unknown one must give the default rather than a scanner that lights nothing.
 */
function storedTint(): ScanTintId {
  return scanTint(readLocal(TINT_KEY)).id;
}

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
  /**
   * The assistant put the light where it is, and the reader has not moved it.
   *
   * Not a mode and not a preference: it is a fact about who last touched the
   * instrument, and it is what the ring's nameplate reads. Any deliberate act
   * on the scanner by the reader takes it back -- dragging, stepping, pinning,
   * switching it off -- because from that moment the light is theirs again and
   * a plate still claiming otherwise would be a small lie on screen.
   */
  byAssistant: boolean;
  /**
   * How many cross-sections have been taken this session.
   *
   * Transient, never written to disk, and bumped by the probe once the picture
   * has been painted. It is the only honest moment to tell the panel to look
   * again: the table beside the section and the picture itself come from two
   * different places, and refreshing on anything earlier shows one of them
   * describing a level the other has already left.
   */
  sections: number;
  /** Sweep by itself while the assistant is composing an answer. */
  sweepOnAnswer: boolean;
  /**
   * The colour of the light.
   *
   * It is not decoration: the light is added to the tissue's own colour, so the
   * hue decides which structures separate from their neighbours and which sink
   * into them. Green over muscle and amber over bone select different halves of
   * the same body.
   */
  tint: ScanTintId;
  /**
   * Reveal the tissue's own colour rather than throwing light at it.
   *
   * It has nothing to reveal on a body that is already at full colour — the
   * colour it would restore is the colour already there — so the control that
   * sets it says as much rather than sitting there doing nothing.
   */
  reveal: boolean;
  /** Show the panel that names what the plane is crossing. */
  readout: boolean;
  /** Show the scanner's own controls, rather than the pill they fold into. */
  panel: boolean;
  /**
   * Play down what the plane has already gone past.
   *
   * The direction is read from the light's own movement, so this follows a
   * drag as readily as it follows the sweep.
   */
  ghost: boolean;
  /** Play a short tone at the moment the light is let go. */
  sound: boolean;
  /** Draw a cross-section at the height the light was left at. */
  axial: boolean;
  /** Cut the body open at the plane, rather than showing only that level. */
  cut: boolean;
  /** Let the pointer aim the light while it is over the section. */
  torch: boolean;
  /** Read sections at the larger size. Costs memory and readback time. */
  detail: boolean;
  /**
   * Which plane the scanner sweeps and sections: axial, head to feet, or
   * frontal, front to back. The same ring and the same light either way.
   */
  plane: SectionPlaneName;
  /**
   * Where the light was left on the other plane.
   *
   * A height and a depth are both a fraction of their travel, and the same
   * number means nothing alike on the two: 0.72 is the chest going down and a
   * plane just behind the sternum going in. So switching plane swaps the two
   * rather than carrying one across, and a reader who compares a level with a
   * depth and comes back finds both where they left them.
   */
  elsewhere: number;

  toggle: () => void;
  /** Take hold of the sweep and put it at `at`. */
  hold: (at: number) => void;
  /**
   * Put the light at a height and leave it there, switching on if need be.
   *
   * What the assistant does when it is asked to take somebody to a level. It
   * switches the scanner on rather than quietly doing nothing, because a plane
   * nobody can see is not an answer to "show me T8" -- and it pins, because the
   * reader was taken somewhere and a sweep that immediately carried on would
   * take it away again before they had looked.
   */
  putAt: (at: number) => void;
  /**
   * Move the light by a fraction of its travel, and leave it there.
   *
   * The reading gesture, as opposed to the dragging one. See `stepFraction`
   * for why the caller passes a fraction of the body rather than a distance.
   */
  step: (by: number) => void;
  /** The probe has finished a section. Nothing else may call this. */
  sectionTaken: () => void;
  /** Let the finger go. The light stays only if it is pinned. */
  release: () => void;
  togglePin: () => void;
  setSweepOnAnswer: (on: boolean) => void;
  setTint: (tint: ScanTintId) => void;
  setReveal: (on: boolean) => void;
  toggleReadout: () => void;
  togglePanel: () => void;
  setGhost: (on: boolean) => void;
  setSound: (on: boolean) => void;
  setAxial: (on: boolean) => void;
  setCut: (on: boolean) => void;
  setTorch: (on: boolean) => void;
  setDetail: (on: boolean) => void;
  setPlane: (plane: SectionPlaneName) => void;
}

export const useScanStore = create<ScanStore>()((set, get) => ({
  enabled: false,
  held: false,
  pinned: false,
  at: 0.5,
  byAssistant: false,
  sections: 0,
  sweepOnAnswer: storedSweepOnAnswer(),
  tint: storedTint(),
  reveal: storedReveal(),
  readout: storedReadout(),
  panel: storedPanel(),
  ghost: storedGhost(),
  sound: storedSound(),
  axial: storedAxial(),
  cut: storedCut(),
  torch: storedTorch(),
  detail: storedDetail(),
  plane: storedPlane(),
  elsewhere: 0.5,

  // Letting go and unpinning on the way out, so switching the scanner off never
  // leaves the next session holding an invisible sweep at somebody's ankle.
  toggle: () =>
    set((state) => ({
      enabled: !state.enabled,
      held: false,
      pinned: false,
      byAssistant: false,
    })),
  hold: (at) =>
    set({ held: true, at: Math.max(0, Math.min(1, at)), byAssistant: false }),
  putAt: (at) =>
    set({
      enabled: true,
      pinned: true,
      // Not held: no finger is down, and leaving it set would keep the slider
      // believing it was being dragged for the rest of the session.
      held: false,
      at: Math.max(0, Math.min(1, at)),
      byAssistant: true,
    }),
  step: (by) => {
    if (by === 0) return;
    set((state) => ({
      at: Math.max(0, Math.min(1, state.at + by)),
      /**
       * Stepping means "stay here and let me look at it".
       *
       * Without this the sweep resumes travelling on the next frame and takes
       * the level away from the reader who just chose it — and the section
       * they asked for would be of a height the plane had already left. The
       * pin is a visible control, so the reader also sees what happened.
       */
      pinned: true,
      byAssistant: false,
    }));
  },
  sectionTaken: () => set((state) => ({ sections: state.sections + 1 })),
  release: () => set({ held: false }),
  togglePin: () => set((state) => ({ pinned: !state.pinned, byAssistant: false })),
  setSweepOnAnswer: (on) => {
    if (on === get().sweepOnAnswer) return;
    writeLocal(SWEEP_ON_ANSWER_KEY, on ? "on" : "off");
    set({ sweepOnAnswer: on });
  },
  setTint: (tint) => {
    if (tint === get().tint) return;
    writeLocal(TINT_KEY, tint);
    set({ tint });
  },
  setReveal: (on) => {
    if (on === get().reveal) return;
    writeLocal(REVEAL_KEY, on ? "on" : "off");
    set({ reveal: on });
  },
  toggleReadout: () => {
    const readout = !get().readout;
    writeLocal(READOUT_KEY, readout ? "on" : "off");
    set({ readout });
  },
  togglePanel: () => {
    const panel = !get().panel;
    writeLocal(PANEL_KEY, panel ? "on" : "off");
    set({ panel });
  },
  setGhost: (on) => {
    if (on === get().ghost) return;
    writeLocal(GHOST_KEY, on ? "on" : "off");
    set({ ghost: on });
  },
  setSound: (on) => {
    if (on === get().sound) return;
    writeLocal(SOUND_KEY, on ? "on" : "off");
    set({ sound: on });
  },
  setAxial: (on) => {
    if (on === get().axial) return;
    writeLocal(AXIAL_KEY, on ? "on" : "off");
    set({ axial: on });
  },
  setCut: (on) => {
    if (on === get().cut) return;
    writeLocal(CUT_KEY, on ? "on" : "off");
    set({ cut: on });
  },
  setTorch: (on) => {
    if (on === get().torch) return;
    writeLocal(TORCH_KEY, on ? "on" : "off");
    set({ torch: on });
  },
  setDetail: (on) => {
    if (on === get().detail) return;
    writeLocal(DETAIL_KEY, on ? "on" : "off");
    set({ detail: on });
  },
  setPlane: (plane) => {
    const state = get();
    if (plane === state.plane) return;
    writeLocal(PLANE_KEY, plane);
    set({
      plane,
      at: state.elsewhere,
      elsewhere: state.at,
      // Choosing the plane is the reader acting on the instrument, so the light
      // is theirs again whoever put it where it was.
      byAssistant: false,
    });
  },
}));

/** True while the sweep should stay where it was put rather than travel. */
export function scanIsStill(state: Pick<ScanStore, "held" | "pinned">): boolean {
  return state.held || state.pinned;
}
