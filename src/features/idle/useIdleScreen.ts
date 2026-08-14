import { useCallback, useEffect, useRef, useState } from "react";

/**
 * When the resting screen appears, and — more importantly — when it must not.
 *
 * The visuals are the easy half. What makes a screensaver either invisible or
 * infuriating is the timing, and three of the rules here are not obvious:
 *
 * **It never interrupts work in flight.** A reader who walks away mid-answer
 * comes back to the answer, not to an ornament that arrived while the model was
 * still writing. The same goes for a question typed but not sent: waking to
 * find a half-written thought behind a curtain is worse than having no resting
 * screen at all.
 *
 * **It stops dead when the window is not visible.** Not slower — stopped. A
 * canvas animating behind another window is a laptop battery being spent on
 * something nobody can see, and that is a defect however pretty it is.
 *
 * **The keystroke that dismisses it is not swallowed.** Focus never moved, so
 * the key reaches whatever had it, and the reader carries on typing the
 * sentence they started. Pointer events *are* swallowed, because the overlay is
 * physically in front — a click that dismissed the screen and also selected an
 * organ underneath would be a surprise nobody asked for.
 */

/** Fifteen minutes, as asked for. */
export const IDLE_MS = 15 * 60 * 1000;

/** What resets the clock. Deliberately coarse — any sign of a human. */
const ACTIVITY: (keyof WindowEventMap)[] = [
  "pointermove",
  "pointerdown",
  "keydown",
  "wheel",
  "focus",
];

/**
 * Whether a keystroke belongs to something the reader is typing into.
 *
 * `Ctrl+X` is "cut" on every desktop there is. Binding it globally without
 * this check would mean a reader cutting a line out of a case they are
 * writing gets a screensaver instead — the kind of collision that makes a
 * shortcut feel broken rather than clever.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The one chord that means "show me the resting screen", in one place.
 *
 * Shared by the toggle and by the activity handler that has to leave it alone,
 * because a chord recognised in two places is a chord that will be recognised
 * differently in two places.
 */
function isToggleChord(event: Event): boolean {
  if (!(event instanceof KeyboardEvent)) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.key.toLowerCase() !== "x") return false;
  return !isTyping(event.target);
}

/**
 * Whether there is a question typed and not yet sent, anywhere on the page.
 *
 * Read from the DOM rather than plumbed through a store, and that is the
 * deliberate choice: the composer keeps its draft in local state precisely so
 * that typing does not re-render everything subscribed to it, and lifting it
 * into a store to power a screensaver would trade a real cost for a cosmetic
 * one. One query a second is free, and it catches *every* box — the case
 * composer and the record entry as well as the chat.
 */
export function hasUnsentText(): boolean {
  const boxes = document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
    "textarea, input[type='text']",
  );
  for (const box of boxes) if (box.value.trim() !== "") return true;
  return false;
}

export interface IdleOptions {
  /**
   * False while there is work the screen must not cover — a request in flight.
   *
   * Unsent text is checked separately by `hasUnsentText`, so a caller cannot
   * forget it.
   *
   * This gates the **timer only**. `Ctrl+X` still works, because that is the
   * reader asking for it on purpose, and refusing an explicit request because
   * of a draft would be the software second-guessing them.
   */
  armed: boolean;
  /** Overridable so a test does not have to wait a quarter of an hour. */
  idleMs?: number;
}

export function useIdleScreen({ armed, idleMs = IDLE_MS }: IdleOptions): {
  showing: boolean;
  dismiss: () => void;
} {
  const [showing, setShowing] = useState(false);
  const lastActive = useRef(Date.now());

  const dismiss = useCallback(() => setShowing(false), []);

  // Kept in a ref so the timer effect below does not tear down and rebuild on
  // every keystroke — `armed` flips with each character typed into the
  // composer, and re-arming an interval that often is pure churn.
  const armedRef = useRef(armed);
  armedRef.current = armed;

  useEffect(() => {
    function seen(event: Event) {
      lastActive.current = Date.now();
      // The toggle chord is activity *and* an instruction, and the two
      // handlers would otherwise fight: this one closing the screen and the
      // toggle immediately reopening it, so `Ctrl+X` could open but never
      // close. The chord belongs to the toggle; everything else lands here.
      if (isToggleChord(event)) return;
      setShowing(false);
    }
    for (const event of ACTIVITY) window.addEventListener(event, seen, { passive: true });
    return () => {
      for (const event of ACTIVITY) window.removeEventListener(event, seen);
    };
  }, []);

  useEffect(() => {
    // Polling rather than one long timeout: the deadline moves on every sign of
    // activity, and rescheduling a fifteen-minute timer on every mouse move
    // costs more than asking the time once a second.
    const tick = setInterval(() => {
      if (document.hidden) {
        // A window nobody is looking at is not idle in the sense that matters,
        // and waking to a screensaver you never watched appear is disorienting.
        lastActive.current = Date.now();
        return;
      }
      if (!armedRef.current || hasUnsentText()) {
        lastActive.current = Date.now();
        return;
      }
      if (Date.now() - lastActive.current >= idleMs) setShowing(true);
    }, 1_000);
    return () => clearInterval(tick);
  }, [idleMs]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isToggleChord(event)) return;
      event.preventDefault();
      setShowing((open) => !open);
      lastActive.current = Date.now();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { showing, dismiss };
}
