/**
 * The look of the small controls that sit over the viewport.
 *
 * # Why they carry their own ground
 *
 * They sat on a seventy-per-cent slate wash with dim text, tuned against the
 * dark viewport — and the viewport has a light background as well. Over it a
 * ten-per-cent cyan tint is simply white, and slate-600 text is a grey smudge:
 * reported from a light-background session where the Scanner switch, the Study
 * views switch and every folded chip were barely legible. Everything here is
 * dark and nearly opaque instead, so it reads the same over either background,
 * the way the panels beside it already did.
 *
 * The text is slate-400 rather than the 500 and 600 it was. Those are below
 * the contrast small text needs even on the dark ground, which is a separate
 * fault the light background only made obvious.
 *
 * # Why this file exists at all
 *
 * Seven components had copied the same classes, and they had already drifted
 * apart — borders at 60 and 70, text at 500 and 600. Every class is written
 * out in full here, which is also what lets Tailwind find it.
 */

/** The ground every overlay control stands on: border, fill and text colour. */
export const OVERLAY_GROUND = "border border-slate-700/80 bg-slate-950/90 text-slate-400";

/** A small monospaced chip: a folded panel, a hint marker, a closed view. */
export const OVERLAY_CHIP = `rounded ${OVERLAY_GROUND} px-1.5 py-0.5 font-mono text-[9px]`;

/** What a chip that does something looks like under the pointer. */
export const OVERLAY_CHIP_ACTION = "hover:border-cyan-700 hover:text-cyan-300";

/** A mode switch that is off. */
export const OVERLAY_SWITCH_OFF =
  "border-slate-700 bg-slate-950/90 text-slate-300 hover:border-slate-500";

/**
 * A mode switch that is on: a dark ground tinted with the mode's own hue.
 *
 * Tinted dark rather than tinted light. A light tint depends on what is behind
 * it to look like a colour at all, which is exactly the fault this replaces.
 */
export const OVERLAY_SWITCH_ON = {
  cyan: "border-cyan-500 bg-cyan-950/90 text-cyan-200",
  sky: "border-sky-500 bg-sky-950/90 text-sky-200",
} as const;
