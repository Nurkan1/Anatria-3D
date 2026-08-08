import { describe, expect, it } from "vitest";

import type { SessionDetail, SessionSummary, StudyNote } from "@/lib/studyDb";

import {
  buildNotesDocument,
  buildSessionDocument,
  disclaimers,
  isPrintable,
  journalLanguage,
} from "./printDocument";

const SESSION: SessionSummary = {
  id: "s1",
  kind: "tutor",
  title: "The cardiac cycle",
  profile: "student",
  language: "es",
  score: null,
  verdict: null,
  message_count: 2,
  structure_count: 2,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_100_000_000,
};

// Both ids are snake_case, which is what makes the leak test mean something:
// an id like `aorta` is also an ordinary English word, so finding it in a
// sentence would prove nothing about whether an identifier escaped.
const LABELS: Record<string, string> = {
  left_ventricle: "Ventriculus sinister",
  ascending_aorta: "Aorta ascendens",
};

const labelFor = (organId: string) => LABELS[organId] ?? null;

function detail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    session: SESSION,
    messages: [
      { role: "user", content: "How does it fill?", created_at: 1_700_000_000_000 },
      {
        role: "assistant",
        content: "Blood leaves the left ventricle [[left_ventricle]] into the aorta.",
        created_at: 1_700_000_060_000,
      },
    ],
    structures: ["left_ventricle", "ascending_aorta"],
    ...overrides,
  };
}

describe("buildSessionDocument", () => {
  it("never lets an organ_id reach the page", () => {
    // The rule this module exists for. Identifiers are internal, the assistant
    // is forbidden from showing them, and a sheet of paper is the one place
    // nobody can click through to find out what one means.
    const document = buildSessionDocument(detail(), labelFor);
    const printed = JSON.stringify(document);
    expect(printed).not.toContain("left_ventricle");
    expect(printed).not.toContain("ascending_aorta");
    expect(printed).toContain("Ventriculus sinister");
  });

  it("puts no identifier-shaped token in the places a name belongs", () => {
    // Broader than naming the two fixtures: nothing snake_case should reach a
    // heading, a fact or a structure list, whatever the atlas calls things.
    const document = buildSessionDocument(detail(), labelFor);
    const named = [
      document.heading,
      ...document.structures,
      ...document.facts.map((fact) => fact.value),
    ];
    for (const value of named) {
      expect(value).not.toMatch(/[a-z]+_[a-z_]+/);
    }
  });

  it("drops a structure it cannot name rather than printing its id", () => {
    // A system switched off, or an atlas rebuilt since the session. Showing
    // `posterior_segment_of_eyeball` would be noise the reader cannot act on.
    const document = buildSessionDocument(
      detail({ structures: ["left_ventricle", "not_in_this_build"] }),
      labelFor,
    );
    expect(document.structures).toEqual(["Ventriculus sinister"]);
  });

  it("strips the assistant's structure markers from the prose", () => {
    const document = buildSessionDocument(detail(), labelFor);
    const answer = document.exchanges[1]!.body;
    expect(answer).not.toContain("[[");
    // The space before a marker goes with it, so the sentence still reads.
    expect(answer).toContain("the left ventricle into the aorta");
  });

  it("names structures alphabetically, not in storage order", () => {
    const document = buildSessionDocument(detail(), labelFor);
    expect(document.structures).toEqual(["Aorta ascendens", "Ventriculus sinister"]);
  });

  it("carries a graded case's score and verdict", () => {
    const document = buildSessionDocument(
      detail({
        session: {
          ...SESSION,
          kind: "case",
          score: 80,
          verdict: "Recognised the infarct pattern; missed the reciprocal changes.",
        },
      }),
      labelFor,
    );
    expect(document.facts).toContainEqual({ label: "Score", value: "80 / 100" });
    expect(document.verdict).toContain("reciprocal changes");
  });

  it("leaves the score out of an ungraded session rather than printing a blank", () => {
    const document = buildSessionDocument(detail(), labelFor);
    expect(document.facts.map((fact) => fact.label)).not.toContain("Score");
  });

  it("prints in the language the session was answered in", () => {
    // Not the language selected right now: this is a record of a conversation
    // that already happened, and the notice has to match what is on the page.
    const document = buildSessionDocument(detail(), labelFor);
    expect(document.language).toBe("es");
  });
});

describe("buildNotesDocument", () => {
  const notes: StudyNote[] = [
    {
      id: 1,
      organ_id: "left_ventricle",
      organ_label: "Ventriculus sinister",
      session_id: null,
      body: "Thickest wall — systemic pressure.",
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    },
    {
      id: 2,
      organ_id: null,
      organ_label: null,
      session_id: null,
      body: "Revise the conduction system before Friday.",
      created_at: 1_700_000_100_000,
      updated_at: 1_700_000_100_000,
    },
  ];

  it("keeps no organ_id even though the notes carry one", () => {
    const document = buildNotesDocument(notes, null, "en");
    expect(JSON.stringify(document)).not.toContain("left_ventricle");
  });

  it("uses the label stored with the note, which survives the atlas changing", () => {
    const document = buildNotesDocument(notes, null, "en");
    expect(document.notes[0]!.structure).toBe("Ventriculus sinister");
  });

  it("keeps a note that belongs to no structure", () => {
    // Free notes are half of what people actually write down.
    const document = buildNotesDocument(notes, null, "en");
    expect(document.notes[1]!.structure).toBeNull();
    expect(document.notes).toHaveLength(2);
  });

  it("says which structure it is about when one is filtered", () => {
    const document = buildNotesDocument(notes, "Ventriculus sinister", "en");
    expect(document.heading).toBe("Notes on Ventriculus sinister");
  });
});

describe("disclaimers", () => {
  it("prints English alongside the reader's language", () => {
    // A page travels. Whoever picks it up may not read the language the student
    // studies in, and the notice is the part that has to survive that.
    const lines = disclaimers("bg");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Not a medical device");
  });

  it("does not print the English notice twice", () => {
    expect(disclaimers("en")).toHaveLength(1);
  });
});

describe("journalLanguage", () => {
  it("takes the newest session, not the first in the list", () => {
    const older: SessionSummary = { ...SESSION, language: "en", updated_at: 1 };
    const newer: SessionSummary = { ...SESSION, language: "bg", updated_at: 2 };
    expect(journalLanguage([newer, older])).toBe("bg");
    expect(journalLanguage([older, newer])).toBe("bg");
  });

  it("falls back to English with no sessions to go on", () => {
    // Notes carry no language of their own — they are the student's own words.
    expect(journalLanguage([])).toBe("en");
  });
});

describe("isPrintable", () => {
  it("is false for a page that would be a heading and nothing else", () => {
    expect(isPrintable(buildNotesDocument([], null, "en"))).toBe(false);
  });

  it("is true once there is something on it", () => {
    expect(isPrintable(buildSessionDocument(detail(), labelFor))).toBe(true);
  });
});
