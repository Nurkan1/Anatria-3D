/**
 * What the 3D space sits on.
 *
 * Two settings, because the two are for different things. The dark one is for
 * working: a body glows against it and long sessions do not tire the eye. The
 * light one is for taking things out — printed handouts, slides on a projector,
 * a figure pasted into a document that is not itself dark.
 *
 * The light setting is deliberately *not* white. Pure white puts the brightest
 * pixel in the image behind the subject rather than on it, and bone — which is
 * near-white — disappears into it. A low, slightly blue grey keeps ivory
 * reading as ivory and stays out of the way, which is the colour a printed
 * plate has always used for the same reason.
 */

export type BackgroundMode = "dark" | "light";

export interface BackgroundTheme {
  /** The renderer's clear colour, and the export's. */
  canvas: string;
  /** Ambient light, lifted on the light setting.
   *
   * A model lit for a dark room reads as murky against paper: the eye adapts to
   * the brightest thing on screen, and next to a light field the shadows look
   * like dirt rather than depth.
   */
  ambient: number;
  /** Leader lines from a label to its structure. */
  leader: string;
  /** The plate behind a label's text. */
  chip: string;
  ink: string;
  footerInk: string;
  footerSubtle: string;
}

export const BACKGROUNDS: Record<BackgroundMode, BackgroundTheme> = {
  dark: {
    canvas: "#0b1220",
    ambient: 0.34,
    leader: "rgba(125, 211, 252, 0.65)",
    chip: "rgba(2, 6, 23, 0.75)",
    ink: "#e0f2fe",
    footerInk: "#94a3b8",
    footerSubtle: "#64748b",
  },
  light: {
    // Off-white with a blue cast — paper under a cool light, not a lightbox.
    canvas: "#dae2ec",
    ambient: 0.46,
    leader: "rgba(30, 64, 120, 0.55)",
    chip: "rgba(255, 255, 255, 0.82)",
    ink: "#15304f",
    footerInk: "#334155",
    footerSubtle: "#64748b",
  },
};

export function backgroundTheme(mode: BackgroundMode): BackgroundTheme {
  return BACKGROUNDS[mode] ?? BACKGROUNDS.dark;
}
