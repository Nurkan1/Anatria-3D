import { stripOrganRefs } from "@/features/chat/organRefs";
import type { FiledMode, Language, UserProfile } from "@/lib/schemas";
import type { CaseDigest, SessionDetail, SessionSummary, StudyNote } from "@/lib/studyDb";

/**
 * Turning the journal into something printable.
 *
 * # What this is, and what it deliberately is not
 *
 * A printed page outlives the app. It gets shared, pinned up, read a year later
 * with no conversation around it. So this **records** — everything here already
 * exists in the journal, and the same journal always produces the same page.
 * Nothing is generated at print time.
 *
 * That rules out the obvious alternative, which was to have the assistant write
 * a summary on demand. A document headed "Educational summary: left ventricle"
 * invites being treated as reference material, costs a model call that can fail
 * halfway, and comes out different every time it is asked for. A transcript of
 * a conversation the student actually had is a different object: it is a record
 * of their work, and it is reproducible.
 *
 * # The rule that this module exists to enforce
 *
 * **No `organ_id` ever reaches the page.** They are internal identifiers, the
 * assistant is forbidden from showing them, and a printout is the one place
 * nobody can click through to find out what one means. Structures are named or
 * they are left out — see `buildSessionDocument`.
 */

export interface PrintNote {
  when: number;
  /** The structure's name, or null for a note not tied to one. Never an id. */
  structure: string | null;
  body: string;
}

export interface PrintExchange {
  role: "user" | "assistant";
  body: string;
  when: number;
  /**
   * Which model wrote this answer.
   *
   * Printed because a page outlives the app that made it. Somebody revising
   * from a printout months later, or a supervisor reading one, is entitled to
   * know that this explanation came from a model — and which one, since that
   * is the single biggest factor in whether it is any good. Null on questions,
   * and on answers written before the journal recorded it.
   */
  model: string | null;
}

/** A label/value pair shown under the heading. */
export interface PrintFact {
  label: string;
  value: string;
}

/**
 * A complaint, as it was marked on the body.
 *
 * `structure` is **where the reader marked it**, not where the cause turned out
 * to be. On paper that distinction has to survive, because the whole record is
 * unreadable without it: "pain, left upper limb" against an answer of inferior
 * myocardial infarction is the reasoning, not a contradiction.
 */
export interface PrintSymptom {
  when: number;
  /** A name, never an id — same rule as everything else on the page. */
  structure: string | null;
  symptom: string;
  /** 0–10, or null when it was not asked. */
  severity: number | null;
}

/**
 * Something learned after the case was opened.
 *
 * Printed as its own list under the findings, in visit order, because that
 * order is the clinical content: a figure that moved between visits is a
 * different case from one that was always there, and a history that flattens
 * them into one paragraph loses exactly that.
 */
export interface PrintRecordUpdate {
  visitNo: number;
  when: number;
  body: string;
}

/** One visit, with what was said and how it was graded. */
export interface PrintVisit {
  visitNo: number;
  when: number;
  score: number | null;
  verdict: string | null;
  structures: string[];
  exchanges: PrintExchange[];
}

/**
 * Everything the printed page shows.
 *
 * Dates are epoch numbers rather than formatted strings: rendering them is the
 * view's job and depends on the reader's locale, which would make this module's
 * tests depend on the machine running them.
 */
export interface PrintDocument {
  heading: string;
  kind: "session" | "notes" | "case";
  facts: PrintFact[];
  /** The assistant's closing assessment of a case drill, if it was graded. */
  verdict: string | null;
  /** Structure names, alphabetical. */
  structures: string[];
  notes: PrintNote[];
  exchanges: PrintExchange[];
  /** The presentation, oldest first. Empty on every document but a case. */
  symptoms: PrintSymptom[];
  /** The visits in order. Empty on every document but a case. */
  visits: PrintVisit[];
  /**
   * Vitals, history and results the case was given.
   *
   * Printed under the heading rather than at the foot beside the sealed
   * answer, because these are not a secret: they are what the reader was told
   * from the start, and a history that omits them cannot be followed.
   */
  findings: string | null;
  /**
   * What was added to the record after the opening, oldest first.
   *
   * Beside `findings` and not merged into it: these were learned later, and
   * the reader's answer at each visit can only be judged against what that
   * visit had been told.
   */
  recordUpdates: PrintRecordUpdate[];
  /**
   * The answer the case was sealed with.
   *
   * On the page because this is the record of a finished case, and a history
   * that omits what it turned out to be cannot be revised from. It is printed
   * under its own heading at the foot, so nobody hands out a case sheet without
   * seeing that the answer is on it.
   */
  sealedAnswer: string | null;
  /** Which language the compliance notice is printed in, besides English. */
  language: Language;
  createdAt: number | null;
  updatedAt: number | null;
  producedAt: number;
}

