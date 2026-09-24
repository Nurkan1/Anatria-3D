import { afterEach, describe, expect, it } from "vitest";

import { createLabSound, hz, KIND_CHORD, mappingNote, PROGRESSION, scaleNote } from "./labSound";

describe("the lab's notes", () => {
  it("tunes A4 to 440 Hz", () => {
    expect(hz(69)).toBeCloseTo(440);
    expect(hz(57)).toBeCloseTo(220);
  });

  it("walks the pentatonic scale across octaves, and below its base", () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => scaleNote(s))).toEqual([69, 72, 74, 76, 79, 81]);
    expect(scaleNote(-1)).toBe(67);
  });

  it("climbs as the thread is mapped, from the first memory to the last", () => {
    const notes = Array.from({ length: 40 }, (_, i) => mappingNote(i, 40));
    expect(notes[0]).toBe(69);
    expect(notes.at(-1)).toBe(scaleNote(12));
    notes.slice(1).forEach((note, i) => expect(note).toBeGreaterThanOrEqual(notes[i]!));
    expect(mappingNote(0, 1)).toBe(69);
  });

  it("gives every chord four voices, and every kind of memory a chord of its own", () => {
    for (const chord of PROGRESSION) expect(chord).toHaveLength(4);
    const kinds = Object.values(KIND_CHORD);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("createLabSound", () => {
  const original = (globalThis as { AudioContext?: unknown }).AudioContext;
  afterEach(() => {
    (globalThis as { AudioContext?: unknown }).AudioContext = original;
  });

  it("is silent, not broken, where there is no audio", () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const sound = createLabSound(true);
    expect(() => {
      sound.phase("boot");
      sound.mapped(3, 10);
      sound.select("case");
      sound.erase();
      sound.close();
    }).not.toThrow();
  });

  it("is silent when the audio device refuses to open", () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = function () {
      throw new Error("no device");
    };
    expect(() => createLabSound(true).hover("note")).not.toThrow();
  });
});
