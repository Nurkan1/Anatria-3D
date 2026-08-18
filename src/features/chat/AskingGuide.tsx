import { useEffect, useRef, useState } from "react";

/**
 * How to get a good answer, and why pointing first is most of it.
 *
 * Sits beside the composer rather than in the main guide, because it is advice
 * about the thing the reader is doing at the moment they are doing it. The full
 * guide is where you go to learn the application; this is where you find out,
 * mid-sentence, that the question you are typing will work better if you click
 * something first.
 *
 * Deliberately not a modal. A dialog over the transcript would interrupt the
 * task it is trying to improve.
 */

const POINTS: { title: string; body: string }[] = [
  {
    title: "Point first",
    body:
      "Click a structure, then ask. The assistant is told exactly what you " +
      "selected and treats it as the subject of your question, so it answers " +
      "instead of searching for what you meant.",
  },
  {
    title: "Two or more means compare",
    body:
      "Ctrl-click several and the assistant is told to address the set. " +
      "Select the thalamus and the hypothalamus and ask how they differ.",
  },
  {
    title: "A region sets the scope",
    body:
      "Isolate a group — the brainstem, the kidney, a body region — and the " +
      "question is understood to be about that, not about the whole body.",
  },
  {
    title: "Specific beats broad",
    body:
      "“What does this do?” with something selected gets a better answer than " +
      "“explain the brain” with nothing, and costs less: thousands of " +
      "structures are loaded, and with no subject the assistant has to search " +
      "the atlas before it can start.",
  },
];

export function AskingGuide() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Click-away and Escape, so the panel never has to be hunted closed.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="rounded border border-slate-700/70 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
      >
        How to ask
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="How to ask"
          /*
            17rem, not a comfortable 20. The assistant panel is resizable down
            to 300px and its container clips overflow, so anything wider than
            the panel's inner width has its left edge cut off at the narrowest
            setting — which is exactly the setting where a reader most needs the
            help to be readable.
          */
          className="absolute bottom-full right-0 z-20 mb-1.5 w-[17rem] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl"
        >
          <p className="mb-2 text-[11px] font-semibold text-slate-200">
            Getting a good answer
          </p>
          <ul className="space-y-2">
            {POINTS.map((point) => (
              <li key={point.title} className="text-[11px] leading-snug text-slate-400">
                <span className="font-medium text-slate-300">{point.title}.</span>{" "}
                {point.body}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The reminder, shown while a question is being typed at nothing in particular.
 *
 * One line, in the same muted register as the cost notice above it, with the
 * way to stop seeing it on the same row. It never appears to a reader who
 * already selects before asking — see `shouldShowAimHint`.
 */
export function AimHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <p className="mx-3 mb-2 flex items-start gap-2 rounded border border-sky-800/50 bg-sky-900/15 px-2 py-1 text-[10px] leading-snug text-slate-400">
      <span className="flex-1">
        <span className="font-medium text-sky-300">Nothing is selected.</span> Click a
        structure in the viewport first and the assistant is told what you mean — it
        answers that, instead of searching the atlas for it.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Do not show this again"
        className="shrink-0 rounded px-1 text-slate-500 transition hover:text-slate-200"
      >
        ×
      </button>
    </p>
  );
}
