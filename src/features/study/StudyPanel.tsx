import { useEffect, useState } from "react";

import {
  caseDigest,
  getStudySession,
  type CaseFile,
  type SessionDetail,
  type SessionSummary,
  type StudyNote,
} from "@/lib/studyDb";
import { matchesQuery, useCaseStore, visitLabel } from "@/stores/caseStore";
import { useChatStore } from "@/stores/chatStore";
import { askToConfirm } from "@/stores/confirmStore";
import { usePrintStore } from "@/stores/printStore";
import { organLabel, useSceneStore } from "@/stores/sceneStore";
import { useStudyStore } from "@/stores/studyStore";

import {
  buildCaseDocument,
  buildNotesDocument,
  buildSessionDocument,
  journalLanguage,
} from "./printDocument";
import { whenLabel } from "./whenLabel";

/**
 * The study journal: what the student wrote down, and what they have worked
 * through.
 *
 * It sits next to the atlas rather than inside the assistant because it
 * outlives any one conversation. Notes and past sessions are the part of the
 * app that is *theirs* — everything else is either the model or the model's
 * answers.
 */
export function StudyPanel() {
  const sessions = useStudyStore((s) => s.sessions);
  const notes = useStudyStore((s) => s.notes);
  const query = useStudyStore((s) => s.query);
  const organFilter = useStudyStore((s) => s.organFilter);
  const organFilterLabel = useStudyStore((s) => s.organFilterLabel);
  const error = useStudyStore((s) => s.error);
  const transfer = useStudyStore((s) => s.transfer);
  const dismissTransfer = useStudyStore((s) => s.dismissTransfer);
  const loaded = useStudyStore((s) => s.loaded);
  const refresh = useStudyStore((s) => s.refresh);
  const setQuery = useStudyStore((s) => s.setQuery);
  const setOrganFilter = useStudyStore((s) => s.setOrganFilter);
  const caseFilter = useStudyStore((s) => s.caseFilter);
  const setCaseFilter = useStudyStore((s) => s.setCaseFilter);
  const cases = useCaseStore((s) => s.cases);
  const dismissError = useStudyStore((s) => s.dismissError);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-800 p-3">
        <StatsStrip />
        <input
          value={query}
          onChange={(event) => void setQuery(event.target.value)}
          placeholder="Search notes, sessions and patients…"
          className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none placeholder:text-slate-600 focus:border-sky-600"
        />
        {caseFilter && (
          <button
            type="button"
            onClick={() => void setCaseFilter(null)}
            title="Show every session again"
            className="mt-1.5 flex w-full items-center gap-1 rounded bg-amber-600/15 px-2 py-0.5 text-[10px] text-amber-300"
          >
            <span className="truncate">
              {cases.find((entry) => entry.id === caseFilter)?.title ?? "This patient"}
            </span>
            <span className="ml-auto shrink-0 text-amber-500">clear ✕</span>
          </button>
        )}
        {organFilter && (
          <button
            type="button"
            onClick={() => void setOrganFilter(null)}
            title="Show everything again"
            className="mt-1.5 flex w-full items-center gap-1 rounded bg-sky-600/15 px-2 py-0.5 text-[10px] text-sky-300"
          >
            <span className="truncate italic">
              {organFilterLabel ?? organFilter}
            </span>
            <span className="ml-auto shrink-0 text-sky-500">clear ✕</span>
          </button>
        )}
      </div>

      {transfer && (
        <button
          type="button"
          onClick={dismissTransfer}
          title="Dismiss"
          className="mx-3 mt-2 rounded border border-emerald-800/60 bg-emerald-900/20 px-2 py-1 text-left text-[11px] text-emerald-300"
        >
          {transfer}
        </button>
      )}

      {error && (
        <button
          type="button"
          onClick={dismissError}
          title="Dismiss"
          className="mx-3 mt-2 rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-left text-[11px] text-rose-300"
        >
          {error}
        </button>
      )}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <section>
          <SectionTitle label="Notes" count={notes.length} action={<PrintNotes />} />
          <NoteComposer />
          {loaded && notes.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-600">
              Nothing written down yet. Select a structure and add a note, or save an
              answer from the assistant.
            </p>
          )}
          <div className="mt-2 space-y-1.5">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        </section>

        <CaseSection />

        <section>
          <SectionTitle label="Sessions" count={sessions.length} />
          {loaded && sessions.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-600">
              Conversations are filed here automatically as you have them.
            </p>
          )}
          <div className="mt-2 space-y-1">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </section>

        <TransferSection />
      </div>
    </div>
  );
}

