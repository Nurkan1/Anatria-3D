import { useState } from "react";

import type { Language, UserProfile } from "@/lib/schemas";
import { whenLabel } from "@/features/study/whenLabel";
import { getStudySession, type CaseFile, type CaseSex } from "@/lib/studyDb";
import {
  activeCase,
  FILTER_PATIENTS_FROM,
  isFull,
  matchesQuery,
  reviewMaySeeTheAnswer,
  useCaseStore,
  visitLabel,
} from "@/stores/caseStore";
import { useChatStore } from "@/stores/chatStore";
import { askToConfirm } from "@/stores/confirmStore";
import { useSceneStore } from "@/stores/sceneStore";

/**
 * Which virtual patient the next drill belongs to.
 *
 * Shown only in case mode, and never as a setting. A switch labelled
 * "simulation" would imply an off position in which this is not one — the
 * choice here is *which* invented patient, or none, which is the same shape as
 * the investigation picker it is modelled on.
 *
 * "Virtual patient" and not "digital twin": a twin is a model of a real entity
 * kept in step with data from it, and under MDR the intended purpose is decided
 * by what the manufacturer says it is. Nobody here is real.
 */
export function CaseBar({ profile, language }: { profile: UserProfile; language: Language }) {
  const cases = useCaseStore((s) => s.cases);
  const current = useCaseStore(activeCase);
  const select = useCaseStore((s) => s.select);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState("");
  const [showRecord, setShowRecord] = useState(false);
  /**
   * Whether the record composer is open, held here rather than inside it.
   *
   * It used to live behind the expander, and that was a mistake with a cost:
   * the reader never saw it, typed "weight down 5 kg" into the chat instead —
   * which is the natural gesture — and the assistant went on answering from
   * the opening findings, correctly and uselessly. A control nobody can find
   * is a feature nobody has.
   */
  const [writingRecord, setWritingRecord] = useState(false);

  const open = cases.filter((entry) => !isFull(entry));
  // The box only earns its place once the list is longer than the box. Below
  // that it is chrome in front of something the reader can already read.
  const searchable = open.length >= FILTER_PATIENTS_FROM;
  const shown = searchable ? open.filter((entry) => matchesQuery(entry, filter)) : open;

  if (composing) {
    return (
      <CaseComposer
        profile={profile}
        language={language}
        onClose={() => setComposing(false)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 px-3 py-1.5 text-[10px]">
      {current ? (
        <>
          <button
            type="button"
            onClick={() => setShowRecord(!showRecord)}
            aria-expanded={showRecord}
            title={showRecord ? "Hide the record" : "Show this patient's record"}
            className="flex min-w-0 items-center gap-1.5"
          >
            <span className="truncate rounded-full bg-sky-600/15 px-1.5 py-0.5 text-sky-300">
              {current.title}
            </span>
            <span className="shrink-0 text-slate-500">
              {current.sex === "female" ? "female" : "male"}
              {current.age_years !== null && `, ${current.age_years}`} ·{" "}
              {visitLabel(current)}
            </span>
            <span className="shrink-0 text-slate-500">{showRecord ? "▴" : "▾"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowRecord(true);
              setWritingRecord(true);
            }}
            title="Add what is known now — a weight, a pressure, what the imaging said"
            className="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 transition hover:border-sky-600 hover:text-sky-200"
          >
            + record
          </button>
          <button
            type="button"
            onClick={() => select(null)}
            title="Stop filing drills against this patient. Nothing is deleted."
            className="rounded px-1 text-slate-500 transition hover:text-slate-200"
          >
            leave
          </button>
          {showRecord && (
            <PatientRecord
              patient={current}
              writing={writingRecord}
              onWritingChange={setWritingRecord}
            />
          )}
        </>
      ) : (
        <>
          <span className="text-slate-500">One-off drill</span>
          {searchable && (
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Find a patient…"
              className="w-28 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-300 outline-none placeholder:text-slate-600 focus:border-sky-600"
            />
          )}
          {open.length > 0 && (
            <select
              value=""
              onChange={(event) => event.target.value && select(event.target.value)}
              className="min-w-0 max-w-[11rem] rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-300 outline-none focus:border-sky-600"
            >
              <option value="">
                {shown.length === 0 ? "No patient matches" : "Continue a patient…"}
              </option>
              {shown.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title} — {visitLabel(entry)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
          >
            New patient
          </button>
        </>
      )}
    </div>
  );
}

/**
 * How much of the panel the open record may take before it scrolls itself.
 *
 * Half, deliberately. The record is reference material and the transcript is
 * the conversation, and a reader answering a case is going between the two —
 * giving either one the whole panel makes the other useless. Below this the
 * record scrolls and the transcript keeps the rest.
 *
 * Exported so a test can hold on to it: in jsdom a layout has no observable
 * behaviour, and the regression this guards against is precisely the *absence*
 * of these two rules.
 */
export const RECORD_MAX_HEIGHT = "max-h-[50vh]";

/**
 * The patient's record, where the work is happening.
 *
 * Not in the Study tab and not over the 3D canvas: this is what a reader wants
 * *while* answering a case, and the atlas gains no interface for it. The whole
 * thing collapses back to the chip, and the chip is what says which patient is
 * open at all.
 *
 * **The sealed answer is not here, and cannot be** — the store is never handed
 * it. A panel cannot leak a value it was never given, which is a stronger
 * guarantee than remembering to filter it at every render.
 */
function PatientRecord({
  patient,
  writing,
  onWritingChange,
}: {
  patient: CaseFile;
  writing: boolean;
  onWritingChange: (writing: boolean) => void;
}) {
  const symptoms = useCaseStore((s) => s.symptoms);
  const visits = useCaseStore((s) => s.visits);
  const record = useCaseStore((s) => s.record);
  const unnote = useCaseStore((s) => s.unnote);
  const revealAnswer = useCaseStore((s) => s.reveal);
  const [answer, setAnswer] = useState<string | null>(null);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const setHovered = useSceneStore((s) => s.setHovered);
  const selectMany = useSceneStore((s) => s.selectMany);
  const loadSession = useChatStore((s) => s.loadSession);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const beginSession = useChatStore((s) => s.beginSession);

  /** True while any visit is ungraded — see `reviewMaySeeTheAnswer`. */
  // The patient's stamp belongs in here, not only in what is sent to the
  // engine. Left out of this one call site, the button went on offering
  // "· answer stays sealed" on a case whose answer was open on the screen
  // directly above it — the label saying one thing while the behaviour did
  // another, which is worse than either being wrong on its own.
  const open = !reviewMaySeeTheAnswer(visits, patient.revealed_at);

  /**
   * A review starts its own conversation.
   *
   * Not a continuation of the visit it was launched from: that transcript is
   * the work being summarised, and re-sending it would both cost the reader for
   * every word twice and let the summary quote itself.
   */
  function startReview() {
    beginSession("review");
  }

  /**
   * Open the seal, once, on purpose.
   *
   * The confirmation is the whole mechanism. Everything else here is one
   * click from everything else, and an answer the reader wrote weeks ago is
   * exactly the thing they should not be able to uncover by misclicking a row.
   */
  async function unsealAnswer() {
    const confirmed = await askToConfirm({
      title: "Open the sealed answer?",
      subject: patient.title,
      body:
        "This shows what you wrote when the case was opened, before anything " +
        "had been attempted. It is recorded: from now on this case reads as " +
        "opened, and a review of it may use the answer and the written " +
        "verdicts. Nothing is deleted, and the answer itself cannot be edited.",
      confirmLabel: "Show me the answer",
    });
    if (confirmed) setAnswer(await revealAnswer(patient.id));
  }

  /** Already opened; reading it again asks nobody anything. */
  async function showAnswer() {
    setAnswer(await revealAnswer(patient.id));
  }

  /**
   * Open a past visit, anatomy and all.
   *
   * The same move the session list makes, because it is the same act: a
   * transcript without the structures it was about is half the visit, and the
   * reader would be reading answers against a viewport showing something else.
   */
  async function reopen(sessionId: string) {
    try {
      const detail = await getStudySession(sessionId);
      if (!detail) return;
      loadSession(detail);
      selectMany(detail.structures);
    } catch {
      useCaseStore.setState({ error: "Could not reopen that visit." });
    }
  }

  const measurements = [
    patient.age_years !== null && `${patient.age_years} years`,
    patient.height_cm !== null && `${patient.height_cm} cm`,
    patient.weight_kg !== null && `${patient.weight_kg} kg`,
  ].filter((entry): entry is string => typeof entry === "string");

  return (
    /*
      Bounded, and scrolls itself.

      Everything in here is written by somebody and none of it has a length:
      the record grows a paragraph per visit, the visit list grows a row per
      drill, and the sealed answer is whatever the reader typed — a worked
      differential runs to a screen on its own.

      Unbounded, this panel won every argument for space. It sits in a flex
      column above the transcript, which yields (`min-h-0 flex-1`), so a long
      case pushed the conversation down to nothing and then ran off the bottom
      of the window. The end of the answer was not clipped by a scroll container
      — there wasn't one — it was outside the panel entirely, and scrolling
      anything on screen did not reach it.
    */
    <div
      className={`mt-1.5 w-full shrink-0 space-y-2 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-2 ${RECORD_MAX_HEIGHT}`}
    >
      {measurements.length > 0 && (
        <p className="text-slate-500">{measurements.join(" · ")}</p>
      )}

      {(patient.findings.trim() !== "" || record.length > 0) && (
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
            On the record
          </p>
          {patient.findings.trim() !== "" && (
            <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-slate-400">
              {patient.findings}
            </p>
          )}
          {/*
            Stamped with the visit each was learned at, because that ordering
            is the clinical content: a weight that came down over four visits
            is a different case from one that was always low.
          */}
          {record.map((entry) => (
            <div key={entry.id} className="group mt-1 flex items-baseline gap-1.5">
              <span className="shrink-0 tabular-nums text-slate-600">
                Visit {entry.visit_no}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed text-slate-400">
                {entry.body}
              </span>
              <button
                type="button"
                onClick={() => void unnote(entry.id)}
                title="Remove this entry"
                className="shrink-0 opacity-0 transition group-hover:opacity-100 hover:text-rose-300"
              >
                ×
              </button>
            </div>
          ))}
          <RecordComposer open={writing} onOpenChange={onWritingChange} />
        </div>
      )}

      {patient.findings.trim() === "" && record.length === 0 && (
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
            On the record
          </p>
          <p className="mt-0.5 leading-snug text-slate-600">
            Nothing on the record. This case was opened before findings had a
            place to go — write what is known and the assistant can reason from
            it.
          </p>
          <RecordComposer open={writing} onOpenChange={onWritingChange} />
        </div>
      )}

      {symptoms.length > 0 && (
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
            Marked on the body
          </p>
          <div className="mt-0.5 space-y-0.5">
            {symptoms.map((entry) => (
              <button
                key={entry.id}
                type="button"
                // Where it was marked, so flying there is flying to what the
                // reader pointed at — not to whatever is causing it.
                onMouseEnter={() => setHovered(entry.organ_id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() =>
                  applyCommand({ action: "focus_organ", organ_id: entry.organ_id })
                }
                className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-slate-800/60"
              >
                <span className="min-w-0 flex-1 truncate text-amber-300/90">
                  {entry.symptom}
                </span>
                {entry.organ_label && (
                  <span className="shrink-0 truncate italic text-slate-500">
                    {entry.organ_label}
                  </span>
                )}
                {entry.severity !== null && (
                  <span className="shrink-0 tabular-nums text-slate-600">
                    {entry.severity}/10
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {visits.length > 0 && (
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
            Visits
          </p>
          <div className="mt-0.5 space-y-0.5">
            {visits.map((visit) => (
              <button
                key={visit.session_id}
                type="button"
                disabled={visit.session_id === currentSessionId}
                onClick={() => void reopen(visit.session_id)}
                // The written judgement is long and belongs on the printed
                // history; here it is what the row is worth hovering for.
                title={
                  visit.session_id === currentSessionId
                    ? "You are in this visit"
                    : (visit.verdict ?? "Reopen this visit")
                }
                className={`flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left transition ${
                  visit.session_id === currentSessionId
                    ? "bg-sky-600/10 text-sky-300"
                    : "hover:bg-slate-800/60"
                }`}
              >
                <span className="shrink-0 text-slate-400">Visit {visit.visit_no}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600">
                  {whenLabel(visit.created_at)}
                </span>
                {visit.score !== null && (
                  <span className="shrink-0 tabular-nums text-slate-400">
                    {visit.score}/100
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {symptoms.length === 0 && visits.length === 0 && (
        <p className="leading-snug text-slate-600">
          Nothing recorded yet. Right-click a structure to mark what the patient
          reports there.
        </p>
      )}

      {/*
        The door in the seal.
        
        The seal was written to open only once every visit was graded, and
        measured against a real journal that gave 1 graded visit out of 13 —
        because most visits are conversations, not examinations, and will never
        carry a score. A rule that never fires protects nothing; it only keeps
        the reader from writing they authored themselves.

        So this is a deliberate act with a confirmation in front of it, which
        is what the seal was always for: not stopping anyone reading their own
        answer, but stopping them tripping over it. And it is recorded — once
        opened, a case stays open, so a summary cannot include the answer today
        and withhold it tomorrow.
      */}
      {patient.revealed_at === null ? (
        <button
          type="button"
          onClick={() => void unsealAnswer()}
          className="w-full rounded border border-amber-800/60 py-1 text-amber-300/80 transition hover:border-amber-600 hover:text-amber-200"
        >
          Reveal the sealed answer
        </button>
      ) : answer === null ? (
        <button
          type="button"
          onClick={() => void showAnswer()}
          title={`Opened ${whenLabel(patient.revealed_at)}`}
          className="w-full rounded border border-slate-700 py-1 text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          Show the answer · no longer sealed
        </button>
      ) : (
        <div className="rounded border border-amber-800/40 bg-amber-950/20 p-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-amber-700">
            The answer, as you sealed it
          </p>
          <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-amber-100/80">
            {answer}
          </p>
        </div>
      )}

      {/*
        Reading the file back. Its own control rather than a third mode button,
        because a review is always *about* a case — there is nothing to review
        without one open, and a button that is inert most of the time teaches
        people to stop looking at it.
      */}
      {(symptoms.length > 0 || visits.length > 0) && (
        <button
          type="button"
          onClick={startReview}
          title={
            open
              ? "Summarise this case. The sealed answer stays sealed while a visit is ungraded."
              : "Summarise this case, including the answer"
          }
          className="w-full rounded border border-slate-700 py-1 text-slate-300 transition hover:border-sky-600 hover:text-sky-200"
        >
          Review this case
          {open && <span className="ml-1 text-slate-600">· answer stays sealed</span>}
        </button>
      )}
    </div>
  );
}

/**
 * Catching the record up, at the visit it is being caught up at.
 *
 * Appends; there is no edit. What the reader was told going into visit 3 is
 * part of what their answer at visit 3 should be judged against, and a record
 * that can be rewritten backwards grades nothing — the same reasoning the
 * sealed answer rests on. The visit stamp is counted by the journal rather
 * than passed from here, so it can never disagree with the visit list.
 */
function RecordComposer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const note = useCaseStore((s) => s.note);
  const [draft, setDraft] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="mt-1 text-slate-600 transition hover:text-sky-300"
      >
        + Add to the record
      </button>
    );
  }

  async function save() {
    if (draft.trim() === "") return;
    const saved = await note(draft);
    if (!saved) return;
    setDraft("");
    onOpenChange(false);
  }

  return (
    <div className="mt-1 space-y-1">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        autoFocus
        rows={2}
        placeholder="What is known now — a weight, a pressure, what the imaging said"
        className="w-full resize-none rounded border border-slate-700 bg-slate-950 px-1.5 py-1 outline-none placeholder:text-slate-700 focus:border-sky-600"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={draft.trim() === ""}
          className="rounded bg-sky-600 px-2 py-0.5 font-medium disabled:opacity-30"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft("");
            onOpenChange(false);
          }}
          className="text-slate-500 transition hover:text-slate-300"
        >
          Cancel
        </button>
        <span className="text-slate-700">Entries are kept, not replaced.</span>
      </div>
    </div>
  );
}

/**
 * Opening a case seals its answer.
 *
 * The answer is written here, before anything has been attempted, and there is
 * no way to edit it afterwards. That is the whole discipline: an answer written
 * once the attempt is in hand grades nothing, in the same way a prediction
 * recorded only when it turned out right proves nothing.
 *
 * There is no field for a name, and there is no column behind one either. A
 * case file cannot hold a person.
 */
function CaseComposer({
  profile,
  language,
  onClose,
}: {
  profile: UserProfile;
  language: Language;
  onClose: () => void;
}) {
  const openCase = useCaseStore((s) => s.open);
  const error = useCaseStore((s) => s.error);

  const [title, setTitle] = useState("");
  const [sex, setSex] = useState<CaseSex>("female");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [findings, setFindings] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = title.trim().length > 0 && answer.trim().length > 0;

  /** Blank stays blank: an unanswered field is not a zero. */
  function figure(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }

  async function seal() {
    setBusy(true);
    try {
      const created = await openCase({
        id: crypto.randomUUID(),
        title: title.trim(),
        sex,
        age_years: figure(age),
        height_cm: figure(height),
        findings: findings.trim(),
        weight_kg: figure(weight),
        ground_truth: answer.trim(),
        profile,
        language,
      });
      if (created) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-b border-slate-800 px-3 py-2 text-[10px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-slate-500">
          New virtual patient
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1 text-slate-500 transition hover:text-slate-200"
        >
          cancel
        </button>
      </div>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What the case is about — e.g. Chest pain, 58"
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 outline-none placeholder:text-slate-600 focus:border-sky-600"
      />

      <div className="flex items-center gap-1.5">
        <div className="flex overflow-hidden rounded border border-slate-700">
          {(["female", "male"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSex(option)}
              aria-pressed={sex === option}
              className={`px-2 py-0.5 transition ${
                sex === option
                  ? "bg-slate-700/70 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {option === "female" ? "Female" : "Male"}
            </button>
          ))}
        </div>
        <input
          value={age}
          onChange={(event) => setAge(event.target.value)}
          inputMode="numeric"
          placeholder="Age"
          className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 outline-none placeholder:text-slate-600 focus:border-sky-600"
        />
        <input
          value={height}
          onChange={(event) => setHeight(event.target.value)}
          inputMode="numeric"
          placeholder="cm"
          className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 outline-none placeholder:text-slate-600 focus:border-sky-600"
        />
        <input
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          inputMode="decimal"
          placeholder="kg"
          className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 outline-none placeholder:text-slate-600 focus:border-sky-600"
        />
      </div>

      {/*
        Beside the control, permanently, and not in a help page. Presentation
        differs by sex in exactly the systems these cases are for — women
        present myocardial infarction differently, and that is a known cause of
        under-diagnosis. Reasoning about it while showing a male body is honest;
        letting the reader assume the model changed would not be.
      */}
      <p className="leading-snug text-slate-600">
        Sex drives the reasoning. The 3D model in this build is male whichever you
        choose.
      </p>

      {/*
        Two boxes, not one, and the split is the point. Written as a single
        field, an author put "overweight, high blood pressure" — the facts the
        reader needs to reason at all — into the sealed half, and the assistant
        handed them over anyway, quoting the seal back as "according to the
        record". The rule was right; the field was doing two jobs.
      */}
      <textarea
        value={findings}
        onChange={(event) => setFindings(event.target.value)}
        rows={2}
        placeholder="What is on the record — vitals, history, results. The reader sees this."
        className="w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 leading-relaxed outline-none placeholder:text-slate-600 focus:border-sky-600"
      />

      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        rows={3}
        placeholder="What is actually going on. Sealed now, revealed when you ask."
        className="w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 leading-relaxed outline-none placeholder:text-slate-600 focus:border-sky-600"
      />
      <p className="leading-snug text-slate-600">
        Written before anything is attempted, and never editable afterwards — an
        answer decided once the attempt is in hand grades nothing.
      </p>

      {error && <p className="leading-snug text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={() => void seal()}
        disabled={!ready || busy}
        className="w-full rounded border border-sky-700/60 bg-sky-600/15 px-2 py-1 text-sky-200 transition hover:bg-sky-600/25 disabled:opacity-40"
      >
        Seal and open
      </button>
    </div>
  );
}
