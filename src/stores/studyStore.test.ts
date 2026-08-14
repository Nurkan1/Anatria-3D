import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportSummary, SessionSummary, StudyNote, StudyStats } from "@/lib/studyDb";

vi.mock("@/lib/studyDb", () => ({
  listStudySessions: vi.fn(),
  listNotes: vi.fn(),
  studyStats: vi.fn(),
  saveStudyTurn: vi.fn(),
  recordCaseResult: vi.fn(),
  renameStudySession: vi.fn(),
  deleteStudySession: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  getStudySession: vi.fn(),
  exportJournal: vi.fn(),
  importJournal: vi.fn(),
  // Reached through the case store, which a restore also has to reload.
  listCases: vi.fn(),
  caseDigest: vi.fn(),
  MAX_VISITS: 20,
}));

const db = vi.mocked(await import("@/lib/studyDb"));
const { useStudyStore, describeImport } = await import("./studyStore");
const { useCaseStore } = await import("./caseStore");

const merge = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  sessions_added: 0,
  sessions_updated: 0,
  notes_added: 0,
  notes_updated: 0,
  cases_added: 0,
  skipped: 0,
  ...over,
});

const store = () => useStudyStore.getState();

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
  structure_count: 1,
  created_at: 1,
  updated_at: 2,
};

const NOTE: StudyNote = {
  id: 1,
  organ_id: "left_ventricle",
  organ_label: "Ventriculus sinister",
  session_id: "s1",
  body: "Wall ~10 mm",
  created_at: 1,
  updated_at: 1,
};

const STATS: StudyStats = {
  sessions: 1,
  cases: 0,
  graded_cases: 0,
  notes: 1,
  average_score: null,
};

const TURN = {
  session_id: "s1",
  kind: "tutor" as const,
  title: "The cardiac cycle",
  profile: "student" as const,
  language: "es" as const,
  question: "How does it work?",
  answer: "Like this.",
  organ_ids: ["left_ventricle"],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listCases.mockResolvedValue([]);
  db.caseDigest.mockResolvedValue(null);
  db.listStudySessions.mockResolvedValue([SESSION]);
  db.listNotes.mockResolvedValue([NOTE]);
  db.studyStats.mockResolvedValue(STATS);
  db.saveStudyTurn.mockResolvedValue(undefined);
  db.createNote.mockResolvedValue(NOTE);
  useStudyStore.setState({
    sessions: [],
    notes: [],
    stats: null,
    query: "",
    organFilter: null,
    organFilterLabel: null,
    error: null,
    transfer: null,
    loaded: false,
  });
});

