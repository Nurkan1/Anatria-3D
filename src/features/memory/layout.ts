import type { FocusMargins } from "./scene/memoryScene";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How much of each edge the panels take, so the hologram can use the rest.
 *
 * Each visible panel is read by where it sits: one standing along the left or
 * right takes that side, one lying across the top or bottom takes that edge.
 * The largest claim on each edge wins. This is what lets the same screen work
 * on a laptop and on a wall display — nothing is laid out for a size, the
 * brain simply goes where there is room.
 */
export function freeMargins(panels: readonly Box[], width: number, height: number, gap = 16): FocusMargins {
  const margins: FocusMargins = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const panel of panels) {
    const w = panel.right - panel.left;
    const h = panel.bottom - panel.top;
    if (w <= 0 || h <= 0) continue;
    const lying = w > width * 0.55;
    if (lying) {
      const middle = (panel.top + panel.bottom) / 2;
      if (middle > height / 2) margins.bottom = Math.max(margins.bottom, height - panel.top + gap);
      else margins.top = Math.max(margins.top, panel.bottom + gap);
    } else {
      const middle = (panel.left + panel.right) / 2;
      if (middle < width / 2) margins.left = Math.max(margins.left, panel.right + gap);
      else margins.right = Math.max(margins.right, width - panel.left + gap);
    }
  }
  // Never leave the brain less than a third of either dimension.
  const shrink = (a: number, b: number, total: number) => {
    const room = total - a - b;
    const least = total / 3;
    if (room >= least) return [a, b] as const;
    const scale = (total - least) / Math.max(1, a + b);
    return [a * scale, b * scale] as const;
  };
  [margins.left, margins.right] = shrink(margins.left, margins.right, width);
  [margins.top, margins.bottom] = shrink(margins.top, margins.bottom, height);
  return margins;
}
