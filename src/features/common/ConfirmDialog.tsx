import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useConfirmStore } from "@/stores/confirmStore";

/**
 * The one place the app asks before destroying something.
 *
 * # Why it is built rather than borrowed
 *
 * `window.confirm` blocks the whole webview, cannot say *what* is being deleted,
 * and looks like a browser rather than like this application. A destructive
 * question is exactly the moment the reader should feel they are still inside
 * the thing they trust.
 *
 * # The two deliberate refusals
 *
 * **Enter does not confirm.** Focus opens on Cancel, and the confirm button is
 * reached on purpose. Someone who hit ✕ by accident is very likely to be
 * holding a keyboard, and a dialog that deletes on Enter turns one slip into
 * two.
 *
 * **There is no "don't ask again".** The whole value here is the pause, and an
 * option to switch it off is an option to lose a year of notes in the six
 * seconds after somebody clicks it.
 */
export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const answer = useConfirmStore((s) => s.answer);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stopped here so it does not also close whatever sits underneath — the
      // print sheet and the study bar both listen for Escape.
      event.stopPropagation();
      answer(false);
    };
    // Capture phase, for the same reason.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [pending, answer]);

  if (!pending) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      // Above the print sheet, which is the only other full-screen layer.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm"
      // Clicking the backdrop backs out. Checking the target keeps a drag that
      // *ends* out here — starting inside the card — from dismissing it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) answer(false);
      }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="px-5 pb-4 pt-5">
          <h2 id="confirm-title" className="text-sm font-semibold text-slate-100">
            {pending.title}
          </h2>

          {pending.subject && (
            <p className="mt-3 max-h-24 overflow-hidden border-l-2 border-slate-700 pl-3 text-[12px] italic leading-relaxed text-slate-400">
              {pending.subject}
            </p>
          )}

          <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
            {pending.body}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 bg-slate-950/40 px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => answer(false)}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => answer(true)}
            className="rounded border border-rose-700 bg-rose-600/20 px-3 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-600/35"
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
