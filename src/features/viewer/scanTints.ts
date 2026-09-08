/**
 * The colours the scanner's light can be, and why it is a short list.
 *
 * # Why a palette and not a colour picker
 *
 * The light is *additive*: it is added to whatever colour the tissue already
 * has, and that is what decides whether a structure separates from its
 * neighbours or disappears into them. A deep red light over muscle adds red to
 * red and reveals nothing; the same light over bone is legible. A free picker
 * hands the reader several hundred thousand values, most of which make the mode
 * worse and none of which say so.
 *
 * So four, each chosen for what it separates from:
 *
 * - **Cyan** is the neutral one. Nothing in the body is cyan, so it lands on
 *   every tissue as light rather than as a colour of its own.
 * - **Green** reads against red — muscle, myocardium, anything vascular — where
 *   cyan is merely cool and green is clearly not the tissue.
 * - **Amber** is the warm reading. It buries reds and lifts bone, cartilage and
 *   fascia, which is the opposite selection to green: the same sweep shows a
 *   different half of the body.
 * - **Violet** separates from both, and is the one that reads on pale
 *   structures — nerves, tendon, the fatty planes — that cyan washes out.
 *
 * # Why each colour is two numbers
 *
 * `light` is what the shader adds, and it is an *intensity*, not a hue: the
 * components run past 1 because emissive radiance is not clamped to a screen
 * colour. `hex` is the same colour as a surface tint for the ring and the
 * swatch. They are written separately because normalising one into the other
 * gives a ring that is either dim or blown out, depending on which way it is
 * done.
 */

export type ScanTintId = "cyan" | "green" | "amber" | "violet";

export interface ScanTint {
  id: ScanTintId;
  /** UI label. English, like the rest of the interface. */
  label: string;
  /** The ring's own colour, and the swatch in the control. */
  hex: string;
  /** Emissive radiance added at the centre of the band. */
  light: readonly [number, number, number];
}

export const SCAN_TINTS: readonly ScanTint[] = [
  { id: "cyan", label: "Cyan", hex: "#1ae0ff", light: [0.1, 1.2, 1.5] },
  { id: "green", label: "Green", hex: "#2bf07a", light: [0.14, 1.45, 0.55] },
  { id: "amber", label: "Amber", hex: "#ff9a3c", light: [1.5, 0.72, 0.14] },
  { id: "violet", label: "Violet", hex: "#b06cff", light: [0.92, 0.42, 1.6] },
];

export const DEFAULT_TINT: ScanTintId = "cyan";

/**
 * The tint for an id, or the default for anything that is not one.
 *
 * Total on purpose. The id arrives from `localStorage`, which is a text file a
 * previous version wrote and a person can edit, so "green3" and `null` are both
 * things that happen — and a scanner that fails to light because a preference
 * file is stale would be a very silly bug to ship.
 */
export function scanTint(id: string | null | undefined): ScanTint {
  return SCAN_TINTS.find((tint) => tint.id === id) ?? SCAN_TINTS[0]!;
}
