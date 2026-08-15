/**
 * Whether a keystroke belongs to the viewport, decided in one place.
 *
 * # Why this is a module and not three copies
 *
 * The viewport has grown a keyboard: isolate, hide, restore, clear, explode,
 * zoom, and the five anatomical viewpoints. Each bar owns its own listener,
 * which is right — a control and its key belong together — but every one of
 * them had to answer the same question first, and every one of them answered
 * it with a copy of the same four lines.
 *
 * That is a rule that will drift. The app has a chat box, a case composer, a
 * record entry, a note editor, three search fields and a patient picker; the
 * day one of those copies is missed, typing "aorta" into a search box turns
 * the body to the anterior view and takes a structure out of sight. The cost
 * of that bug is not a wrong pixel — it is a reader who stops trusting the
 * keyboard and goes back to the mouse for everything.
 *
 * # What it refuses, and why each one
 *
 * - **Anything with focus in a field.** `INPUT`, `TEXTAREA`, `SELECT` and
 *   anything `contenteditable`. The letters here are also letters people type.
 * - **Ctrl, Cmd and Alt.** Those combinations belong to the window and the
 *   operating system — `Ctrl+C` is copy, `Ctrl` with the zoom keys is the
 *   browser's own. Taking them would remove something the reader already had.
 *
 * **Shift is deliberately allowed.** There is no `+` without it on a US
 * keyboard, and a reader holding shift out of habit still means the letter
 * they pressed.
 */

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * The key this event means for the viewport, lowercased — or nothing.
 *
 * Lowercased so a caller never has to think about the shift state of a letter,
 * and returning `null` rather than a boolean so the common shape at the call
 * site is one lookup rather than a guard plus a read.
 */
export function viewportKey(event: KeyboardEvent): string | null {
  if (isTypingTarget(event.target)) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return event.key.toLowerCase();
}
