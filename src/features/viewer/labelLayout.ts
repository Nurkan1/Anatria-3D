/**
 * Where the labels go, laid out the way an atlas plate lays them out.
 *
 * Text placed directly on a structure is unreadable the moment two structures
 * are close together, which in anatomy is always. Printed plates solve it the
 * same way every time: the names live in the margins, in a tidy column, and a
 * thin leader line runs from each one to the thing it names. Nothing overlaps,
 * and the anatomy stays uncovered.
 *
 * Pure, and separate from anything that draws — this is the part with the
 * arithmetic, and it is the same arithmetic for the live overlay and for the
 * exported image at four times the resolution.
 */

export interface LabelAnchor {
  id: string;
  text: string;
  /** Where the structure is on screen, in the layout's own units. */
  x: number;
  y: number;
  /** True when the structure is behind the camera, where a projection lies. */
  behind?: boolean;
}

export interface PlacedLabel extends LabelAnchor {
  /**
   * The edge of the text nearest the figure.
   *
   * Left-column labels end here and right-column labels start here, so both
   * columns face the anatomy — which is what keeps the leader lines short and
   * the names off the model.
   */
  labelX: number;
  labelY: number;
  side: "left" | "right";
}

export interface LabelLayoutOptions {
  width: number;
  height: number;
  /** Vertical space one label occupies, which is what stops them colliding. */
  lineHeight?: number;
  /** Smallest allowed distance from the viewport edge. */
  margin?: number;
  /** Space kept clear at the top and bottom. */
  padding?: number;
  /** How far the columns stand off from the anatomy they name. */
  gap?: number;
  /**
   * How wide a label will be drawn, so the column can leave room for it.
   *
   * `labelX` is where the leader line *meets* the name, and the name extends
   * outwards from there — leftwards in the left column, rightwards in the
   * right. Clamping `labelX` to the margin therefore protects the anchor and
   * not the text, which is how an exported plate came back reading
   * "t breve musculi bicipitis brachii" with the *Capu* off the edge.
   *
   * Optional because the measurement belongs to whoever is drawing: the canvas
   * has `measureText`, the DOM has `offsetWidth`, and this module has neither.
   * Without it the columns behave as they did, which is right for a caller
   * whose labels are short and wrong for one whose labels are Latin.
   */
  measure?: (text: string) => number;
}

const DEFAULTS = { lineHeight: 20, margin: 12, padding: 16, gap: 64 };

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(high, low));

/**
 * Resolve one column of labels so none overlaps its neighbour.
 *
 * Two passes. The first walks down, pushing each label below the one before it;
 * that alone can run the last few off the bottom of a full column, so the
 * second walks back up doing the same in reverse. The result is the closest
 * arrangement to where the structures actually are that still fits.
 */
function stack(
  labels: PlacedLabel[],
  lineHeight: number,
  top: number,
  bottom: number,
): void {
  labels.sort((a, b) => a.y - b.y);

  let cursor = top;
  for (const label of labels) {
    label.labelY = Math.max(label.y, cursor);
    cursor = label.labelY + lineHeight;
  }

  cursor = bottom;
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const label = labels[index]!;
    label.labelY = Math.min(label.labelY, cursor);
    cursor = label.labelY - lineHeight;
  }
}

export function layoutLabels(
  anchors: LabelAnchor[],
  options: LabelLayoutOptions,
): PlacedLabel[] {
  const { width, height } = options;
  const lineHeight = options.lineHeight ?? DEFAULTS.lineHeight;
  const margin = options.margin ?? DEFAULTS.margin;
  const padding = options.padding ?? DEFAULTS.padding;
  const gap = options.gap ?? DEFAULTS.gap;

  const top = padding;
  const bottom = Math.max(height - padding, padding);
  // A column cannot hold more than it can hold. Past this the passes above
  // would produce an arrangement that overlaps anyway, so the extras are
  // dropped rather than drawn on top of each other.
  const capacity = Math.max(Math.floor((bottom - top) / lineHeight) + 1, 0);

  const visible = anchors.filter((anchor) => {
    // A point behind the camera projects to a mirrored position in front of
    // it, so a label for it would point confidently at the wrong place.
    if (anchor.behind) return false;
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return false;
    return anchor.x >= 0 && anchor.x <= width && anchor.y >= 0 && anchor.y <= height;
  });
  if (visible.length === 0) return [];

  /*
   * The columns stand off from the *anatomy*, not from the window.
   *
   * Pinned to the viewport edges, two labels on a wide screen produced two
   * metre-long leader lines crossing an empty background — technically correct
   * and useless as a plate. A printed figure puts its names beside the subject,
   * so the columns are placed just outside where the structures actually are,
   * and only fall back to the window edge when the subject fills the frame.
   */
  const left = Math.min(...visible.map((anchor) => anchor.x));
  const right = Math.max(...visible.map((anchor) => anchor.x));
  const middle = (left + right) / 2;

  // Split about the anatomy's own midline rather than the window's, so an
  // off-centre subject does not send all of its names to one column. Done
  // before the columns are placed, because where a column can stand depends on
  // how wide the names that will sit in it are.
  const taken: Record<"left" | "right", LabelAnchor[]> = { left: [], right: [] };
  for (const anchor of visible) {
    const side = anchor.x <= middle ? "left" : "right";
    if (taken[side].length >= capacity) continue;
    taken[side].push(anchor);
  }

  const widest = (anchors: LabelAnchor[]) =>
    options.measure ? Math.max(0, ...anchors.map((a) => options.measure!(a.text))) : 0;

  // The bound each column may not cross, so the *text* stays inside the frame
  // rather than only its anchor. `Math.min`/`Math.max` against the far margin
  // keep the bounds ordered when a single name is wider than the frame — it
  // still overflows, because nothing can fit it, but the clamp does not invert.
  const leftBound = Math.min(margin + widest(taken.left), width - margin);
  const rightBound = Math.max(width - margin - widest(taken.right), margin);
  const leftColumn = clamp(left - gap, leftBound, width - margin);
  const rightColumn = clamp(right + gap, margin, rightBound);

  const sides: Record<"left" | "right", PlacedLabel[]> = { left: [], right: [] };
  for (const side of ["left", "right"] as const) {
    for (const anchor of taken[side]) {
      sides[side].push({
        ...anchor,
        side,
        labelX: side === "left" ? leftColumn : rightColumn,
        labelY: anchor.y,
      });
    }
  }

  stack(sides.left, lineHeight, top, bottom);
  stack(sides.right, lineHeight, top, bottom);

  return [...sides.left, ...sides.right];
}
