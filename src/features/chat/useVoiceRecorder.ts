import { useCallback, useEffect, useRef, useState } from "react";

import { VOICE_MAX_SECONDS } from "@/lib/schemas";

/**
 * Microphone capture for the voice experiment (branch `experiment/voice`).
 *
 * Records a short clip and hands back base64 plus the mime type the browser
 * actually produced. It does not talk to the engine — the caller does that —
 * so the recording and the transport stay testable apart.
 *
 * Three things this has to get right:
 *
 * **Degrade, never break.** A machine with no microphone, or a reader who
 * refuses the permission, must land back on the typed interface with a
 * sentence explaining why. A dead button that does nothing is the one outcome
 * worse than no button.
 *
 * **Stop on its own, and say so.** The clip travels as base64 on a single
 * NDJSON line, so length is a transport concern rather than a preference. The
 * cap is displayed, because a microphone that cuts out unannounced reads as a
 * fault.
 *
 * **Release the microphone.** Every exit path stops the tracks. A recording
 * indicator left burning after the reader has moved on is alarming and, on
 * Linux, entirely believable as a bug.
 */

export type RecorderState = "idle" | "recording" | "working" | "unavailable";

export interface VoiceClip {
  audioB64: string;
  mimeType: string;
}

export interface UseVoiceRecorder {
  state: RecorderState;
  /** Why voice is unavailable, or the last failure. Shown to the reader. */
  error: string | null;
  /** Seconds recorded so far, for the countdown against `VOICE_MAX_SECONDS`. */
  elapsed: number;
  start: () => Promise<void>;
  /** Stops and resolves with the clip, or null if nothing usable was captured. */
  stop: () => Promise<VoiceClip | null>;
}

/**
 * Candidate containers, best first.
 *
 * WebKitGTK and WebView2 do not agree here, and neither promises any specific
 * type, so the choice is made by asking rather than assuming. Opus in WebM is
 * preferred because it is compact — a minute of it is a fraction of the WAV
 * the same minute would produce, and every byte is a third larger again once
 * base64 has been applied.
 *
 * The empty string is the deliberate last resort: it means "whatever you
 * would have picked anyway", which is better than refusing to record.
 */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of PREFERRED_TYPES) {
    if (candidate === "") return "";
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

/** Blob -> base64, without the `data:...;base64,` prefix a data URL carries. */
async function toBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Chunked: `String.fromCharCode(...bytes)` on a multi-megabyte clip blows
  // the argument limit and throws, which would look like a recording failure.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useVoiceRecorder(): UseVoiceRecorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Stop the tracks and clear the timer. Safe to call more than once. */
  const release = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Unmounting mid-recording must not leave the microphone open.
  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      // Not "no microphone": the API itself is absent, which means the page is
      // not a secure context. Say *which* fact is missing and what the origin
      // is, because "no microphone was found" sent an hour of debugging after
      // hardware that was never the problem.
      //
      // There is no devtools console in a release build, so this message is
      // the only diagnostic channel a packaged app has. It is worth its length.
      setState("unavailable");
      setError(
        `Recording is unavailable: secureContext=${String(window.isSecureContext)}, ` +
          `origin=${window.location.origin}, ` +
          `mediaDevices=${typeof navigator === "undefined" ? "no navigator" : String(!!navigator.mediaDevices)}, ` +
          `MediaRecorder=${typeof MediaRecorder !== "undefined"}`,
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      // Denied, or no device. Both mean the same thing to the reader: type
      // instead. The distinction is kept in the message, not in the state.
      setState("unavailable");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "The microphone was refused. You can still type your question."
          : "No microphone was found. You can still type your question.",
      );
      return;
    }

    // WebKitGTK can resolve `getUserMedia` with a stream carrying no audio
    // track at all — the silent failure the permission handler in `lib.rs`
    // exists to prevent. Checked anyway: the alternative is a recording that
    // produces nothing and blames the reader for it.
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      setState("unavailable");
      setError("The microphone gave no audio. You can still type your question.");
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
    setElapsed(0);

    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= VOICE_MAX_SECONDS && recorder.state === "recording") {
        // The cap is enforced here rather than trusted to the caller: this is
        // the only place that knows the recording is still running.
        recorder.stop();
      }
    }, 250);
  }, []);

  const stop = useCallback(async (): Promise<VoiceClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return null;

    setState("working");
    const finished = new Promise<void>((resolve) => {
      if (recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
    await finished;
    release();
    recorderRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    const first = chunks[0];
    if (first === undefined) {
      setState("idle");
      return null;
    }

    // `recorder.mimeType` rather than what we asked for: the browser is
    // entitled to pick something else, and the decoder at the far end should
    // be told what it is actually receiving.
    const mimeType = recorder.mimeType || first.type || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      setState("idle");
      return null;
    }

    const audioB64 = await toBase64(blob);
    setState("idle");
    setElapsed(0);
    return { audioB64, mimeType };
  }, [release]);

  return { state, error, elapsed, start, stop };
}
