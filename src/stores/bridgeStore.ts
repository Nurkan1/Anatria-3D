import { create } from "zustand";

import { startBridge, stopBridge, bridgeStatus, type BridgeStatus } from "@/lib/ipc";

/**
 * The control bridge, as the window sees it.
 *
 * A store rather than state inside the settings panel because two places need
 * the same answer: the panel that operates the switch, and the header pill that
 * says the bridge is on. The pill is the point — a program driving this window
 * from outside must be visible from the window, not only from the panel the
 * reader has to open to find out.
 *
 * # Rust is the source of truth, always
 *
 * Nothing here is optimistic. Every mutation replaces the whole status with
 * what the bridge said about itself afterwards, and a failure leaves the
 * previous status untouched. A switch that draws itself as on because the
 * click succeeded, while the pipe never opened, is the failure this avoids —
 * and it is the failure that matters, because the reader would then believe
 * something is listening when nothing is.
 *
 * Nothing is persisted. The bridge is off at every launch by deliberate
 * design: a listening pipe that survives a restart is one the reader did not
 * ask for this time.
 */

interface BridgeStore {
  status: BridgeStatus | null;
  /** What went wrong last, as the reader should read it. */
  error: string | null;
  /** A start or stop is in flight; the switch is disabled meanwhile. */
  busy: boolean;
  refresh: () => Promise<void>;
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
}

/**
 * The status before Rust has answered.
 *
 * `supported: false` so the panel draws its most cautious face for the one
 * frame before the first reply, rather than offering a switch and withdrawing
 * it on a platform that has no bridge.
 */
export const UNKNOWN_BRIDGE: BridgeStatus = {
  supported: false,
  running: false,
  pipe: null,
  accepted: 0,
  refused: 0,
};

export const useBridgeStore = create<BridgeStore>()((set) => ({
  status: null,
  error: null,
  busy: false,

  refresh: async () => {
    try {
      set({ status: await bridgeStatus() });
    } catch (err) {
      // Deliberately does not clear the last known status. A poll that failed
      // says nothing about whether the pipe is open, and blanking the pill
      // would claim it had closed.
      set({ error: String(err) });
    }
  },

  turnOn: async () => {
    set({ busy: true, error: null });
    try {
      set({ status: await startBridge() });
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ busy: false });
    }
  },

  turnOff: async () => {
    set({ busy: true, error: null });
    try {
      set({ status: await stopBridge() });
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ busy: false });
    }
  },
}));
