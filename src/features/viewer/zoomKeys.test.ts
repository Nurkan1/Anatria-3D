import { describe, expect, it } from "vitest";

import { zoomKeyFor } from "./cameraViews";

/** Only the two fields the matcher reads, so a case is one line. */
const press = (key: string, code = "") => zoomKeyFor({ key, code });

/**
 * Zooming from the keyboard, on keyboards this cannot see.
 *
 * `+` is a character, not a key, and which key produces it depends on the
 * layout. This ships for Windows and for Linux, to readers typing on Spanish,
 * US and German boards, and there is no way to ask any of them — so the
 * matcher has to accept every honest way of meaning "closer".
 */
describe("zoomKeyFor", () => {
  it("takes the characters themselves, whatever key made them", () => {
    // A Spanish keyboard produces these unshifted; a US one produces `+` with
    // Shift. Reading `key` is what makes both work without naming either.
    expect(press("+")).toBe("in");
    expect(press("-")).toBe("out");
  });

  it("spares a US reader the shift", () => {
    // `=` and `+` are the same physical key there, and someone reaching for
    // the zoom means the same thing whether or not they held Shift.
    expect(press("=")).toBe("in");
    expect(press("_")).toBe("out");
  });

  it("takes the numeric pad, which reports neither character", () => {
    // Those two keys carry the same `code` on every layout, which is why
    // reading position is right here and wrong for the row above.
    expect(press("Add", "NumpadAdd")).toBe("in");
    expect(press("Subtract", "NumpadSubtract")).toBe("out");
  });

  it("ignores the key that merely sits where + does on a US board", () => {
    // The trap this avoids. Matching `code === "Equal"` would zoom on the
    // apostrophe key of a Spanish keyboard, which produces `´`.
    expect(press("´", "Equal")).toBeNull();
    expect(press("'", "Minus")).toBeNull();
  });

  it("stays out of the way of every other key", () => {
    for (const key of ["a", "i", "h", "u", "x", "c", "Enter", "Escape", " ", "1"]) {
      expect(press(key)).toBeNull();
    }
  });
});