const KIND_LABEL: Record<FiledMode, string> = {
  tutor: "Tutor session",
  case: "Case drill",
};

const PROFILE_LABEL: Record<UserProfile, string> = {
  layperson: "Layperson",
  student: "Student",
  clinician: "Clinician",
};

const LANGUAGE_LABEL: Record<Language, string> = {
  bg: "Bulgarian",
  es: "Spanish",
  en: "English",
  // Not a language — the reader asked for their own to be followed, and this
  // page cannot know which one that turned out to be.
  auto: "The language asked in",
};

/**
 * The compliance notice, per language.
 *
 * A twin of `_REPORT_DISCLAIMER` in the engine, and deliberately duplicated
 * rather than fetched: this is a fixed string on a page rendered entirely in the
 * webview, and crossing a process boundary for it would put the notice at the
 * mercy of a sidecar that might not be running.
 *
 * It is never paraphrased and never translated at runtime. What it says is the
 * product's regulatory position, not copy.
 */
const DISCLAIMER: Record<Exclude<Language, "auto">, string> = {
  en: "Educational material only. Not a medical device; not for diagnosis or treatment.",
  es:
    "Material educativo únicamente. No es un producto sanitario; " +
    "no sirve para diagnóstico ni tratamiento.",
  bg:
    "Само образователен материал. Не е медицинско изделие; " +
    "не служи за диагноза или лечение.",
};

/**
 * The notice, in the reader's language and in English.
 *
 * English always, whatever else is printed: a page travels, and a supervisor or
 * examiner picking it up may not read the language the student studies in. When
 * that language *is* English the two collapse into one line rather than
 * printing it twice.
 *
 * # Why `auto` prints all three
 *
 * Under `auto` the answers came back in whatever the student wrote in, which
 * may be a language this application has no notice for. There is no
 * `DISCLAIMER.auto` to reach for and translating one at runtime is not
 * available to us — what it says is the product's regulatory position, not
 * copy, and a machine-translated regulatory sentence is not that sentence.
 *
 * So the choice is between printing the fewest lines and printing the most
 * likely to be understood, and for this particular sentence that is not a close
 * call. Three lines at the foot of a page is a cheap price for the notice
 * landing; a notice nobody on the page can read has failed at the only thing it
 * exists to do.
 */
export function disclaimers(language: Language): string[] {
  if (language === "auto") return [DISCLAIMER.bg, DISCLAIMER.es, DISCLAIMER.en];
  return language === "en" ? [DISCLAIMER.en] : [DISCLAIMER[language], DISCLAIMER.en];
}

/**
 * The language to print a set of notes in.
 *
 * Notes carry no language of their own — they are the student's own words, in
 * whatever they were thinking in. The newest session is the best available
 * evidence of what that is, and English is the fallback when there is none.
 */
export function journalLanguage(sessions: SessionSummary[]): Language {
  let newest: SessionSummary | null = null;
  for (const session of sessions) {
    if (!newest || session.updated_at > newest.updated_at) newest = session;
  }
  return newest?.language ?? "en";
}

/**
 * One conversation, as a page.
 *
 * `labelFor` resolves a structure id against the loaded atlas. An id it cannot
 * name is **dropped**, not printed: a reader holding a sheet of paper has no
 * way to look up `posterior_segment_of_eyeball`, so showing it would be noise
 * that also breaks this module's one rule.
 */
export function buildSessionDocument(
  detail: SessionDetail,
  labelFor: (organId: string) => string | null,
  producedAt: number = Date.now(),
): PrintDocument {
  const session = detail.session;

  const facts: PrintFact[] = [
    { label: "Kind", value: KIND_LABEL[session.kind] },
    { label: "Level", value: PROFILE_LABEL[session.profile] },
    { label: "Answered in", value: LANGUAGE_LABEL[session.language] },
  ];
  if (session.kind === "case" && session.score !== null) {
    facts.push({ label: "Score", value: `${session.score} / 100` });
  }

  return {
    heading: session.title,
    kind: "session",
    facts,
    verdict: session.verdict,
    structures: detail.structures
      .map(labelFor)
      .filter((label): label is string => label !== null)
      .sort((a, b) => a.localeCompare(b)),
    notes: [],
    findings: null,
    recordUpdates: [],
    symptoms: [],
    visits: [],
    sealedAnswer: null,
    // The assistant marks structures it names with `[[organ_id]]`, which the
    // chat panel turns into clickable pins. On paper there is nothing to click,
    // so the markers come out — the same strip the copy-to-clipboard path uses.
    exchanges: detail.messages.map((message) => ({
      role: message.role,
      body: stripOrganRefs(message.content),
      when: message.created_at,
      model: message.model,
    })),
    language: session.language,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    producedAt,
  };
}

