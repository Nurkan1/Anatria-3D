import { useEffect, useState } from "react";

import { loadVoices } from "./speech";

/**
 * The voices this machine has, once the platform has enumerated them.
 *
 * Separate from `useSpokenAnswer` because two very different things need the
 * list: the code that speaks, and the settings panel that has to explain why
 * nothing will. Only the former should ever silence the engine, so the
 * enumeration lives here and the side effects stay there.
 *
 * Returns `[]` until the answer arrives, and on a webview built without speech
 * synthesis it stays that way. Callers treat an empty list as "this computer
 * cannot speak this", which is true in both cases.
 */
export function useLocalVoices(): readonly SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<readonly SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const synth =
      typeof window !== "undefined" && "speechSynthesis" in window
        ? window.speechSynthesis
        : null;
    if (!synth) return;

    let live = true;
    void loadVoices(synth).then((found) => {
      if (live) setVoices(found);
    });

    return () => {
      live = false;
    };
  }, []);

  return voices;
}
