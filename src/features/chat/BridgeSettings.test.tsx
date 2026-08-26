import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeStatus } from "@/lib/ipc";
import { useBridgeStore } from "@/stores/bridgeStore";

import { BridgeSettings } from "./BridgeSettings";

/**
 * What these cover is the panel's honesty, not its layout.
 *
 * The bridge is the one control in this application that lets something
 * outside the window act on it, so every case here is a variation of the same
 * question: **does the screen agree with what Rust actually did?** A switch
 * that draws itself on after a failed start, or keeps offering a
 * configuration after the bridge is off, is worse than a broken bridge — the
 * reader would believe something is listening when nothing is.
 */

const ipc = vi.hoisted(() => ({
  bridgeStatus: vi.fn(),
  startBridge: vi.fn(),
  stopBridge: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ipc);

function status(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    supported: true,
    running: false,
    pipe: null,
    accepted: 0,
    refused: 0,
    ...overrides,
  };
}

const RUNNING = status({
  running: true,
  pipe: String.raw`\\.\pipe\anatria3d-control-S-1-5-21-9-9-9-1001`,
});

/** The one line the panel exists to hand over. */
const CONFIG = '"ANATRIA3D_BRIDGE": "1"';

beforeEach(() => {
  vi.clearAllMocks();
  useBridgeStore.setState({ status: null, error: null, busy: false });
});

describe("the switch", () => {
  it("offers no switch on a platform with no bridge", async () => {
    ipc.bridgeStatus.mockResolvedValue(status({ supported: false }));
    render(<BridgeSettings />);

    await waitFor(() => {
      expect(screen.getByText(/not in this build/i)).toBeTruthy();
    });
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("starts off, with nothing to paste anywhere", async () => {
    ipc.bridgeStatus.mockResolvedValue(status());
    render(<BridgeSettings />);

    const control = await screen.findByRole("switch");
    expect(control.getAttribute("aria-checked")).toBe("false");
    // Nothing to paste while it is off, and so nothing to copy.
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("hands over the one line to paste once it is on", async () => {
    ipc.bridgeStatus.mockResolvedValue(status());
    ipc.startBridge.mockResolvedValue(RUNNING);
    render(<BridgeSettings />);

    const control = await screen.findByRole("switch");
    await act(async () => {
      fireEvent.click(control);
    });

    expect(await screen.findByText(CONFIG)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("asks for nothing that changes between sessions", async () => {
    // The whole point of dropping the token. If anything here varies per
    // switch-on, the reader is back to editing a config file every time and
    // concluding the feature is broken when it stops working.
    ipc.bridgeStatus.mockResolvedValue(RUNNING);
    render(<BridgeSettings />);

    const line = await screen.findByText(CONFIG);
    expect(line.textContent).not.toMatch(/[0-9a-f]{16}/);
    expect(line.textContent).not.toContain("pipe");
  });

  it("stays off when starting failed, and says why", async () => {
    // The case a reader can actually cause: a second window of the app, which
    // already holds this account's pipe. The sentence matters as much as the
    // state — "Win32 231" would tell them nothing they could act on.
    ipc.bridgeStatus.mockResolvedValue(status());
    ipc.startBridge.mockRejectedValue(
      "another Anatria3D window signed in as you already has the bridge on.",
    );
    render(<BridgeSettings />);

    const control = await screen.findByRole("switch");
    await act(async () => {
      fireEvent.click(control);
    });

    expect(await screen.findByText(/another anatria3d window/i)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("stops offering the configuration when it is turned off", async () => {
    // Nothing here is a credential any more, but a line telling somebody to
    // wire up a bridge that is not listening is still an instruction to do
    // something that will not work.
    ipc.bridgeStatus.mockResolvedValue(RUNNING);
    ipc.stopBridge.mockResolvedValue(status());
    render(<BridgeSettings />);

    expect(await screen.findByText(CONFIG)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });

    await waitFor(() => {
      expect(screen.queryByText(CONFIG)).toBeNull();
    });
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("counts what was refused as well as what was accepted", async () => {
    // A client that is connected and being ignored looks exactly like one that
    // never connected. This line is the only thing that tells them apart.
    ipc.bridgeStatus.mockResolvedValue({ ...RUNNING, accepted: 3, refused: 2 });
    render(<BridgeSettings />);

    expect(await screen.findByText(/3 commands accepted/i)).toBeTruthy();
    expect(screen.getByText(/2 refused/i)).toBeTruthy();
  });

  it("no longer claims the commands go nowhere", async () => {
    // The notice this replaces was true for exactly one commit. Kept as an
    // assertion rather than deleted outright, because a stale warning is the
    // one thing in this panel a reader would believe over the viewport.
    ipc.bridgeStatus.mockResolvedValue(RUNNING);
    render(<BridgeSettings />);

    await screen.findByText(CONFIG);
    expect(screen.queryByText(/nothing reaches the 3D view/i)).toBeNull();
  });
});