/**
 * Notes, as a page — either every note or one structure's.
 *
 * The two are the same document with a different heading, because they are the
 * same thing to the reader: what they wrote down, narrowed or not.
 */
export function buildNotesDocument(
  notes: StudyNote[],
  structure: string | null,
  language: Language,
  producedAt: number = Date.now(),
): PrintDocument {
  return {
    heading: structure ? `Notes on ${structure}` : "My notes",
    kind: "notes",
    facts: [{ label: "Notes", value: String(notes.length) }],
    verdict: null,
    structures: [],
    notes: notes.map((note) => ({
      when: note.updated_at,
      // Stored *with* the note rather than looked up, so it survives the atlas
      // changing under it — and it is a name, never an identifier.
      structure: note.organ_label,
      body: note.body,
    })),
    exchanges: [],
    findings: null,
    recordUpdates: [],
    symptoms: [],
    visits: [],
    sealedAnswer: null,
    language,
    createdAt: null,
    updatedAt: null,
    producedAt,
  };
}

/**
 * A whole case, as a page: who the invented patient is, what was marked on
 * them, every visit in order, and the answer it was sealed with.
 *
 * Built from the journal alone, like everything else here — a history that
 * regenerated itself at print time would not be a record.
 *
 * `details` maps a visit's `session_id` to its transcript. A visit with no
 * entry keeps its heading, score and verdict: those live on the visit itself,
 * and dropping the whole visit because its conversation could not be loaded
 * would silently renumber the history.
 */
export function buildCaseDocument(
  digest: CaseDigest,
  details: ReadonlyMap<string, SessionDetail>,
  labelFor: (organId: string) => string | null,
  producedAt: number = Date.now(),
): PrintDocument {
  const record = digest.case;

  const facts: PrintFact[] = [
    // First, and phrased so no reader can mistake the page for a patient
    // record. The page travels further than the app it came from.
    { label: "Record", value: "Simulated case — no real patient" },
    { label: "Sex", value: record.sex === "female" ? "Female" : "Male" },
  ];
  if (record.age_years !== null) facts.push({ label: "Age", value: `${record.age_years}` });
  if (record.height_cm !== null) {
    facts.push({ label: "Height", value: `${record.height_cm} cm` });
  }
  if (record.weight_kg !== null) facts.push({ label: "Weight", value: `${record.weight_kg} kg` });
  facts.push({ label: "Visits", value: `${digest.visits.length}` });
  facts.push({ label: "Level", value: PROFILE_LABEL[record.profile] });
  facts.push({ label: "Answered in", value: LANGUAGE_LABEL[record.language] });

  const graded = digest.visits.filter((visit) => visit.score !== null);
  if (graded.length > 0) {
    const mean =
      graded.reduce((total, visit) => total + (visit.score ?? 0), 0) / graded.length;
    facts.push({ label: "Average score", value: `${Math.round(mean)} / 100` });
  }

  return {
    heading: record.title,
    kind: "case",
    facts,
    verdict: null,
    structures: [],
    notes: [],
    exchanges: [],
    findings: record.findings.trim() === "" ? null : record.findings,
    recordUpdates: digest.record_updates.map((entry) => ({
      visitNo: entry.visit_no,
      when: entry.created_at,
      body: entry.body,
    })),
    symptoms: digest.symptoms.map((symptom) => ({
      when: symptom.created_at,
      // Stored beside the id when it was marked, so it survives the atlas
      // changing and the system it belongs to being switched off.
      structure: symptom.organ_label,
      symptom: symptom.symptom,
      severity: symptom.severity,
    })),
    visits: digest.visits.map((visit) => ({
      visitNo: visit.visit_no,
      when: visit.created_at,
      score: visit.score,
      verdict: visit.verdict,
      structures: visit.structures
        .map(labelFor)
        .filter((label): label is string => label !== null)
        .sort((a, b) => a.localeCompare(b)),
      exchanges: (details.get(visit.session_id)?.messages ?? []).map((message) => ({
        role: message.role,
        body: stripOrganRefs(message.content),
        when: message.created_at,
        model: message.model,
      })),
    })),
    sealedAnswer: digest.ground_truth,
    language: record.language,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    producedAt,
  };
}

/** Whether there is anything on the page besides its own heading. */
export function isPrintable(document: PrintDocument): boolean {
  return (
    document.notes.length > 0 ||
    document.exchanges.length > 0 ||
    document.visits.length > 0 ||
    document.symptoms.length > 0 ||
    // A case can be caught up on before it is ever asked about, and a page
    // holding a history is worth printing whether or not anyone has answered.
    document.recordUpdates.length > 0
  );
}
