import { describe, expect, it } from "vitest";

import type { CaseDigest, SessionDetail, SessionSummary, StudyNote } from "@/lib/studyDb";

import {
  aiNotice,
  buildCaseDocument,
  buildNotesDocument,
  buildSessionDocument,
  disclaimers,
  hasGeneratedText,
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
  case_id: null,
  visit_no: null,
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
      {
        role: "user",
        content: "How does it fill?",
        created_at: 1_700_000_000_000,
        model: null,
        input_tokens: null,
        output_tokens: null,
      },
      {
        role: "assistant",
        content: "Blood leaves the left ventricle [[left_ventricle]] into the aorta.",
        created_at: 1_700_000_060_000,
        model: "claude-sonnet-5",
        input_tokens: 800,
        output_tokens: 400,
      },
    ],
    structures: ["left_ventricle", "ascending_aorta"],
    ...overrides,
  };
}

/**
 * A case whose complaints point at the arm and whose answer is cardiac — the
 * shape the whole feature exists for. `unknown_structure` is there so the
 * dropping rule has something to drop.
 */
function digest(overrides: Partial<CaseDigest> = {}): CaseDigest {
  return {
    case: {
      id: "c1",
      title: "Chest pain, 58",
      sex: "female",
      age_years: 58,
      height_cm: 164,
      weight_kg: 71.5,
      findings: "BMI 26. BP 158/94. Smoker, 20/day.",
      sealed_at: 1_700_000_000_000,
      revealed_at: null,
      profile: "student",
      language: "es",
      created_at: 1_700_000_000_000,
      updated_at: 1_700_300_000_000,
      visit_count: 3,
    },
    ground_truth: "Inferior myocardial infarction; atypical presentation.",
    visits: [
      {
        session_id: "v1",
        visit_no: 1,
        score: 72,
        verdict: "Read the ischaemia, missed the timing.",
        structures: [],
        created_at: 1_700_000_000_000,
      },
      {
        session_id: "v2",
        visit_no: 2,
        score: 88,
        verdict: "Correct, and correctly prioritised.",
        structures: ["left_ventricle", "unknown_structure"],
        created_at: 1_700_100_000_000,
      },
      {
        session_id: "v3",
        visit_no: 3,
        score: null,
        verdict: null,
        structures: [],
        created_at: 1_700_200_000_000,
      },
    ],
    symptoms: [
      {
        id: 1,
        organ_id: "free_upper_limb_l",
        organ_label: "Left upper limb",
        symptom: "Pain radiating down the arm",
        severity: 7,
        session_id: "v1",
        created_at: 1_700_000_000_000,
      },
      {
        id: 2,
        organ_id: "thorax",
        organ_label: "Thorax",
        symptom: "Breathlessness climbing stairs",
        severity: 4,
        session_id: "v2",
        created_at: 1_700_100_000_000,
      },
    ],
    record_updates: [
      {
        id: 1,
        visit_no: 2,
        body: "Weight down 5 kg. BP 130/85 on the home monitor.",
        created_at: 1_700_150_000_000,
      },
    ],
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

  /**
   * Reported: a printed PDF did not say which model wrote the answers. A page
   * outlives the app that made it, and which model produced an explanation is
   * the single biggest factor in whether it is any good.
   */
  it("prints which model wrote each answer", () => {
    const document = buildSessionDocument(detail(), labelFor);
    expect(document.exchanges[1]!.model).toBe("claude-sonnet-5");
  });

  it("attributes no model to the student's own question", () => {
    expect(buildSessionDocument(detail(), labelFor).exchanges[0]!.model).toBeNull();
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

  /**
   * Under `auto` the answers came back in whatever the student wrote in, which
   * may be a language there is no notice for. The regulatory sentence cannot be
   * translated at runtime — what it says is the product's position, not copy —
   * so the choice is between the fewest lines and the most likely to be read.
   * For this one sentence that is not a close call.
   */
  it("prints every notice it has when the language was left automatic", () => {
    const lines = disclaimers("auto");
    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toContain("Not a medical device");
    expect(lines.some((line) => line.includes("медицинско изделие"))).toBe(true);
    expect(lines.some((line) => line.includes("producto sanitario"))).toBe(true);
  });

  it.each(["auto", "bg", "es", "en"] as const)(
    "always ends with the English notice, whatever %s prints first",
    (language) => {
      expect(disclaimers(language).at(-1)).toContain("Not a medical device");
    },
  );
});

describe("the AI notice", () => {
  const notes: StudyNote[] = [
    {
      id: 1,
      organ_id: null,
      organ_label: null,
      session_id: null,
      body: "Revise the conduction system before Friday.",
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    },
  ];

  it("appears on a page a model wrote part of", () => {
    const document = buildSessionDocument(detail(), labelFor);
    expect(hasGeneratedText(document)).toBe(true);
    expect(aiNotice(document).join(" ")).toMatch(/asistente de IA|AI assistant/);
  });

  it("stays off a notebook of the student's own notes", () => {
    // The whole point of the second half of the notice is to stop the first
    // half certifying that everything unmarked is human-written. With nothing
    // marked there is no such inference to correct, and printing "we do not
    // record where your text came from" beside somebody's own handwriting
    // reads as an accusation rather than a disclosure.
    const document = buildNotesDocument(notes, null, "en");
    expect(hasGeneratedText(document)).toBe(false);
    expect(aiNotice(document)).toEqual([]);
  });

  it("says where its knowledge stops, and never only that a model wrote something", () => {
    // Both halves travel together. A disclosure that omits the limit of what
    // was recorded is worse than none: a supervisor reads it as a guarantee
    // about the notes, which is a claim this application cannot support.
    const document = buildSessionDocument(detail(), labelFor);
    for (const line of aiNotice(document)) {
      expect(line).toMatch(/no registra la procedencia|does not record where|не записва произхода/);
    }
  });

  it("catches a case graded by the assistant, which carries no model field", () => {
    // The verdict is the assistant's assessment of the reader. It is written by
    // a model like any answer, but nothing sits beside it saying so — a check
    // that only walked the exchanges would print a graded case with no notice.
    const document = buildSessionDocument(
      detail({
        session: {
          ...SESSION,
          kind: "case",
          score: 80,
          verdict: "Recognised the infarct pattern; missed the reciprocal changes.",
        },
        messages: [],
      }),
      labelFor,
    );
    expect(document.exchanges).toEqual([]);
    expect(hasGeneratedText(document)).toBe(true);
  });

  it("catches a verdict on a visit inside a printed patient history", () => {
    const page = buildCaseDocument(digest(), new Map(), labelFor);
    expect(hasGeneratedText(page)).toBe(true);
  });

  it("prints the reader's language and English, like the medical notice", () => {
    // A page travels further than the student who printed it.
    const spanish = buildSessionDocument(detail(), labelFor);
    expect(spanish.language).toBe("es");
    const lines = aiNotice(spanish);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("AI assistant");
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

describe("buildCaseDocument", () => {
  it("says on the page that nobody real is on it", () => {
    // A printed sheet travels past the app, the disclaimer at its foot and
    // anyone who knows what this feature is. The first fact under the heading
    // has to answer "whose record is this?" before the reader wonders.
    const page = buildCaseDocument(digest(), new Map(), labelFor);

    expect(page.facts[0]).toEqual({
      label: "Record",
      value: "Simulated case — no real patient",
    });
  });

  it("prints the findings and the sealed answer in different places", () => {
    // The failure that split them apart: one field held both, an author put
    // the facts the reader needs into the sealed half, and the assistant read
    // the seal out loud. Findings go under the heading; the answer at the foot.
    const page = buildCaseDocument(digest(), new Map(), labelFor);

    expect(page.findings).toContain("158/94");
    expect(page.sealedAnswer).toMatch(/myocardial/);
    expect(page.findings).not.toMatch(/myocardial/);
  });

  it("omits the findings block for a case authored before the split", () => {
    const page = buildCaseDocument(
      digest({ case: { ...digest().case, findings: "   " } }),
      new Map(),
      labelFor,
    );

    expect(page.findings).toBeNull();
  });

  it("keeps where a complaint was marked, not where the cause was", () => {
    // The lesson is that the two differ. A page that quietly relabelled the
    // arm pain as cardiac would print the answer and delete the exercise.
    const page = buildCaseDocument(digest(), new Map(), labelFor);

    expect(page.symptoms[0]?.structure).toBe("Left upper limb");
    expect(page.symptoms[0]?.severity).toBe(7);
    expect(page.sealedAnswer).toMatch(/myocardial/);
  });

  it("prints the presentation in the order it developed", () => {
    const page = buildCaseDocument(digest(), new Map(), labelFor);

    expect(page.symptoms.map((entry) => entry.symptom)).toEqual([
      "Pain radiating down the arm",
      "Breathlessness climbing stairs",
    ]);
  });

  it("averages only the visits that were graded", () => {
    const page = buildCaseDocument(digest(), new Map(), labelFor);

    // 72 and 88 were graded; the third visit was not, and counting it as zero
    // would make an unfinished case look like a failed one.
    expect(page.facts).toContainEqual({ label: "Average score", value: "80 / 100" });
  });

  it("keeps a visit whose transcript could not be loaded", () => {
    // Dropping it would renumber the history: visit 3 would print as visit 2
    // and the record would no longer match what the reader did.
    const page = buildCaseDocument(digest(), new Map(), labelFor);

    expect(page.visits.map((visit) => visit.visitNo)).toEqual([1, 2, 3]);
    expect(page.visits[0]?.exchanges).toEqual([]);
    expect(page.visits[0]?.score).toBe(72);
  });

  it("carries each visit's transcript when it is there", () => {
    const page = buildCaseDocument(digest(), new Map([["v1", detail()]]), labelFor);

    expect(page.visits[0]?.exchanges).toHaveLength(2);
    expect(page.visits[0]?.exchanges[1]?.model).toBe("claude-sonnet-5");
  });

  it("lets no structure id reach the page", () => {
    const page = buildCaseDocument(digest(), new Map([["v1", detail()]]), labelFor);
    const printed = JSON.stringify(page);

    expect(printed).not.toContain("left_ventricle");
    expect(printed).not.toContain("ascending_aorta");
    expect(printed).not.toContain("free_upper_limb_l");
  });

  it("names a visit's structures and drops the ones it cannot", () => {
    const page = buildCaseDocument(digest(), new Map(), labelFor);

    // `unknown_structure` has no label, and a reader holding paper has no way
    // to look one up.
    expect(page.visits[1]?.structures).toEqual(["Ventriculus sinister"]);
  });
});

describe("isPrintable", () => {
  it("is false for a page that would be a heading and nothing else", () => {
    expect(isPrintable(buildNotesDocument([], null, "en"))).toBe(false);
  });

  it("is true once there is something on it", () => {
    expect(isPrintable(buildSessionDocument(detail(), labelFor))).toBe(true);
  });

  it("is true for a case that has visits but no transcripts loaded", () => {
    expect(isPrintable(buildCaseDocument(digest(), new Map(), labelFor))).toBe(true);
  });
});
