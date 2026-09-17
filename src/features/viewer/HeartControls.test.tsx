import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";
import { useHeartStore } from "@/stores/heartStore";
import { useSceneStore } from "@/stores/sceneStore";

import { HeartControls } from "./HeartControls";

const LEFT_VENTRICLE = {
  organ_id: "left_ventricle",
  ta2_latin: "Ventriculus sinister",
  name_en: "Left ventricle",
  system: "cardiovascular",
  mesh_file: "cardiovascular_male.glb",
  node: "Left ventricle",
  path: ["Heart"],
} as unknown as ManifestOrgan;

beforeEach(() => {
  useHeartStore.setState({ enabled: false, sound: false });
  useSceneStore.setState({ organs: { left_ventricle: LEFT_VENTRICLE }, hiddenSystems: [] });
});

it("starts the heartbeat, and says on its face that it is an illustration", () => {
  render(<HeartControls />);
  fireEvent.click(screen.getByRole("button", { name: "Heartbeat" }));

  expect(useHeartStore.getState().enabled).toBe(true);
  expect(screen.getByText(/illustrative/i)).toBeTruthy();
});

it("keeps the heart sounds off until they are ticked", () => {
  useHeartStore.setState({ enabled: true });
  render(<HeartControls />);
  const sound = screen.getByLabelText(/heart sounds/i) as HTMLInputElement;
  expect(sound.checked).toBe(false);

  fireEvent.click(sound);

  expect(useHeartStore.getState().sound).toBe(true);
});

it("says why nothing moves when the cardiovascular system is off", () => {
  useHeartStore.setState({ enabled: true });
  useSceneStore.setState({ hiddenSystems: ["cardiovascular"] });
  render(<HeartControls />);
  expect(screen.getByText(/switch the cardiovascular system on/i)).toBeTruthy();
});

it("cannot be started on a body with no heart", () => {
  useSceneStore.setState({ organs: {} });
  render(<HeartControls />);
  const button = screen.getByRole("button", { name: "Heartbeat" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});
