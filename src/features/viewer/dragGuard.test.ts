import { beforeEach, describe, expect, it } from "vitest";

import {
  beginPress,
  DRAG_SLOP,
  pressTravelled,
  resetPress,
  trackPress,
} from "./dragGuard";

beforeEach(resetPress);

/**
 * Orbiting is press, travel, release — and the browser calls the release a
 * click, on whatever is under the pointer when it lands. Turning the body to
 * see the back of the heart finished by selecting a rib, every time.
 */
describe("telling a click from the end of a drag", () => {
  it("lets a still press through", () => {
    beginPress(400, 300);
    trackPress(400, 300);

    expect(pressTravelled()).toBe(false);
  });

  it("forgives a hand that is not perfectly still", () => {
    // A careful click on a small structure drifts a pixel or two, and on a
    // trackpad more. Refusing those would make the atlas feel broken.
    beginPress(400, 300);
    trackPress(402, 301);

    expect(pressTravelled()).toBe(false);
  });

  it("calls a real turn of the body a drag", () => {
    beginPress(400, 300);
    trackPress(460, 340);

    expect(pressTravelled()).toBe(true);
  });

  it("stays a drag once it has been one", () => {
    // The pointer often comes back near where it started — orbiting round and
    // returning. Measuring only the final distance would call that a click.
    beginPress(400, 300);
    trackPress(600, 500);
    trackPress(400, 300);

    expect(pressTravelled()).toBe(true);
  });

  it("survives the release, because the click comes after it", () => {
    // `click` is raised after `pointerup`. Clearing on release would answer
    // "no" to the only question anyone ever asks.
    beginPress(400, 300);
    trackPress(500, 400);

    expect(pressTravelled()).toBe(true);
    expect(pressTravelled()).toBe(true);
  });

  it("starts clean on the next press", () => {
    beginPress(400, 300);
    trackPress(500, 400);
    beginPress(200, 200);

    expect(pressTravelled()).toBe(false);
  });

  it("ignores movement with no button down", () => {
    // Hovering across the whole body must not leave the next click looking
    // like the end of a drag.
    trackPress(10, 10);
    trackPress(900, 700);

    expect(pressTravelled()).toBe(false);
  });

  it("puts the boundary where the constant says", () => {
    beginPress(0, 0);
    trackPress(DRAG_SLOP, 0);
    expect(pressTravelled()).toBe(false);

    trackPress(DRAG_SLOP + 1, 0);
    expect(pressTravelled()).toBe(true);
  });
});
