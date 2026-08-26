import { useEffect } from "react";

import { useBridgeStore } from "@/stores/bridgeStore";

/**
 * Says, from the header, that something outside this window may be driving it.
 *
 * # Why it is not inside the settings panel
 *
 * The panel is where the bridge is turned on. This is where it is *noticed*.
 * A reader who has forgotten they switched it on, or who left the app running
 * and came back to it, must be able to see that the door is open without
 * opening a drawer to check — otherwise the only way to learn that a program
 * is entitled to move the viewport is to catch it moving.
 *
 * Absent when the bridge is off, rather than shown greyed out. A permanent
 * pill reading "bridge: off" is furniture, and furniture stops being read;
 * something that is only ever there when it matters keeps its meaning.
 *
 * This also owns the one status read the window makes at startup, because it
 * is the piece that is always mounted — the settings drawer is collapsed by
 * default and would answer only for readers who opened it.
 */
export function BridgeIndicator() {
  const running = useBridgeStore((s) => s.status?.running ?? false);
  const refresh = useBridgeStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!running) return null;

  return (
    <span
      className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-sky-300"
      title="The control bridge is on: a paired program on this computer may send view commands to this window. Turn it off in Settings."
    >
      bridge
    </span>
  );
}
