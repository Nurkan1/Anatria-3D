import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it } from "vitest";

import { useScanStore } from "@/stores/scanStore";
import { useSceneStore } from "@/stores/sceneStore";

import { ScanReadout } from "./ScanReadout";
import { CURRENT_CROSSING, SWEEP_RUNNING } from "./scanCrossing";

beforeEach(() => {
  useSceneStore.setState({ organs: {} });
  useScanStore.setState({ readout: true });
  localStorage.clear();
  SWEEP_RUNNING.value = true;
  CURRENT_CROSSING.value = { organIds: ["pleura"], total: 3 };
});

afterEach(() => {
  SWEEP_RUNNING.value = false;
});

it("hides from the panel and leaves the way back on screen", async () => {
  // The failure this exists for is a panel that goes away with no visible way
  // to bring it back — a control that can only be undone from memory.
  render(<ScanReadout />);
  await waitFor(() => expect(screen.getByText("Crossing now")).toBeTruthy());

  fireEvent.click(screen.getByText("hide"));
  expect(screen.queryByText("Crossing now")).toBeNull();

  const back = screen.getByText("crossing · show");
  fireEvent.click(back);
  await waitFor(() => expect(screen.getByText("Crossing now")).toBeTruthy());
});

it("remembers being hidden, and shows nothing at all once the sweep stops", async () => {
  render(<ScanReadout />);
  await waitFor(() => expect(screen.getByText("Crossing now")).toBeTruthy());
  fireEvent.click(screen.getByText("hide"));
  expect(localStorage.getItem("anatria3d.scan.readout.v1")).toBe("off");

  // The chip belongs to the sweep, not to the screen: with the scanner off
  // there is nothing being crossed, so an offer to name it would be a lie.
  SWEEP_RUNNING.value = false;
  await waitFor(() => expect(screen.queryByText("crossing · show")).toBeNull());
});
