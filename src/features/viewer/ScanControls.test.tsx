import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useScanStore } from "@/stores/scanStore";
import { useSceneStore } from "@/stores/sceneStore";

import { ScanControls } from "./ScanControls";
import { SWEEP_PROGRESS } from "./scanBand";

beforeEach(() => {
  useScanStore.setState({ enabled: true, held: false, pinned: false, at: 0.5, panel: true });
  useSceneStore.setState({ bodyTone: "carbon" });
  SWEEP_PROGRESS.value = 0.25;
});

it("paints the track itself, so the light shows on both engines", () => {
  // The Linux report this exists for: the coloured part of a native range is
  // drawn by `accent-color`, which is present on one of the two engines this
  // ships on and absent on the other. Ours is a gradient with a stop we write,
  // so there is something to see either way.
  render(<ScanControls />);
  const slider = screen.getByLabelText(/drag to hold the light/i) as HTMLInputElement;
  expect(slider.style.getPropertyValue("--scan-fill")).toBe("25%");

  fireEvent.change(slider, { target: { value: "0.8" } });
  expect(slider.style.getPropertyValue("--scan-fill")).toBe("80%");
});

it("does not ask the engine for a vertical range input", () => {
  // `writing-mode: vertical-lr` is what broke it: where it is not implemented
  // the control stays horizontal in a 16px box, with no track and sixteen
  // pixels of travel. The box is vertical; the input is turned.
  render(<ScanControls />);
  const slider = screen.getByLabelText(/drag to hold the light/i);
  expect(slider.style.writingMode).toBe("");
  expect(slider.className).toContain("-rotate-90");
});

it("folds away without stopping the scanner, and leaves the way back", () => {
  // Clearing the palette off the viewport used to mean switching the
  // instrument off, which is the opposite of what somebody wants at the moment
  // they are finally looking at something.
  render(<ScanControls />);
  fireEvent.click(screen.getByText("hide"));

  expect(useScanStore.getState().enabled).toBe(true);
  expect(screen.queryByLabelText(/drag to hold the light/i)).toBeNull();

  const pill = screen.getByText(/light · show/);
  fireEvent.click(pill);
  expect(screen.getByLabelText(/drag to hold the light/i)).toBeTruthy();
});

it("keeps the active colour visible while folded", () => {
  // The one thing worth a pixel when the controls are gone: which colour the
  // light is. Otherwise the pill is an anonymous button.
  useScanStore.setState({ tint: "amber", panel: false });
  const { container } = render(<ScanControls />);
  const dot = container.querySelector('[aria-hidden][style*="background"]');
  expect(dot).not.toBeNull();
});

it("leaves the drag to the engine, and still lets go outside the handle", () => {
  // Reported from Kali, WebKitGTK 2.52.5: capturing the pointer on a native
  // range takes the drag away from it — 0 input events in 173 moves with the
  // capture, 98 in 115 without. So the slider must not capture, and letting go
  // has to reach the store from anywhere, because a 4px control is almost
  // always released somewhere other than on itself.
  const proto = Element.prototype as unknown as {
    setPointerCapture?: ((pointerId: number) => void) | undefined;
  };
  const original = proto.setPointerCapture;
  const capture = vi.fn();
  proto.setPointerCapture = capture;
  try {
    render(<ScanControls />);
    const slider = screen.getByLabelText(/drag to hold the light/i);

    fireEvent.pointerDown(slider, { pointerId: 1 });
    expect(useScanStore.getState().held).toBe(true);
    expect(capture).not.toHaveBeenCalled();

    // Let go over the body, nowhere near the slider.
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(useScanStore.getState().held).toBe(false);
  } finally {
    proto.setPointerCapture = original;
  }
});
