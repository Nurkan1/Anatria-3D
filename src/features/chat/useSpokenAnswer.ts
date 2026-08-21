import { useCallback, useEffect, useRef, useState } from "react";

import { newRequestId, onEngineEvent, speakText } from "@/lib/ipc";
import type { Language } from "@/lib/schemas";

import { chatPreferences } from "@/stores/chatPreferences";

import { speakableText } from "./speakableText";

/**
 * Speak a finished answer, and play what comes back.
 *
 * The sidecar synthesises locally and returns base64 audio, which is played as
 * a Blob. `media-src 'self' blob:` is already in the CSP, so nothing about the
 * policy changes for this — which is the sign the design is right.
 *
 * Spoken **after** the answer is on screen, never instead of it. The written
 * answer carries the regulatory notice and is the authoritative copy; speech is
 * an addition to it. See docs/experiments/voice.md for the open question about
 * that notice not existing in the audio channel.
 *
 * Part of the local voice experiment (branch `experiment/voice`).
 */

export type SpeechState = "idle" | "synthesising" | "playing";

export interface UseSpokenAnswer {
  state: SpeechState;
  /** Why the last attempt failed, for the reader. */
  error: string | null;
  /** Synthesise and play `markdown`. Cleaned up before it is sent. */
  speak: (markdown: string, language: Language) => Promise<void>;
  /** Stop playback and forget any pending request. */
  stop: () => void;
}

export function useSpokenAnswer(): UseSpokenAnswer {
  const [state, setState] = useState<SpeechState>("idle");
  const [error, setError] = useState<string | null>(null);

  const pendingRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  /** Stop the audio and release the object URL. Safe to call repeatedly. */
  const release = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      // Not revoking leaks the whole clip for the lifetime of the window, and
      // these are megabytes each.
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    pendingRef.current = null;
    release();
    setState("idle");
  }, [release]);

  // Leaving the panel must not leave a voice talking to an empty room.
  useEffect(() => release, [release]);

  useEffect(() => {
    const unlisten = onEngineEvent((event) => {
      if (!("request_id" in event) || event.request_id !== pendingRef.current) return;

      if (event.type === "speech") {
        // base64 -> bytes -> Blob. `atob` gives a binary string, and each
        // charCode is one byte.
        const binary = atob(event.audio_b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

        release();
        const url = URL.createObjectURL(new Blob([bytes], { type: event.mime_type }));
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;
        audio.addEventListener("ended", () => {
          release();
          setState("idle");
        });
        audio.play().then(
          () => setState("playing"),
          (cause: unknown) => {
            // Autoplay policy, or no output device. Say so rather than sitting
            // silently in "playing" for ever.
            release();
            setState("idle");
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        );
      } else if (event.type === "error") {
        pendingRef.current = null;
        setState("idle");
        setError(event.message);
      } else if (event.type === "done") {
        pendingRef.current = null;
        // Not idle: `done` closes the *request*, and the audio is still
        // playing. `ended` is what returns this to idle.
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [release]);

  const speak = useCallback(
    async (markdown: string, language: Language) => {
      setError(null);
      // Read at speak time rather than captured in a dependency: changing the
      // setting should affect the next answer without remounting anything.
      const preferences = chatPreferences();
      const text = speakableText(markdown, preferences.spokenLimit);
      if (!text) return;

      const requestId = newRequestId();
      pendingRef.current = requestId;
      setState("synthesising");
      try {
        // Pace and level are applied by the synthesiser, not by the player.
        // `playbackRate` on the element would have been free and needed no
        // protocol field, but it resamples a finished waveform: slowing speech
        // that way lengthens every formant with it, and the result at 0.8x is
        // the drawl that makes people give up on text-to-speech. Piper
        // resynthesises at the requested pace instead, so a slower reading is
        // the same voice speaking more deliberately — which is the entire
        // point for someone trying to catch "trachea" in a second language.
        await speakText({
          request_id: requestId,
          text,
          language,
          speed: preferences.spokenSpeed,
          volume: preferences.spokenVolume,
        });
      } catch (cause) {
        pendingRef.current = null;
        setState("idle");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [],
  );

  return { state, error, speak, stop };
}
