import { useCallback, useState } from "react";
import { readLocal, writeLocal } from "@/lib/localStore";

/**
 * Whether this is the first time this machine has opened Anatria3D.
 *
 * Kept in `localStorage` for the same reason the panel widths are: it must be
 * readable synchronously on the very first render. An async round-trip would
 * either flash the guide open for someone who has already dismissed it, or
 * flash the empty viewport at someone about to see it for the first time.
 *
 * A store that is full, disabled, or wiped fails toward *showing* the guide.
 * Reading it again is a mild annoyance; never seeing it is a student who does
 * not know the app has a right-click menu.
 */

const STORAGE_KEY = "anatria3d.guide.v1";

function hasSeenGuide(): boolean {
  try {
    return readLocal(STORAGE_KEY) === "seen";
  } catch {
    return false;
  }
}

export function useFirstRun() {
  const [seen, setSeen] = useState(hasSeenGuide);

  const markSeen = useCallback(() => {
    setSeen(true);
    try {
      writeLocal(STORAGE_KEY, "seen");
    } catch {
      // Not worth interrupting a session over. The cost is one extra guide.
    }
  }, []);

  return { firstRun: !seen, markSeen };
}
