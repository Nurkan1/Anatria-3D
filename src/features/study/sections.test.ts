import { describe, expect, it } from "vitest";

import { foldStateFor, SECTIONS, type StudySection } from "./sections";

describe("what the journal folds away at rest", () => {
  it("folds the notes and leaves the work in front of you", () => {
    // Notes are what you go and look up; patients and sessions are the reason
    // the tab is open. The list that costs the most space is the one least
    // likely to be wanted the moment the panel appears.
    const rest = foldStateFor(false);

    expect(rest.notes).toBe(true);
    expect(rest.cases).toBe(false);
    expect(rest.sessions).toBe(false);
  });

  it("has an answer for every section, with none left to fall through", () => {
    // A fourth section arriving and quietly reading as `undefined` would be
    // open by accident rather than by decision.
    for (const section of SECTIONS) {
      expect(typeof foldStateFor(false)[section]).toBe("boolean");
      expect(typeof foldStateFor(true)[section]).toBe("boolean");
    }
  });
});

describe("what a search does to it", () => {
  it("opens everything, because one box narrows all three lists", () => {
    // The failure this prevents: searching a term that only appears in a note,
    // seeing nothing, and concluding it was never written down.
    const searching = foldStateFor(true);

    for (const section of SECTIONS) {
      expect(searching[section]).toBe(false);
    }
  });

  it("hands back a state to apply, not a rule that overrides the reader", () => {
    // Layered as a condition over the toggle, a section would reopen the
    // instant it was closed and the chevron would be describing something
    // other than what is on screen. Each call is a fresh object, so applying
    // it and then toggling cannot write back into the defaults.
    const first = foldStateFor(true);
    first.notes = true;

    expect(foldStateFor(true).notes).toBe(false);
  });

  it("returns to rest when the search is cleared", () => {
    const section: StudySection = "notes";

    expect(foldStateFor(true)[section]).toBe(false);
    expect(foldStateFor(false)[section]).toBe(true);
  });
});
