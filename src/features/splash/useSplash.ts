import { useEffect, useRef, useState } from "react";

/**
 * How long the opening screen stays, and when it gets out of the way.
 *
 * Kept apart from the visuals because the timing is the part with rules, and
 * two of them are not obvious:
 *
 * **A minimum.** The atlas often loads in under a tenth of a second from a warm
 * cache. A splash that appears and vanishes in that time reads as a glitch, not
 * as an opening — worse than having none.
 *
 * **A ceiling.** If the manifest never arrives — a corrupt install, a missing
 * asset — the reader must not be left staring at a logo with no way forward.
 * The screen leaves regardless, and whatever error the viewer has to show gets
 * its turn.
 */

/** Below this a splash is a flicker rather than an opening. */
export const MINIMUM_MS = 900;

/** Never trap the reader behind it, however badly loading goes. */
export const CEILING_MS = 12_000;

/** Matches the CSS transition on the way out. */
export const FADE_MS = 420;

export type SplashPhase = "showing" | "leaving" | "gone";

export function useSplash(ready: boolean): { visible: boolean; leaving: boolean } {
  const [phase, setPhase] = useState<SplashPhase>("showing");
  const openedAt = useRef(Date.now());

  useEffect(() => {
    if (phase !== "showing") return;

    // Whichever comes first: the atlas is ready and the minimum has been
    // served, or the ceiling runs out.
    const remaining = Math.max(MINIMUM_MS - (Date.now() - openedAt.current), 0);
    const delay = ready ? remaining : CEILING_MS - (Date.now() - openedAt.current);

    const timer = setTimeout(() => setPhase("leaving"), Math.max(delay, 0));
    return () => clearTimeout(timer);
  }, [ready, phase]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return { visible: phase !== "gone", leaving: phase === "leaving" };
}
