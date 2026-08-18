import { useCallback, useState } from "react";

import type { SessionMode } from "@/lib/schemas";

/**
 * Whether to remind the reader to point at something before they ask.
 *
 * # Why this exists
 *
 * The assistant is told what the reader has selected, and that one fact decides
 * how good the answer is. With a structure selected the prompt says *treat this
 * as the subject*; with several it says *this is a request to compare them*.
 * With nothing selected it says nothing at all, and the model is handed a
 * summary of three and a half thousand structures and has to search before it
 * can begin. The answer is vaguer and the question costs more — every
 * `find_structures` call is another round trip through the whole transcript.
 *
 * A reader who has never been told this has no way to discover it. The tool
 * looks like a chat box, and a chat box does not usually care what you were
 * looking at when you typed.
 *
 * # Why it stops on its own
 *
 * Nagging is worse than silence: a hint that appears on every empty selection
 * forever becomes something to look past, and then the one time it matters it
 * is invisible too. So it retires itself the moment there is evidence the
 * reader knows — either they dismissed it, or they sent a question with
 * something selected, which is the behaviour the hint was asking for. Nobody
 * who already works this way ever sees it.
 */

const STORAGE_KEY = "anatria3d.aimHint.v1";

function hasLearned(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "learned";
  } catch {
    // A full or disabled store fails toward showing the hint. Reading it once
    // more is mild; never seeing it is a student paying for vague answers.
    return false;
  }
}

export interface AimHintInput {
  /** The reader has started typing. The hint is not a permanent banner. */
  drafting: boolean;
  /** Something is selected or isolated — the assistant has a subject. */
  hasAim: boolean;
  mode: SessionMode;
  learned: boolean;
}

/**
 * The decision, as a pure function so it can be reasoned about in a test.
 *
 * Case mode is excluded deliberately. A drill's subject is the patient in
 * front of the reader, and the answer being typed is a diagnosis rather than a
 * question about a structure — telling someone mid-drill to go and click an
 * organ would be advice for a different task.
 */
export function shouldShowAimHint({ drafting, hasAim, mode, learned }: AimHintInput): boolean {
  if (learned || hasAim || !drafting) return false;
  return mode !== "case";
}

export function useAimHint() {
  const [learned, setLearned] = useState(hasLearned);

  const retire = useCallback(() => {
    setLearned(true);
    try {
      localStorage.setItem(STORAGE_KEY, "learned");
    } catch {
      // Not worth interrupting a session over.
    }
  }, []);

  return { learned, retire };
}