/**
 * Moving the journal between machines.
 *
 * The one thing in this app that is genuinely irreversible: everything else can
 * be recomputed or asked again, but a year of somebody's own notes cannot. A
 * student who reinstalls, or moves to the laptop they actually revise on, needs
 * to bring it with them.
 *
 * Import **merges**. Arriving at a second machine adds your history to what is
 * there rather than overwriting it, and importing the same file twice does
 * nothing — because someone will double-click it.
 */
function TransferSection() {
  const exportJournal = useStudyStore((s) => s.exportJournal);
  const importJournal = useStudyStore((s) => s.importJournal);
  const stats = useStudyStore((s) => s.stats);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const empty = !stats || stats.sessions + stats.notes === 0;

  const run = (which: "export" | "import", action: () => Promise<void>) => async () => {
    setBusy(which);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <SectionTitle label="Move it to another machine" count={0} />
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          disabled={empty || busy !== null}
          onClick={() => void run("export", exportJournal)()}
          title={
            empty
              ? "Nothing to export yet"
              : "Write the whole journal to one file you can carry"
          }
          className="flex-1 rounded border border-slate-700 py-1 text-[11px] text-slate-300 transition hover:border-sky-600 hover:text-sky-200 disabled:opacity-30"
        >
          {busy === "export" ? "Exporting…" : "Export"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("import", importJournal)()}
          title="Merge a journal file into this one — nothing here is overwritten"
          className="flex-1 rounded border border-slate-700 py-1 text-[11px] text-slate-300 transition hover:border-sky-600 hover:text-sky-200 disabled:opacity-30"
        >
          {busy === "import" ? "Importing…" : "Import"}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-600">
        One file, everything in it. Importing merges — it adds to what is here and
        never overwrites a note you edited more recently.
      </p>
    </section>
  );
}

/**
 * Print the notes on screen.
 *
 * One control, whose meaning follows the filter already applied: with a
 * structure selected it prints that structure's notes, without one it prints
 * them all. A second button for "just this structure" would restate something
 * the reader has already said, and could disagree with it.
 *
 * It prints what the list shows, search included. What you see is what comes
 * out — which is the only rule that does not need explaining.
 */
function PrintNotes() {
  const notes = useStudyStore((s) => s.notes);
  const sessions = useStudyStore((s) => s.sessions);
  const organFilter = useStudyStore((s) => s.organFilter);
  const organFilterLabel = useStudyStore((s) => s.organFilterLabel);
  const showPrint = usePrintStore((s) => s.show);

  if (notes.length === 0) return null;

  const structure = organFilter ? (organFilterLabel ?? null) : null;

  return (
    <button
      type="button"
      onClick={() =>
        showPrint(buildNotesDocument(notes, structure, journalLanguage(sessions)))
      }
      title={
        structure
          ? `Print your notes on ${structure}, or save them as a PDF`
          : "Print these notes, or save them as a PDF"
      }
      className="text-[10px] text-slate-600 transition hover:text-sky-300"
    >
      ⎙ print
    </button>
  );
}

function SectionTitle({
  label,
  count,
  action,
}: {
  label: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-800/70 pb-1">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </h2>
      <span className="text-[10px] text-slate-600">{count}</span>
      <div className="ml-auto">{action}</div>
    </div>
  );
}

