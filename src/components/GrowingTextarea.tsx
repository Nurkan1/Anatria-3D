import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

/**
 * A box that is as tall as what is in it, up to a limit.
 *
 * # The problem it solves
 *
 * Every writing surface in this app was a fixed two or three rows with the
 * browser's own resize handle switched off. That is fine for a sentence and
 * wrong for everything else: a pasted case runs to a page, a note taken from an
 * answer is a paragraph, and reviewing either through a three-line window meant
 * scrolling a slot to read your own text before deciding whether to keep it.
 *
 * # Why a limit rather than free growth
 *
 * These fields all sit in flex columns beside something else that matters — the
 * transcript, the record, the rest of a form. An unbounded field wins every
 * argument for space and pushes its neighbour to nothing, which is a bug this
 * codebase has already paid for once. Past the limit the field stops growing
 * and scrolls, which is the point at which scrolling is the right answer.
 *
 * # The three details that make it work
 *
 * **Collapse before measuring.** `scrollHeight` reports the content's height
 * *or* the box's current height, whichever is larger. Measure without resetting
 * and the field only ever grows: delete a pasted page and the box stays a page
 * tall with one line in it.
 *
 * **`rows` stays the floor.** Each call site chose its resting size and those
 * choices are still right — an empty composer should not collapse to a single
 * line just because it is empty. The height it had before this component
 * touched it is remembered on mount and never gone below.
 *
 * **A measurement of zero is not a measurement.** A field inside a panel that
 * is switched off — the assistant folded away, a tab not on screen — is
 * `display: none`, and the browser answers every question about it with zero.
 * Writing that in pinned the field shut, and nothing measured it again until
 * the text changed, so the reader got a squashed strip instead of a composer:
 * on first launch, and every time the panel was folded and brought back. So a
 * zero is left alone, and the field is measured again when it reappears.
 */

/**
 * How tall a field may get before it stops growing.
 *
 * A little over a third of the window: enough that a pasted case is read in one
 * piece, and short enough that whatever the field shares its column with is
 * still on screen. Call sites in tighter places pass their own.
 */
export const GROW_LIMIT = "38vh";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> & {
  value: string;
  /** Overrides `GROW_LIMIT` where the field shares its space with more. */
  limit?: string;
};

export function GrowingTextarea({
  value,
  limit = GROW_LIMIT,
  className = "",
  ...rest
}: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  /** The height `rows` gave it, read once while it could actually be read. */
  const floor = useRef<number | null>(null);

  const fit = useCallback(() => {
    const box = field.current;
    if (!box) return;
    // Hidden: every measurement is zero, and a zero written into the style
    // outlives the hiding. Left alone, the field keeps the height `rows` gives
    // it and is measured properly the moment it is on screen again.
    if (box.offsetHeight === 0 && box.scrollHeight === 0) return;
    // Only a real measurement may become the floor, for the same reason.
    if (floor.current === null && box.offsetHeight > 0) floor.current = box.offsetHeight;
    box.style.height = "auto";
    box.style.height = `${Math.max(box.scrollHeight, floor.current ?? 0)}px`;
  }, []);

  useLayoutEffect(fit, [value, fit]);

  /**
   * Measured again whenever the box itself changes size.
   *
   * Which covers the two cases a keystroke never does: a panel folded away and
   * brought back — zero to its real height — and the panel being dragged
   * narrower, where the same text wraps onto more lines than it did before.
   * Writing the height it already has produces no further notification, so this
   * settles rather than looping.
   */
  useEffect(() => {
    const box = field.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <textarea
      ref={field}
      value={value}
      style={{ maxHeight: limit }}
      className={`resize-none overflow-y-auto ${className}`}
      {...rest}
    />
  );
}
