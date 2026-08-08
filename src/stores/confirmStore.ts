import { create } from "zustand";

/**
 * Asking before doing something that cannot be taken back.
 *
 * # Why a promise and not a callback
 *
 * The call site reads as one line — `if (await askToConfirm(…)) remove()` —
 * which matters because the alternative is splitting every destructive action
 * into a handler that opens a dialog and a second handler that finishes the
 * job. That split is where the bugs live: the second half stops knowing what
 * the first half was about.
 */

export interface ConfirmRequest {
  /** What is about to happen, as a question. */
  title: string;
  /** What it costs, and whether anything survives it. */
  body: string;
  /**
   * The thing itself — the note's own words, the session's own title.
   *
   * This is what turns a confirmation from a reflex into a check. "Are you
   * sure?" is answered yes by everybody; seeing the sentence you are about to
   * lose is what catches the wrong ✕.
   */
  subject?: string;
  /** The verb on the button that does it. Never "OK". */
  confirmLabel: string;
}

interface Pending extends ConfirmRequest {
  settle: (confirmed: boolean) => void;
}

interface ConfirmStore {
  pending: Pending | null;
  answer: (confirmed: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>()((set, get) => ({
  pending: null,
  answer: (confirmed) => {
    const pending = get().pending;
    if (!pending) return;
    // Cleared before settling, so a caller that immediately asks something else
    // is not overwritten by this one's own teardown.
    set({ pending: null });
    pending.settle(confirmed);
  },
}));

/** Put the question on screen; resolves to what the reader chose. */
export function askToConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const open = useConfirmStore.getState().pending;
    // A second question arriving while one is open would strand the first
    // promise for ever, and the action behind it would hang. Decline it:
    // "no" is the only safe reading of a destructive question nobody answered.
    if (open) open.settle(false);
    useConfirmStore.setState({ pending: { ...request, settle: resolve } });
  });
}
