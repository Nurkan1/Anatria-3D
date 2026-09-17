import { beforeEach, expect, it } from "vitest";

import { useHeartStore } from "./heartStore";

beforeEach(() => {
  useHeartStore.setState({ enabled: false, sound: false, rhythm: "normal" });
  localStorage.clear();
});

it("starts still, like every mode that moves the picture", () => {
  expect(useHeartStore.getState().enabled).toBe(false);
});

it("switches on and off", () => {
  useHeartStore.getState().toggle();
  expect(useHeartStore.getState().enabled).toBe(true);
  useHeartStore.getState().toggle();
  expect(useHeartStore.getState().enabled).toBe(false);
});

it("is silent until sound is asked for", () => {
  expect(useHeartStore.getState().sound).toBe(false);
});

it("remembers the sound being turned on, and off again", () => {
  useHeartStore.getState().setSound(true);
  expect(localStorage.getItem("anatria3d.heart.sound.v1")).toBe("on");
  useHeartStore.getState().setSound(false);
  expect(localStorage.getItem("anatria3d.heart.sound.v1")).toBe("off");
});

it("writes nothing when the sound setting has not changed", () => {
  useHeartStore.getState().setSound(false);
  expect(localStorage.getItem("anatria3d.heart.sound.v1")).toBeNull();
});

it("starts on a normal rhythm, and shows the one chosen", () => {
  expect(useHeartStore.getState().rhythm).toBe("normal");
  useHeartStore.getState().setRhythm("atrial_fibrillation");
  expect(useHeartStore.getState().rhythm).toBe("atrial_fibrillation");
});
