import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";

import { useScanStore } from "@/stores/scanStore";
import { useSceneStore } from "@/stores/sceneStore";

import { ScanControls } from "./ScanControls";
import { SWEEP_PROGRESS } from "./scanBand";

beforeEach(() => {
  useScanStore.setState({ enabled: true, held: false, pinned: false, at: 0.5 });
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
