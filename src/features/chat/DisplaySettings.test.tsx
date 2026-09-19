import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DisplayStatus } from "@/lib/ipc";

import { DisplaySettings } from "./DisplaySettings";

/**
 * The panel has one job beyond the switch: never let the reader believe the
 * window has changed when it has not. The setting applies at the next launch,
 * so the screen must say so until the running window agrees.
 */

const ipc = vi.hoisted(() => ({
  displayStatus: vi.fn(),
  setStableDisplay: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ipc);

const status = (overrides: Partial<DisplayStatus> = {}): DisplayStatus => ({
  supported: true,
  stableDisplay: false,
  active: false,
  ...overrides,
});

beforeEach(() => {
  ipc.displayStatus.mockReset();
  ipc.setStableDisplay.mockReset();
});

describe("DisplaySettings", () => {
  it("is off by default, with nothing pending", async () => {
    ipc.displayStatus.mockResolvedValue(status());
    render(<DisplaySettings />);
    const toggle = await screen.findByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(/next time/)).toBeNull();
  });

  it("stores the choice and says it waits for the next launch", async () => {
    ipc.displayStatus.mockResolvedValue(status());
    ipc.setStableDisplay.mockResolvedValue(status({ stableDisplay: true }));
    render(<DisplaySettings />);
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
    expect(ipc.setStableDisplay).toHaveBeenCalledWith(true);
    expect(screen.getByText(/next time Anatria3D starts/)).toBeTruthy();
  });

  it("stops saying so once the window started with it", async () => {
    ipc.displayStatus.mockResolvedValue(status({ stableDisplay: true, active: true }));
    render(<DisplaySettings />);
    await screen.findByRole("switch");
    expect(screen.queryByText(/next time/)).toBeNull();
  });

  it("says when it could not save, and keeps the old state", async () => {
    ipc.displayStatus.mockResolvedValue(status());
    ipc.setStableDisplay.mockRejectedValue("disk full");
    render(<DisplaySettings />);
    fireEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByText(/could not save/i)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("is not offered where there is no remedy", async () => {
    ipc.displayStatus.mockResolvedValue(status({ supported: false }));
    const { container } = render(<DisplaySettings />);
    await waitFor(() => expect(ipc.displayStatus).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
