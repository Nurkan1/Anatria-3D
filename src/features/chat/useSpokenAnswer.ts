import { useCallback, useEffect, useRef, useState } from "react";

import type { Language } from "@/lib/schemas";
import { chatPreferences } from "@/stores/chatPreferences";

import { speakableText, speechChunks } from "./speakableText";
import { loadVoices, voicesForLanguage } from "./speech";

/**
 * Read a finished answer aloud, using the voices the machine already has.
 *
 * Spoken **after** the answer is on screen, never instead of it. The written
 * answer is the authoritative copy and carries the compliance notice; speech is
 * an addition to it, on the same screen, at the same moment. That is why the
 * notice does not need a spoken form: the audio is another rendering of an
 * exchange the reader is already looking at, not a channel that leaves the app.
 * A printed export is the opposite case, which is why *that* carries the notice
 * on every page. **Nothing here may ever write audio to a file** without
 * revisiting exactly that.
 *
 * No engine is bundled and no audio is sent anywhere — see `speech.ts` for why
 * only local voices are used.
 */

export type SpeechState = "idle" | "speaking";

export interface UseSpokenAnswer {
  state: SpeechState;
  /** True once a local voice for `language` is known to exist. */
  supports: (language: Language) => boolean;
  /** Why the last attempt failed, for the reader. */
  error: string | null;
  /** Read `markdown` aloud. Cleaned up and split before it is queued. */
  speak: (markdown: string, language: Language) => void;
  /** Stop immediately and drop anything still queued. */
  stop: () => void;
}

/** The platform, or `null` where the webview was built without speech. */
function synthesis(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

export function useSpokenAnswer(): UseSpokenAnswer {
  const [state, setState] = useState<SpeechState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<readonly SpeechSynthesisVoice[]>([]);

  // Set while a queue we started is running, so the `error` an utterance fires
  // on `cancel()` can be told apart from one the engine raised by itself.
  const stoppingRef = useRef(false);

  useEffect(() => {
    const synth = synthesis();
    if (!synth) return;

    let live = true;
    void loadVoices(synth).then((found) => {
      if (live) setVoices(found);
    });

    return () => {
      live = false;
      // Speech outlives the component that started it — the engine is global —
      // so leaving the view has to silence it explicitly.
      synth.cancel();
    };
  }, []);

  const supports = useCallback(
    (language: Language) => voicesForLanguage(voices, language).length > 0,
    [voices],
  );

  const stop = useCallback(() => {
    const synth = synthesis();
    if (!synth) return;
    stoppingRef.current = true;
    synth.cancel();
    setState("idle");
  }, []);

  const speak = useCallback(
    (markdown: string, language: Language) => {
      const synth = synthesis();
      if (!synth) {
        setError("This build of the app has no speech support.");
        return;
      }

      const voice = voicesForLanguage(voices, language)[0];
      if (!voice) {
        setError("No voice for this language is installed on this computer.");
        return;
      }

      // Read at call time rather than captured as a dependency: changing the
      // pace should affect the next answer without rebuilding the callback.
      const preferences = chatPreferences();
      const text = speakableText(markdown, preferences.spokenLimit);
      const chunks = speechChunks(text);
      if (chunks.length === 0) return;

      setError(null);
      stoppingRef.current = true;
      synth.cancel();

      // Chromium drops an utterance queued in the same task as the `cancel()`
      // that preceded it. One turn of the event loop is enough to avoid it,
      // and is imperceptible next to the speech itself.
      setTimeout(() => {
        stoppingRef.current = false;
        setState("speaking");

        chunks.forEach((chunk, index) => {
          const utterance = new SpeechSynthesisUtterance(chunk);
          utterance.voice = voice;
          // Set alongside the voice: some platforms fall back to the locale
          // rather than the voice when the two disagree.
          utterance.lang = voice.lang;
          utterance.rate = preferences.spokenSpeed;
          utterance.volume = preferences.spokenVolume;

          if (index === chunks.length - 1) {
            utterance.onend = () => setState("idle");
          }

          utterance.onerror = (event) => {
            // `cancel()` reaches every queued utterance as an error. Stopping
            // on purpose is not a failure and must not be reported as one.
            if (stoppingRef.current || event.error === "canceled" || event.error === "interrupted") {
              return;
            }
            setError("The voice stopped unexpectedly.");
            setState("idle");
          };

          synth.speak(utterance);
        });
      }, 0);
    },
    [voices],
  );

  return { state, supports, error, speak, stop };
}
