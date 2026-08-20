import { useCallback, useEffect, useRef, useState } from "react";

import { newRequestId, onEngineEvent, transcribeAudio } from "@/lib/ipc";
import { VOICE_MAX_SECONDS, type Language } from "@/lib/schemas";

import { useVoiceRecorder } from "./useVoiceRecorder";

/**
 * Microphone control for the voice experiment (branch `experiment/voice`).
 *
 * Records, sends the clip to the sidecar, and hands the transcript back to the
 * composer through `onTranscript`. It deliberately does **not** send the
 * question: the text lands in the box for the reader to read and correct
 * first. A misheard structure name is worth catching before it becomes a
 * question about the wrong organ, and "aorta" is not a word every recogniser
 * gets right at the first attempt.
 *
 * When voice cannot run the control **stays put** and says why. It does not
 * hide itself: a button that vanishes when pressed is the same silent failure
 * as a button that does nothing, and it takes the retry with it.
 */

interface Props {
  language: Language;
  disabled: boolean;
  onTranscript: (text: string) => void;
}

export function VoiceButton({ language, disabled, onTranscript }: Props) {
  const recorder = useVoiceRecorder();
  const [waiting, setWaiting] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  // The transcript comes back on the ordinary engine channel, so this listens
  // for its own request id and ignores every other frame on it.
  useEffect(() => {
    const unlisten = onEngineEvent((event) => {
      if (!("request_id" in event) || event.request_id !== pendingRef.current) return;

      if (event.type === "transcript") {
        const heard = event.text.trim();
        if (heard) onTranscript(heard);
        else setEngineError("Nothing was heard. Try again, a little closer.");
      } else if (event.type === "error") {
        setEngineError(event.message);
      } else if (event.type !== "done") {
        return;
      }

      if (event.type === "done" || event.type === "error") {
        pendingRef.current = null;
        setWaiting(false);
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [onTranscript]);

  const toggle = useCallback(async () => {
    setEngineError(null);
    if (recorder.state === "recording") {
      const clip = await recorder.stop();
      if (!clip) return;
      const requestId = newRequestId();
      pendingRef.current = requestId;
      setWaiting(true);
      try {
        await transcribeAudio({
          request_id: requestId,
          audio_b64: clip.audioB64,
          mime_type: clip.mimeType,
          language,
        });
      } catch (cause) {
        pendingRef.current = null;
        setWaiting(false);
        setEngineError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }
    await recorder.start();
  }, [language, recorder]);

  const recording = recorder.state === "recording";
  const busy = waiting || recorder.state === "working";
  const remaining = Math.max(0, VOICE_MAX_SECONDS - recorder.elapsed);
  // Unavailable is a *state to report*, not a reason to disappear.
  //
  // The first version returned only the message here, which replaced the
  // button outright: pressing Speak made the control vanish and left a line of
  // near-invisible grey text under the composer. It read as "the button did
  // nothing and then went away", which is exactly the silent failure this
  // feature is supposed to avoid — and it was one-way, because with the button
  // gone there was no way to try again after plugging in a headset.
  //
  // The button stays. It is disabled, it says why in a colour that can be
  // read, and pressing it again re-runs the check.
  const unavailable = recorder.state === "unavailable";
  const message = engineError ?? recorder.error;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={disabled || busy}
        aria-pressed={recording}
        aria-label={recording ? "Stop recording" : "Ask by voice"}
        title={
          recording
            ? `Recording — stops on its own in ${remaining}s`
            : `Ask by voice (up to ${VOICE_MAX_SECONDS}s)`
        }
        className={
          "rounded px-2.5 py-1 text-[11px] font-medium disabled:opacity-30 " +
          (recording ? "bg-rose-600 text-white" : "bg-slate-700 text-slate-100")
        }
      >
        {busy
          ? "Listening…"
          : recording
            ? `Stop · ${remaining}s`
            : unavailable
              ? "Speak — unavailable"
              : "Speak"}
      </button>
      {message && (
        // amber-400, not slate-600: this is the one line explaining why the
        // button did nothing, and it has to be readable on a dark panel.
        <p className="flex-1 text-[11px] leading-tight text-amber-400" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
