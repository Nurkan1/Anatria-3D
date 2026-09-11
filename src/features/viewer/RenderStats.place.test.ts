import { beforeEach, expect, it } from "vitest";

import { clampToWindow, storedPlace } from "./RenderStats";

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1280;
  window.innerHeight = 800;
});

it("keeps the panel on screen whatever was saved", () => {
  // The case this exists for: a place saved on a large monitor, reopened on a
  // laptop. Restored as written, the panel would be somewhere nobody can reach
  // and the only way back would be clearing site data.
  expect(clampToWindow({ x: 4000, y: 3000 })).toEqual({ x: 1160, y: 680 });
  expect(clampToWindow({ x: -50, y: -50 })).toEqual({ x: 0, y: 0 });
});

it("leaves a sensible place alone", () => {
  expect(clampToWindow({ x: 300, y: 200 })).toEqual({ x: 300, y: 200 });
});

it("reads nothing back when nothing was written", () => {
  expect(storedPlace()).toBeNull();
});

it("refuses a stored value that is not a place", () => {
  // localStorage is a text file a person can edit and an older build may have
  // written something else entirely. A NaN here would position the panel at
  // `left: NaN` and it would simply not appear.
  localStorage.setItem("anatria3d.stats.place.v1", "left,top");
  expect(storedPlace()).toBeNull();
});

it("clamps what it reads, not just what it is given", () => {
  localStorage.setItem("anatria3d.stats.place.v1", "9999,9999");
  expect(storedPlace()).toEqual({ x: 1160, y: 680 });
});
