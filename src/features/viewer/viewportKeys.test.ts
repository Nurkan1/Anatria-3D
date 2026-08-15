import { describe, expect, it } from "vitest";

import { FIT_KEY, VIEW_FOR_KEY, VIEW_LABEL, VIEW_ORDER } from "./cameraViews";
import { isTypingTarget, viewportKey } from "./viewportKeys";

function keyOn(key: string, target: EventTarget | null, over: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, ...over });
  Object.defineProperty(event, "target", { value: target });
  return viewportKey(event);
}

function field(tag: string) {
  return document.createElement(tag);
}

describe("isTypingTarget", () => {
  it("recognises every kind of box the app actually has", () => {
    // The chat composer, the case findings, the record entry, the note editor,
    // the three search fields, the patient picker. Missing one of these is how
    // typing "aorta" turns the body to the anterior view.
    expect(isTypingTarget(field("input"))).toBe(true);
    expect(isTypingTarget(field("textarea"))).toBe(true);
    expect(isTypingTarget(field("select"))).toBe(true);
  });

  it("recognises a contenteditable, which has no tag of its own", () => {
    const editable = field("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });

    expect(isTypingTarget(editable)).toBe(true);
  });

  it("leaves a button alone", () => {
    // Clicking "Fit" and then pressing A must still turn the body. Focus on a
    // control is not focus in a field.
    expect(isTypingTarget(field("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("viewportKey", () => {
  it("hands over a plain letter", () => {
    expect(keyOn("A", field("button"))).toBe("a");
    expect(keyOn("x", null)).toBe("x");
  });

  it("says nothing while the reader is typing", () => {
    expect(keyOn("a", field("textarea"))).toBeNull();
    expect(keyOn("i", field("input"))).toBeNull();
  });

  it("leaves the window's own combinations alone", () => {
    // Ctrl+C is copy, and Ctrl with the zoom keys is the browser's zoom.
    // Taking either would remove something the reader already had.
    expect(keyOn("c", null, { ctrlKey: true })).toBeNull();
    expect(keyOn("c", null, { metaKey: true })).toBeNull();
    expect(keyOn("x", null, { altKey: true })).toBeNull();
  });

  it("lets shift through, because the zoom needs it", () => {
    // There is no `+` without shift on a US keyboard, and a reader holding it
    // out of habit still means the letter they pressed.
    expect(keyOn("A", null, { shiftKey: true })).toBe("a");
    expect(keyOn("+", null, { shiftKey: true })).toBe("+");
  });
});

describe("the viewport's keyboard as a whole", () => {
  /** Every single-letter key the viewport claims, gathered by hand from the
   *  three bars that bind them. The list is the point: it is what makes the
   *  collision test below able to fail. */
  const CLAIMED = [
    ["i", "isolate the selection"],
    ["h", "hide the selection"],
    ["u", "restore everything hidden"],
    ["c", "clear the selection"],
    ["x", "step the exploded view"],
    [FIT_KEY, "frame the view"],
    ...VIEW_ORDER.map((view) => [VIEW_LABEL[view].toLowerCase(), view] as const),
  ] as const;

  it("gives every key exactly one job", () => {
    // Eleven letters now answer inside the viewport. Two bars quietly claiming
    // the same one would not throw: the listener registered second would just
    // also fire, and the body would jump while a structure disappeared.
    const keys = CLAIMED.map(([key]) => key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reaches a viewpoint by the letter printed on its button", () => {
    // Derived from `VIEW_LABEL` rather than written twice, so a button reading
    // "P" cannot end up answering to some other key.
    for (const view of VIEW_ORDER) {
      expect(VIEW_FOR_KEY[VIEW_LABEL[view].toLowerCase()]).toBe(view);
    }
  });

  it("covers every viewpoint and invents none", () => {
    expect(Object.keys(VIEW_FOR_KEY).sort()).toEqual(
      VIEW_ORDER.map((view) => VIEW_LABEL[view].toLowerCase()).sort(),
    );
  });
});