function StatsStrip() {
  const stats = useStudyStore((s) => s.stats);
  if (!stats || stats.sessions + stats.notes === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      <Stat label="sessions" value={stats.sessions} />
      {stats.cases > 0 && <Stat label="cases" value={stats.cases} />}
      <Stat label="notes" value={stats.notes} />
      {stats.average_score !== null && (
        <span
          title={`Across ${stats.graded_cases} graded case drill(s)`}
          className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300"
        >
          avg {Math.round(stats.average_score)}/100
        </span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full bg-slate-800/70 px-1.5 py-0.5 text-slate-400">
      {value} {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * Writing a note is bound to whatever is selected in the viewport.
 *
 * That binding is the whole value of keeping notes in here rather than in a
 * text file: a note about the left ventricle is findable from the left
 * ventricle, months later, without remembering what you called it.
 */
function NoteComposer() {
  const organs = useSceneStore((s) => s.organs);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const sessionId = useChatStore((s) => s.sessionId);
  const addNote = useStudyStore((s) => s.addNote);

  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);

  const subject = selectedOrganIds[0] ? organs[selectedOrganIds[0]] : undefined;

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBody("");
    setOpen(false);
    await addNote({
      organ_id: subject?.organ_id ?? null,
      organ_label: subject ? organLabel(subject) : null,
      session_id: sessionId,
      body: text,
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded border border-dashed border-slate-700 py-1 text-[11px] text-slate-500 hover:border-sky-700 hover:text-sky-300"
      >
        {subject ? `Add a note on ${organLabel(subject)}` : "Add a note"}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded border border-slate-700 bg-slate-900/60 p-2">
      {subject && (
        <p className="mb-1 truncate text-[10px] italic text-sky-300">
          {organLabel(subject)}
        </p>
      )}
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Ctrl/Cmd+Enter saves; plain Enter has to stay a newline, because a
          // note is prose and a stray Enter would file half a sentence.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") setOpen(false);
        }}
        rows={3}
        autoFocus
        placeholder="What is worth remembering here?"
        className="w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] outline-none placeholder:text-slate-600 focus:border-sky-600"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={body.trim().length === 0}
          className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-medium disabled:opacity-30"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setBody("");
            setOpen(false);
          }}
          className="text-[10px] text-slate-500 hover:text-slate-300"
        >
          Cancel
        </button>
        <span className="ml-auto text-[9px] text-slate-600">Ctrl+Enter</span>
      </div>
    </div>
  );
}

function NoteCard({ note }: { note: StudyNote }) {
  const organs = useSceneStore((s) => s.organs);
  const setHovered = useSceneStore((s) => s.setHovered);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const setOrganFilter = useStudyStore((s) => s.setOrganFilter);
  const editNote = useStudyStore((s) => s.editNote);
  const removeNote = useStudyStore((s) => s.removeNote);

  const [draft, setDraft] = useState<string | null>(null);
  /**
   * Whether a long note is showing in full.
   *
   * Notes are not all the same size. One is "mitral has two leaflets"; the next
   * is a whole answer saved from the assistant, which can run to a screen and a
   * half of Bulgarian. Left unclamped, two of those bury every other note in
   * the journal and the list stops being scannable — which is the one thing a
   * list of notes has to be.
   *
   * Clamped rather than truncated, so nothing is thrown away and expanding
   * costs one click. Short notes get no control at all: a "Show more" under two
   * lines is noise pretending to be a feature.
   */
  const [open, setOpen] = useState(false);
  const long = isLongNote(note.body);
  // A note may name a structure whose system is currently switched off, or one
  // from an older atlas build. The stored label still reads correctly; only
  // flying to it needs the mesh to be there.
  const reachable = note.organ_id !== null && note.organ_id in organs;

  /**
   * A note is the only thing in this app that genuinely cannot be recovered.
   * Everything else can be recomputed, reloaded or asked again; this is the
   * student's own writing, and there is no second copy of it anywhere.
   */
  async function askThenRemove() {
    const confirmed = await askToConfirm({
      title: "Delete this note?",
      subject: preview(note.body),
      body:
        "This is your own writing and there is no copy of it anywhere else. " +
        "It cannot be brought back.",
      confirmLabel: "Delete note",
    });
    if (confirmed) await removeNote(note.id);
  }

  return (
    <div className="group rounded border border-slate-800 bg-slate-900/50 p-2">
      {note.organ_label && (
        <div className="mb-1 flex items-center gap-1">
          <button
            type="button"
            disabled={!reachable}
            onMouseEnter={() => reachable && setHovered(note.organ_id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() =>
              note.organ_id &&
              applyCommand({ action: "focus_organ", organ_id: note.organ_id })
            }
            title={reachable ? "Fly to this structure" : "Not loaded right now"}
            className="truncate text-[10px] italic text-sky-300 disabled:text-slate-500"
          >
            {note.organ_label}
          </button>
          {note.organ_id && (
            <button
              type="button"
              onClick={() => void setOrganFilter(note.organ_id, note.organ_label)}
              title="Show everything filed under this structure"
              className="text-[10px] text-slate-600 hover:text-slate-300"
            >
              ⌕
            </button>
          )}
        </div>
      )}

      {draft === null ? (
        <>
          <p
            className={`whitespace-pre-wrap text-[12px] text-slate-300 ${
              long && !open ? "line-clamp-4" : ""
            }`}
          >
            {note.body}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="mt-0.5 text-[10px] text-slate-500 hover:text-sky-300"
            >
              {open ? "Show less" : "Show more"}
            </button>
          )}
        </>
      ) : (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void editNote(note.id, draft).then(() => setDraft(null));
            }
            if (event.key === "Escape") setDraft(null);
          }}
          rows={3}
          autoFocus
          className="w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] outline-none focus:border-sky-600"
        />
      )}

      <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-600">
        <span>{whenLabel(note.updated_at)}</span>
        <div className="ml-auto flex gap-2 opacity-0 transition group-hover:opacity-100">
          {draft === null ? (
            <button
              type="button"
              onClick={() => setDraft(note.body)}
              className="hover:text-slate-300"
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void editNote(note.id, draft).then(() => setDraft(null))}
              className="text-sky-400 hover:text-sky-300"
            >
              Save
            </button>
          )}
          <button
            type="button"
            onClick={() => void askThenRemove()}
            className="hover:text-rose-400"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function SessionRow({ session }: { session: SessionSummary }) {
  const loadSession = useChatStore((s) => s.loadSession);
  const currentId = useChatStore((s) => s.sessionId);
  const selectMany = useSceneStore((s) => s.selectMany);
  const removeSession = useStudyStore((s) => s.removeSession);
  const showPrint = usePrintStore((s) => s.show);
  const cases = useCaseStore((s) => s.cases);
  const [busy, setBusy] = useState(false);

  const active = session.id === currentId;
  const patient = session.case_id
    ? cases.find((entry) => entry.id === session.case_id)
    : undefined;

  /**
   * Reopening restores the structures too. A transcript without the anatomy it
   * was about is half the session — the reader would be reading answers about a
   * viewport showing something else.
   */
  async function reopen() {
    setBusy(true);
    try {
      const detail = await getStudySession(session.id);
      if (detail) {
        loadSession(detail);
        selectMany(detail.structures);
      }
    } catch {
      useStudyStore.setState({ error: "Could not reopen that session." });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Deleting a session takes the conversation and the record of which
   * structures it covered. Notes filed during it survive: the foreign key is
   * `ON DELETE SET NULL`, so they lose the link and keep the writing. Saying so
   * is the difference between a warning someone reads and one they click past.
   */
  async function askThenRemove() {
    const confirmed = await askToConfirm({
      title: "Delete this session?",
      subject: session.title,
      body:
        `The whole conversation goes — ${session.message_count} messages — along with ` +
        "the record of which structures it covered. Any notes you filed during it stay " +
        "in your journal. It cannot be brought back.",
      confirmLabel: "Delete session",
    });
    if (confirmed) await removeSession(session.id);
  }

  /**
   * The full transcript has to be fetched: the row in this list carries counts,
   * not messages. Structures are named from the loaded atlas here rather than in
   * the builder, because the builder is where the rule lives that an id it
   * cannot name is dropped instead of printed.
   */
  async function print() {
    setBusy(true);
    try {
      const detail = await getStudySession(session.id);
      if (!detail) {
        useStudyStore.setState({ error: "That session is no longer in the journal." });
        return;
      }
      const organs = useSceneStore.getState().organs;
      showPrint(
        buildSessionDocument(detail, (organId) => {
          const organ = organs[organId];
          return organ ? organLabel(organ) : null;
        }),
      );
    } catch {
      useStudyStore.setState({ error: "Could not prepare that session for printing." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`group flex items-start gap-2 rounded border px-2 py-1.5 ${
        active ? "border-sky-700/60 bg-sky-600/10" : "border-slate-800 hover:border-slate-700"
      }`}
    >
      <button
        type="button"
        onClick={() => void reopen()}
        disabled={busy || active}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-[12px] text-slate-300">{session.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[9px] text-slate-600">
          {/* Whose visit this was, when it was one. The plain `case` badge
              stays for drills that belong to nobody — most of the journal. */}
          {patient ? (
            <span className="truncate rounded-full bg-sky-600/15 px-1 text-sky-300">
              {patient.title}
              {session.visit_no !== null && ` · visit ${session.visit_no}`}
            </span>
          ) : (
            session.kind === "case" && (
              <span className="rounded-full bg-amber-500/15 px-1 text-amber-300">case</span>
            )
          )}
          <span>{whenLabel(session.updated_at)}</span>
          <span>· {session.message_count} messages</span>
          {session.structure_count > 0 && <span>· {session.structure_count} structures</span>}
        </p>
        {session.score !== null && (
          <p
            title={session.verdict ?? undefined}
            className={`mt-1 truncate text-[10px] font-semibold ${scoreTone(session.score)}`}
          >
            {session.score}/100 — {session.verdict}
          </p>
        )}
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void askThenRemove()}
          title="Delete this session"
          className="text-[10px] text-slate-700 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={() => void print()}
          disabled={busy}
          title="Print this session, or save it as a PDF"
          className="text-[10px] text-slate-700 opacity-0 transition hover:text-sky-300 disabled:opacity-30 group-hover:opacity-100"
        >
          ⎙
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case files
// ---------------------------------------------------------------------------

/**
 * Virtual patients, each with its visits.
 *
 * "Virtual patient" is the term used deliberately, and not "digital twin": a
 * twin is a model of a *real* entity kept in step with data from it, which is
 * the one thing this must never be mistaken for. Nobody here is real and no
 * data comes from anyone.
 *
 * Hidden entirely when there are none. A reader who has never opened a case
 * gains nothing from an empty heading explaining a feature they have not asked
 * for — the picker in the assistant is where cases begin.
 */
function CaseSection() {
  const cases = useCaseStore((s) => s.cases);
  const refresh = useCaseStore((s) => s.refresh);
  // The same box that narrows notes and sessions. A second search field for a
  // third list would make the reader choose which one they meant.
  const query = useStudyStore((s) => s.query);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (cases.length === 0) return null;
  const shown = cases.filter((entry) => matchesQuery(entry, query));

  return (
    <section>
      <SectionTitle label="Virtual patients" count={shown.length} />
      {shown.length === 0 && (
        <p className="mt-2 text-[11px] text-slate-600">
          No patient matches that. The notes and sessions below are narrowed too.
        </p>
      )}
      <div className="mt-2 space-y-1">
        {shown.map((entry) => (
          <CaseRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function CaseRow({ entry }: { entry: CaseFile }) {
  const removeCase = useCaseStore((s) => s.remove);
  const activeCaseId = useCaseStore((s) => s.activeCaseId);
  const caseFilter = useStudyStore((s) => s.caseFilter);
  const setCaseFilter = useStudyStore((s) => s.setCaseFilter);
  const filtered = caseFilter === entry.id;
  const showPrint = usePrintStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  const active = entry.id === activeCaseId;

  /**
   * The two halves of this case go different ways, and the reader has to be
   * told which before they answer.
   *
   * Visits survive as ordinary sessions — `ON DELETE SET NULL`, the same call
   * the journal makes everywhere the reader's own work is involved. The marked
   * complaints do not: they described the invented patient and mean nothing
   * without them, so their key cascades. That asymmetry is invisible from the
   * outside and is exactly the sort of thing a confirmation exists to surface.
   */
  async function askThenRemove() {
    const confirmed = await askToConfirm({
      title: "Delete this virtual patient?",
      subject: entry.title,
      body:
        `The case goes, along with everything marked on the body — ` +
        `${entry.visit_count === 1 ? "the visit" : `all ${entry.visit_count} visits`} ` +
        "stay in your journal as ordinary sessions, with their transcripts and " +
        "scores. The sealed answer goes with the case. It cannot be brought back.",
      confirmLabel: "Delete patient",
    });
    if (confirmed) await removeCase(entry.id);
  }

  /**
   * The whole history, as a page.
   *
   * Each visit's transcript has to be fetched — the digest carries the scores
   * and the verdicts, which is all the *next visit* needs, but a record someone
   * revises from needs what was actually said. A visit whose transcript cannot
   * be loaded still prints: dropping it would renumber the history.
   */
  async function print() {
    setBusy(true);
    try {
      const digest = await caseDigest(entry.id);
      if (!digest) {
        useStudyStore.setState({ error: "That case is no longer in the journal." });
        return;
      }

      const details = new Map<string, SessionDetail>();
      const loaded = await Promise.all(
        digest.visits.map((visit) =>
          getStudySession(visit.session_id).catch(() => null),
        ),
      );
      loaded.forEach((detail) => {
        if (detail) details.set(detail.session.id, detail);
      });

      const organs = useSceneStore.getState().organs;
      showPrint(
        buildCaseDocument(digest, details, (organId) => {
          const organ = organs[organId];
          return organ ? organLabel(organ) : null;
        }),
      );
    } catch {
      useStudyStore.setState({ error: "Could not prepare that case for printing." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`group flex items-start gap-2 rounded border px-2 py-1.5 ${
        active ? "border-sky-700/60 bg-sky-600/10" : "border-slate-800 hover:border-slate-700"
      }`}
    >
      <button
        type="button"
        onClick={() => void setCaseFilter(filtered ? null : entry.id)}
        title={
          filtered
            ? "Show every session again"
            : "Show only this patient's visits below"
        }
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-[12px] text-slate-300">{entry.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-slate-600">
          <span className="rounded-full bg-slate-700/40 px-1 text-slate-400">
            {entry.sex === "female" ? "female" : "male"}
          </span>
          {entry.age_years !== null && <span>{entry.age_years}y</span>}
          <span>· {visitLabel(entry)}</span>
          <span>· {whenLabel(entry.updated_at)}</span>
          {filtered && <span className="text-amber-400">· showing visits</span>}
        </p>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void askThenRemove()}
          title="Delete this virtual patient"
          className="text-[10px] text-slate-700 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={() => void print()}
          disabled={busy}
          title="Print the whole history, or save it as a PDF — includes the sealed answer"
          className="text-[10px] text-slate-700 opacity-0 transition hover:text-sky-300 disabled:opacity-30 group-hover:opacity-100"
        >
          ⎙
        </button>
      </div>
    </div>
  );
}

/**
 * Enough of a note to recognise it in a dialog.
 *
 * Newlines collapse because the confirmation shows it as one short block, and a
 * note that starts with a blank line would otherwise be quoted as nothing at
 * all — the one case where the reader most needs to see something.
 *
 * Exported for its own test: this is the text someone decides on, so it going
 * blank is not a cosmetic bug.
 */
export function preview(body: string, limit = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** How many lines a clamped note shows. Matches `line-clamp-4` in the markup. */
export const NOTE_CLAMP_LINES = 4;

/**
 * Roughly how many characters fit on one line of the notes column.
 *
 * An estimate, and it only has to be a good one. The clamp itself is done in
 * CSS, which counts *rendered* lines and so gets it exactly right whatever the
 * script — Cyrillic and Latin do not fit the same number of characters. This
 * decides only whether to **offer** the control, and being a line out shows a
 * "Show more" on a note that happened to fit, which costs nothing.
 */
const CHARS_PER_LINE = 55;

/**
 * Whether a note needs the clamp at all.
 *
 * Counted per written line and then wrapped, rather than from the total length.
 * A note written as five short bullets fills five lines while barely passing
 * any character count, and lines are what the clamp cuts.
 */
export function isLongNote(body: string, limit = NOTE_CLAMP_LINES): boolean {
  const rendered = body
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
  return rendered > limit;
}

function scoreTone(score: number): string {
  if (score >= 71) return "text-emerald-400";
  if (score >= 41) return "text-amber-400";
  return "text-rose-400";
}
