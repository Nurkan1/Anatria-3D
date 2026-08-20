import type { Language } from "@/lib/schemas";

import { useSpokenAnswer } from "./useSpokenAnswer";

/**
 * Read one answer aloud, on request.
 *
 * **Opt-in per answer, deliberately.** Speaking every answer automatically
 * would be the wrong default for a study tool: a voice starting unprompted is
 * intrusive in a library, in a lecture, or beside somebody else working, and
 * the reader who wants it can ask for it in one click. It also keeps the
 * written answer — the copy carrying the on-screen regulatory notice — as the
 * thing that always happens, with speech as an addition.
 *
 * Part of the local voice experiment (branch `experiment/voice`).
 */

interface Props {
  content: string;
  language: Language;
}

export function SpeakAnswerButton({ content, language }: Props) {
  const spoken = useSpokenAnswer();
  const busy = spoken.state !== "idle";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (busy) spoken.stop();
          else void spoken.speak(content, language);
        }}
        aria-label={busy ? "Stop reading aloud" : "Read this answer aloud"}
        title={busy ? "Stop reading aloud" : "Read this answer aloud"}
        className="text-[11px] text-slate-400 transition hover:text-slate-200"
      >
        {spoken.state === "synthesising"
          ? "Preparing…"
          : spoken.state === "playing"
            ? "Stop"
            : "Read aloud"}
      </button>
      {spoken.error && (
        <span className="text-[10px] text-amber-400" role="status">
          {spoken.error}
        </span>
      )}
    </>
  );
}