describe("studyStore", () => {
  it("loads the three lists together", async () => {
    await store().refresh();

    expect(store().sessions).toEqual([SESSION]);
    expect(store().notes).toEqual([NOTE]);
    expect(store().stats).toEqual(STATS);
    expect(store().loaded).toBe(true);
  });

  it("passes the filters through to the query, not to a client-side scan", async () => {
    // Filtering in SQLite is what keeps the panel usable once a student has a
    // year of notes; re-implementing it in JS would quietly diverge from the
    // stored search.
    await store().setQuery("  myocardium  ");
    await store().setOrganFilter("aorta", "Aorta");

    // Both filters reach both lists: narrowing to a structure and then
    // searching within it is the natural follow-up question.
    expect(db.listStudySessions).toHaveBeenLastCalledWith("myocardium", "aorta", null);
    expect(db.listNotes).toHaveBeenLastCalledWith("aorta", "myocardium");
  });

  it("treats an empty search as no filter", async () => {
    await store().setQuery("   ");

    expect(db.listStudySessions).toHaveBeenLastCalledWith(null, null, null);
  });

  it("keeps the structure's name beside its id", async () => {
    // The panel has to name what it is filtered to, and that structure's
    // system may well be switched off — there is nothing to look the name up
    // in at that point.
    await store().setOrganFilter("aorta", "Aorta");
    expect(store().organFilterLabel).toBe("Aorta");

    await store().setOrganFilter(null);
    expect(store().organFilterLabel).toBeNull();
  });

  it("reloads after a write, so counts and ordering stay true", async () => {
    await store().saveTurn(TURN);

    expect(db.saveStudyTurn).toHaveBeenCalledWith(TURN);
    expect(store().sessions).toEqual([SESSION]);
  });

  it("reports a failed write instead of throwing it at the caller", async () => {
    // The chat panel calls `saveTurn` from an engine event handler. A rejection
    // escaping into that path would take the answer down with the journal.
    // `false` is what stops the case grade being attempted against a session
    // row that was never written.
    db.saveStudyTurn.mockRejectedValue(new Error("database is locked"));

    await expect(store().saveTurn(TURN)).resolves.toBe(false);
    expect(store().error).toBe("database is locked");
  });

  it("reports a successful write", async () => {
    await expect(store().saveTurn(TURN)).resolves.toBe(true);
  });

  it("survives a journal that will not open at all", async () => {
    db.listStudySessions.mockRejectedValue(new Error("unable to open database file"));

    await store().refresh();

    expect(store().error).toContain("unable to open");
    // `loaded` still flips, or the panel sits on "loading…" for ever.
    expect(store().loaded).toBe(true);
  });

  it("does not reload after a failed write", async () => {
    db.createNote.mockRejectedValue(new Error("disk full"));

    await store().addNote({
      organ_id: null,
      organ_label: null,
      session_id: null,
      body: "x",
    });

    expect(db.listStudySessions).not.toHaveBeenCalled();
  });

  it("says nothing when an export dialog is cancelled", async () => {
    // `null` is a cancelled file picker, not a failure. Announcing it would
    // teach the reader to distrust the message that does matter.
    db.exportJournal.mockResolvedValue(null);
    await store().exportJournal();

    expect(store().transfer).toBeNull();
    expect(store().error).toBeNull();
  });

  it("reports where an export landed", async () => {
    db.exportJournal.mockResolvedValue("D:/notes/anatria-journal.json");
    await store().exportJournal();

    expect(store().transfer).toContain("anatria-journal.json");
  });

  it("reloads after an import, so the merged rows appear", async () => {
    db.importJournal.mockResolvedValue(merge({ notes_added: 3 }));
    await store().importJournal();

    expect(db.listNotes).toHaveBeenCalled();
    expect(store().notes).toEqual([NOTE]);
  });

  it("reloads the patients too, not only the sessions", async () => {
    // A restore writes into both stores. Reloading one left the patient picker
    // and the virtual-patient list showing what was there before the import
    // until the app was restarted — which reads exactly like a restore that
    // did nothing, and is how this was reported.
    db.importJournal.mockResolvedValue(merge({ cases_added: 2 }));

    await store().importJournal();

    expect(db.listCases).toHaveBeenCalled();
    expect(useCaseStore.getState().loaded).toBe(true);
  });

  it("does not reload when the import dialog is cancelled", async () => {
    db.importJournal.mockResolvedValue(null);
    await store().importJournal();

    expect(db.listNotes).not.toHaveBeenCalled();
    expect(db.listCases).not.toHaveBeenCalled();
    expect(store().transfer).toBeNull();
  });

  it("surfaces a rejected file as an error, not as a merge report", async () => {
    db.importJournal.mockRejectedValue(
      new Error("That file is not an Anatria3D study journal."),
    );
    await store().importJournal();

    expect(store().error).toContain("not an Anatria3D study journal");
    expect(store().transfer).toBeNull();
  });

  it("clears a stale error once the next write succeeds", async () => {
    useStudyStore.setState({ error: "database is locked" });

    await store().addNote({
      organ_id: null,
      organ_label: null,
      session_id: null,
      body: "x",
    });

    expect(store().error).toBeNull();
  });
});

describe("describeImport", () => {
  it("spells out a repeat import instead of going quiet", () => {
    // The most likely outcome of a double-click, and the one where silence
    // reads as a failure.
    expect(describeImport(merge({ skipped: 12 }))).toBe(
      "Nothing new — that journal is already here.",
    );
  });

  it("counts what arrived", () => {
    const text = describeImport(merge({ sessions_added: 2, notes_added: 5 }));
    expect(text).toContain("2 sessions");
    expect(text).toContain("5 notes");
  });

  it("mentions updates and leftovers separately from additions", () => {
    const text = describeImport(
      merge({ notes_added: 1, notes_updated: 2, sessions_updated: 1, skipped: 4 }),
    );
    expect(text).toContain("1 notes");
    expect(text).toContain("updated 3");
    expect(text).toContain("4 already here");
  });

  it("still reports a merge that only updated things", () => {
    expect(describeImport(merge({ notes_updated: 2 }))).toContain("updated 2");
  });

  it("counts restored patients, which it silently did not", () => {
    // The failure that made a working restore look like a broken one: the
    // journal wrote 26 patients, this looked at sessions and notes alone, and
    // told the reader their backup was empty.
    const text = describeImport(merge({ cases_added: 26 }));

    expect(text).toContain("26 patients");
    expect(text).not.toContain("Nothing new");
  });

  it("says patient, not patients, for one", () => {
    expect(describeImport(merge({ cases_added: 1 }))).toContain("1 patient");
  });

  it("still calls a genuine repeat import a no-op", () => {
    // The other direction, and the one this must not break: restoring the
    // same file twice has to stay visibly nothing.
    expect(describeImport(merge({ skipped: 26 }))).toBe(
      "Nothing new — that journal is already here.",
    );
  });
});

describe("narrowing to one virtual patient", () => {
  it("composes with the structure and text filters rather than replacing them", async () => {
    // Three filters, one query. "What did we cover about the aorta with this
    // patient" is a question the reader can actually ask.
    useStudyStore.setState({ query: "myocardium", organFilter: "aorta" });

    await store().setCaseFilter("c1");

    expect(db.listStudySessions).toHaveBeenLastCalledWith("myocardium", "aorta", "c1");
    expect(store().caseFilter).toBe("c1");
  });

  it("clears back to the whole journal", async () => {
    useStudyStore.setState({ caseFilter: "c1" });

    await store().setCaseFilter(null);

    expect(db.listStudySessions).toHaveBeenLastCalledWith(null, null, null);
    expect(store().caseFilter).toBeNull();
  });
});
