import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

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
 * # The two details that make it work
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
  /** The height `rows` gave it, read once before any of this interferes. */
  const floor = useRef<number | null>(null);

  useLayoutEffect(() => {
    const box = field.current;
    if (!box) return;
    if (floor.current === null) floor.current = box.offsetHeight;
    box.style.height = "auto";
    box.style.height = `${Math.max(box.scrollHeight, floor.current)}px`;
  }, [value]);

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
