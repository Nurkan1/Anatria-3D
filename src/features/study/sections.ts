/**
 * Which parts of the journal are folded away, and when.
 *
 * # Why the panel needed folding at all
 *
 * The three lists here grow without limit and they grow at different rates. A
 * term of study is a few dozen patients, some hundreds of sessions, and however
 * many notes somebody takes — and notes sit at the top, so every one of them
 * pushes the patients and the sessions further down. At two notes that is
 * nothing. At a hundred it means the patient you are working with is off the
 * bottom of a panel you have to scroll to reach.
 *
 * # Why notes are the one that starts folded
 *
 * Notes are reference: they are what you go and look up. Patients and sessions
 * are the work in front of you — the reason the tab is open. So the list that
 * costs the most space is the one least likely to be wanted the moment the
 * panel appears, and it is the one that rests folded.
 *
 * This is a resting position, not a rule. Every section toggles, and the count
 * beside the heading says what is behind a folded one so nothing is hidden
 * without saying how much.
 */

export type StudySection = "notes" | "cases" | "sessions";

export const SECTIONS: StudySection[] = ["notes", "cases", "sessions"];

/** Folded when the panel is simply open, with nothing being looked for. */
const AT_REST: Record<StudySection, boolean> = {
  notes: true,
  cases: false,
  sessions: false,
};

/**
 * Nothing folded, because a search reaches into all three.
 *
 * One box narrows notes, patients and sessions together — that was deliberate,
 * so the reader never has to choose which list they meant. A folded section
 * would then quietly withhold its own matches, and the reader would conclude
 * the thing they were looking for is not in the journal.
 */
const WHILE_SEARCHING: Record<StudySection, boolean> = {
  notes: false,
  cases: false,
  sessions: false,
};

/**
 * The fold state a search should put the panel into.
 *
 * Returned as a state to apply rather than a condition layered over the
 * reader's toggle, so the chevron never disagrees with what is on screen: while
 * a search is running the sections are genuinely open, and closing one closes
 * it. Clearing the search returns the panel to rest.
 */
export function foldStateFor(searching: boolean): Record<StudySection, boolean> {
  return searching ? { ...WHILE_SEARCHING } : { ...AT_REST };
}
