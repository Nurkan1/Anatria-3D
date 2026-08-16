import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  conversationIsCostly,
  formatTokens,
  totalTokens,
} from "@/features/usage/tokens";
import { useSceneCommands } from "@/features/viewer/useSceneCommands";
import {
  askAgent,
  cancelRequest,
  engineStatus,
  newRequestId,
  restartEngine,
} from "@/lib/ipc";
import { PROTOCOL_VERSION } from "@/lib/schemas";
import type {
  AiProvider,
  AnatomicalSystem,
  Language,
  ModelInfo,
  SessionMode,
  TokenUsage,
  UserProfile,
} from "@/lib/schemas";
import {
  activeCase,
  reviewReadiness,
  useCaseStore,
  virtualPatientContext,
} from "@/stores/caseStore";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";
import { chatPreferences, patchChatPreferences } from "@/stores/chatPreferences";
import { useModelStore } from "@/stores/modelStore";
import { organLabel, useSceneStore } from "@/stores/sceneStore";
import { useStudyStore } from "@/stores/studyStore";
import { useUsageStore } from "@/stores/usageStore";

import { GrowingTextarea } from "@/components/GrowingTextarea";
import { CaseBar } from "./CaseBar";
import { Markdown } from "./Markdown";
import { collectOrganRefs, stripOrganRefs } from "./organRefs";
import { SettingsDrawer } from "./SettingsDrawer";
import { useCopy } from "./useCopy";

/** Human-readable names for the scene tools, for the activity trail. */
const TOOL_LABELS: Record<string, string> = {
  focus_organ: "focused a structure",
  isolate_structures: "isolated structures",
  show_all_structures: "restored the full view",
  set_layer_visibility: "toggled a system",
  set_layer_opacity: "made a layer see-through",
  xray_system: "faded the other systems back",
  apply_pathology_overlay: "marked a pathology",
  clear_pathology_overlays: "cleared overlays",
  set_cross_section: "cut a section",
  record_case_verdict: "graded the answer",
};

/**
 * One-click openings for a case drill, gated on the anatomy actually loaded.
 *
 * A drill whose organs are switched off can only describe them, and describing
 * is what the drill exists to replace.
 */
const CASE_STARTERS: { label: string; system: AnatomicalSystem; prompt: string }[] = [
  {
    label: "Cardiac emergency",
    system: "cardiovascular",
    prompt: "Start a case drill: an acute cardiovascular emergency.",
  },
  {
    label: "Respiratory",
    system: "respiratory",
    prompt: "Start a case drill: a patient in respiratory distress.",
  },
  {
    label: "Neurological",
    system: "nervous",
    prompt: "Start a case drill: an acute neurological deficit.",
  },
  {
    label: "Abdominal",
    system: "digestive",
    prompt: "Start a case drill: acute abdominal pain.",
  },
];

/**
 * Why the answers here are getting expensive, said once it is true.
 *
 * Nothing about a chat box suggests that the same question costs more later
 * than it does now — but every turn re-sends the whole transcript, so it does.
 * The reader pays for that with their own key, and it is not something anyone
 * can be expected to deduce.
 *
 * Placed above the composer rather than in a settings page or the help panel,
 * because that is where the reader is when the next question is about to be
 * asked. And it names the way out, which is the only reason to say it at all:
 * a fresh session drops the transcript while the case keeps its record, since
 * the record is read from the journal and costs nothing to carry.
 */
function CostNotice({ messages, mode }: { messages: ChatMessage[]; mode: SessionMode }) {
  const patient = useCaseStore(activeCase);
  const last = [...messages].reverse().find((message) => message.usage)?.usage;
  if (!conversationIsCostly(last)) return null;

  return (
    <p className="mx-3 mb-2 rounded border border-slate-700/70 bg-slate-800/40 px-2 py-1 text-[10px] leading-snug text-slate-400">
      Each question re-sends this whole conversation, so answers cost more the
      longer it runs — this one was {formatTokens(totalTokens(last!))} tokens.{" "}
      {mode === "case" && patient
        ? "Starting a new visit keeps this patient's record and their marked complaints, and drops the transcript."
        : "Starting a new session drops the transcript."}
    </p>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function ToolTrail({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  // Consecutive repeats of the same tool read as noise; a count is clearer.
  const runs: { tool: string; count: number }[] = [];
  for (const tool of tools) {
    const last = runs.at(-1);
    if (last && last.tool === tool) last.count += 1;
    else runs.push({ tool, count: 1 });
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {runs.map((run, index) => (
        <span
          key={`${run.tool}-${index}`}
          className="rounded-full bg-slate-800/70 px-2 py-0.5 text-[10px] text-slate-400"
        >
          {TOOL_LABELS[run.tool] ?? run.tool}
          {run.count > 1 && ` ×${run.count}`}
        </span>
      ))}
    </div>
  );
}

/**
 * The structures this answer pointed at, as a legend under the text.
 *
 * The inline pins are small by design so they do not break the reading flow;
 * this is where the reader can see the whole set at a glance and jump between
 * them without hunting through paragraphs.
 */
function ReferenceLegend({ content }: { content: string }) {
  const organs = useSceneStore((s) => s.organs);
  const setHovered = useSceneStore((s) => s.setHovered);
  const applyCommand = useSceneStore((s) => s.applyCommand);

  const refs = collectOrganRefs(content, (organId) => organId in organs);
  if (refs.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-800/70 pt-2">
      {refs.map((ref) => {
        const organ = organs[ref.organId];
        if (!organ) return null;
        return (
          <button
            key={ref.organId}
            type="button"
            onMouseEnter={() => setHovered(ref.organId)}
            onMouseLeave={() => setHovered(null)}
            onClick={() =>
              applyCommand({ action: "focus_organ", organ_id: ref.organId })
            }
            className="flex items-center gap-1 rounded border border-slate-700/80 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-sky-600 hover:text-sky-200"
          >
            <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sky-500/20 px-0.5 text-[8px] font-semibold text-sky-300">
              {ref.index}
            </span>
            <span className="italic">{organLabel(organ)}</span>
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-sky-600/20 px-3 py-2 text-[13px] text-slate-100">
          {message.content}
        </div>
        <div className="opacity-0 transition group-hover:opacity-100">
          <CopyButton text={message.content} />
        </div>
      </div>
    );
  }

  const empty = message.content.trim().length === 0;

  return (
    <div className="group flex flex-col gap-1">
      <div className="rounded-lg rounded-bl-sm bg-slate-900/70 px-3 py-2">
        {message.score !== undefined && <ScoreBadge score={message.score} />}
        {empty && message.status === "streaming" ? (
          <span className="inline-flex gap-1 py-1" aria-label="Thinking">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-500"
                style={{ animationDelay: `${dot * 160}ms` }}
              />
            ))}
          </span>
        ) : (
          <Markdown>{message.content}</Markdown>
        )}

        <ToolTrail tools={message.tools} />
        <ReferenceLegend content={message.content} />

        {message.status === "error" && (
          <p className="mt-2 rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-[11px] text-rose-300">
            {message.error}
          </p>
        )}
        {message.status === "cancelled" && (
          <p className="mt-2 text-[11px] italic text-slate-500">Stopped.</p>
        )}
      </div>

      {!empty && (
        <div className="flex items-center gap-2">
          {/* The actions fade in on hover; what the answer *is* does not. Which
              model produced it only earns its place if you can scan a
              transcript and compare two answers without pointing at each. */}
          <div className="flex items-center gap-2 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
            {/* Copy the prose the reader sees, not the [[organ_id]] plumbing. */}
            <CopyButton text={stripOrganRefs(message.content)} label="Copy answer" />
            <SaveAsNoteButton content={message.content} />
          </div>
          {/* Pushed to the far end so the two facts about the answer sit apart
              from the two things you can do with it. Both are faint: a reader
              comparing models wants them, a reader learning anatomy should be
              able to look straight past them. */}
          <span className="ml-auto flex items-baseline gap-1.5 text-[10px] text-slate-600">
            {message.model && (
              <span className="max-w-[11rem] truncate" title={`Answered by ${message.model}`}>
                {message.model}
              </span>
            )}
            {message.model && message.usage && <span className="text-slate-700">·</span>}
            {message.usage && (
              <span
                className="tabular-nums"
                title={`${formatTokens(message.usage.input_tokens)} sent · ${formatTokens(
                  message.usage.output_tokens,
                )} received`}
              >
                {formatTokens(totalTokens(message.usage))} tokens
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Put the conversation away and start a clean one.
 *
 * # Nothing is destroyed, and that is why there is no confirmation
 *
 * Every finished exchange is already in the study journal, filed under the
 * structures it was about, reopenable from the **Study** tab. This starts a new
 * transcript; it does not delete the old one. A confirmation dialog would teach
 * the opposite — that something is at stake here — and the dialogs in this app
 * are reserved for the things that genuinely are.
 *
 * # Why it is at the top
 *
 * Deliberately far from the composer. The one control it must never sit beside
 * is **Send**: a misfire there costs you the answer you were part-way through
 * reading, and the recovery — find it in Study, reopen it — is exactly the
 * detour the button exists to save. Disabled rather than hidden while the
 * transcript is empty, so the header does not reflow as you use it.
 */
function NewSessionButton({
  mode,
  onStart,
  disabled,
}: {
  mode: SessionMode;
  onStart: (mode: SessionMode) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onStart(mode)}
      disabled={disabled}
      title={
        disabled
          ? "This conversation is already empty"
          : "Start a fresh conversation — this one is kept in Study"
      }
      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-sky-600 hover:text-sky-300 disabled:cursor-default disabled:border-slate-800 disabled:text-slate-700 disabled:hover:border-slate-800 disabled:hover:text-slate-700"
    >
      New
    </button>
  );
}

/**
 * Lesson or drill.
 *
 * Switching kind necessarily starts a new session: a session is one or the
 * other for its whole life, the journal files it under a single kind, and a
 * transcript half explanation and half graded drill is not something either
 * view can present honestly.
 *
 * Pressing the kind you are *already* in used to start a fresh session too —
 * this control had absorbed the old "New chat" button. It was a mistake, and
 * the evidence was the heaviest user of the app asking for a button that had
 * been there all along: a capability reachable only by pressing something that
 * looks inert, and explained only in a tooltip, is not a capability. It is now
 * a no-op, and starting fresh has its own control again.
 */
function ModeSwitch({
  mode,
  onChange,
}: {
  mode: SessionMode;
  onChange: (mode: SessionMode) => void;
}) {
  const options: { value: SessionMode; label: string }[] = [
    { value: "tutor", label: "Tutor" },
    { value: "case", label: "Case drill" },
  ];

  return (
    <div className="flex overflow-hidden rounded border border-slate-700">
      {options.map((option) => {
        const active = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => !active && onChange(option.value)}
            aria-pressed={active}
            title={
              active
                ? option.label
                : `Switch to ${option.label.toLowerCase()} — starts a new session`
            }
            className={`px-2 py-0.5 text-[10px] transition ${
              active
                ? "bg-slate-700/70 text-slate-100"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 71
      ? "bg-emerald-500/15 text-emerald-300"
      : score >= 41
        ? "bg-amber-500/15 text-amber-300"
        : "bg-rose-500/15 text-rose-300";
  return (
    <span
      className={`mb-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      {score}/100 · saved to your journal
    </span>
  );
}

/**
 * Keep an answer.
 *
 * Filed against whatever is selected, so it turns up again from the structure
 * rather than only from the session it came out of. The `[[organ_id]]` markers
 * are stripped first — a note is prose the student reads, not wire format.
 */
function SaveAsNoteButton({ content }: { content: string }) {
  const organs = useSceneStore((s) => s.organs);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const sessionId = useChatStore((s) => s.sessionId);
  const addNote = useStudyStore((s) => s.addNote);
  const [saved, setSaved] = useState(false);

  const subject = selectedOrganIds[0] ? organs[selectedOrganIds[0]] : undefined;

  return (
    <button
      type="button"
      onClick={() => {
        setSaved(true);
        void addNote({
          organ_id: subject?.organ_id ?? null,
          organ_label: subject ? organLabel(subject) : null,
          session_id: sessionId,
          body: stripOrganRefs(content),
        });
      }}
      title={subject ? `Save as a note on ${organLabel(subject)}` : "Save as a note"}
      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
    >
      {saved ? "Saved" : "Save as note"}
    </button>
  );
}

/**
 * What a review is about to read, said before it reads it.
 *
 * `Review this case` used to switch the mode and leave this space blank. The
 * mode had changed, the placeholder had changed, and nothing else had — which
 * is indistinguishable from a broken button. The fix is not a spinner but the
 * truth about the file: what the summary will be built from, and what it will
 * not have. A review of a case with no findings and nothing graded is thin
 * because the file is thin, and the reader should learn that here rather than
 * from a disappointing answer they paid for.
 */
function ReviewIntro({ onAsk, disabled }: { onAsk: () => void; disabled: boolean }) {
  const patient = useCaseStore(activeCase);
  const symptoms = useCaseStore((s) => s.symptoms);
  const visits = useCaseStore((s) => s.visits);
  const record = useCaseStore((s) => s.record);

  // Reachable: leaving the patient while a review is open drops the file out
  // from under it. Nothing is wrong, there is simply nothing to summarise.
  if (!patient) {
    return (
      <div className="space-y-2 pt-6 text-center text-xs text-slate-500">
        <p>No patient is open.</p>
        <p className="text-slate-600">
          A review is always about a case. Pick one above, or start a new
          conversation.
        </p>
      </div>
    );
  }

  const file = reviewReadiness(patient, symptoms, visits, record);
  const sources = [
    file.complaints > 0 &&
      `${file.complaints} ${file.complaints === 1 ? "complaint" : "complaints"} marked on the body`,
    !file.bare && "the findings on the record",
    file.updates > 0 &&
      `${file.updates} later ${file.updates === 1 ? "entry" : "entries"}`,
    file.visits > 0 && `${file.visits} ${file.visits === 1 ? "visit" : "visits"}`,
  ].filter((entry): entry is string => typeof entry === "string");

  return (
    <div className="space-y-3 pt-6 text-center text-xs text-slate-500">
      <p>Reading the file back on {patient.title}.</p>
      <p className="text-slate-600">
        What was presented, what has been reasoned, and where the gaps are.
        Nothing is written into the record.
      </p>

      <div className="flex justify-center pt-1">
        <button
          type="button"
          disabled={disabled}
          onClick={onAsk}
          className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-sky-600 hover:text-sky-200 disabled:opacity-30"
        >
          Summarise this case
        </button>
      </div>

      {/*
        The limits, stated before the summary rather than discovered in it.
        Each one is a fact about this file, not a warning about the software.
      */}
      <div className="mx-auto max-w-[19rem] space-y-1.5 pt-1 text-left text-[10px] leading-snug text-slate-600">
        {sources.length > 0 && <p>It reads {sources.join(", ")}.</p>}

        {file.visits === 0 && (
          <p className="text-amber-500/70">
            No visit has been recorded yet, so there is no reasoning to review —
            only what you have marked.
          </p>
        )}

        {file.bare && (
          <p className="text-amber-500/70">
            This case carries no findings, so the summary has the complaints and
            the visits and nothing else to reason from. Add what is known from
            the patient record above — the sealed answer stays sealed either
            way.
          </p>
        )}

        {file.ungraded > 0 && (
          <p>
            The sealed answer stays sealed: {file.ungraded} of {file.visits}{" "}
            {file.visits === 1 ? "visit is" : "visits are"} ungraded, and so are
            their verdicts. Grade them and a review may use both.
          </p>
        )}

        {file.visits > 0 && file.ungraded === 0 && (
          <p>Every visit is graded, so the sealed answer is included.</p>
        )}

        <p className="text-slate-700">
          Past visits are read as their grades and verdicts, not as their
          transcripts. Reopen a visit from the record above to read what was
          said.
        </p>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const organs = useSceneStore((s) => s.organs);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);

  const messages = useChatStore((s) => s.messages);
  const pendingRequestId = useChatStore((s) => s.pendingRequestId);
  const startTurn = useChatStore((s) => s.startTurn);
  const appendDelta = useChatStore((s) => s.appendDelta);
  const noteTool = useChatStore((s) => s.noteTool);
  const finishTurn = useChatStore((s) => s.finishTurn);
  const failTurn = useChatStore((s) => s.failTurn);
  const markCancelled = useChatStore((s) => s.markCancelled);
  const noteScore = useChatStore((s) => s.noteScore);
  const mode = useChatStore((s) => s.mode);
  const beginSession = useChatStore((s) => s.beginSession);

  const [engineReady, setEngineReady] = useState(false);
  // Read once, synchronously, so the drawer's first paint is already the
  // reader's own setup rather than the default flicking over to it.
  const [provider, setProvider] = useState<AiProvider>(() => chatPreferences().provider);
  const [profile, setProfile] = useState<UserProfile>(() => chatPreferences().profile);
  const [language, setLanguage] = useState<Language>(() => chatPreferences().language);
  const [draft, setDraft] = useState("");
  const [transportError, setTransportError] = useState<string | null>(null);

  const receiveModels = useModelStore((s) => s.receiveModels);
  const failCheck = useModelStore((s) => s.failCheck);
  const selectedModel = useModelStore((s) => s.byProvider[provider]?.selected ?? null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = pendingRequestId;

  // Read by the engine-event callbacks. Held in a ref rather than in their
  // dependency lists so changing the profile does not tear down and rebuild the
  // event subscription mid-answer.
  const turnContextRef = useRef({ profile, language });
  turnContextRef.current = { profile, language };

  /** Structures selected when each question was sent, so the journal files the
   *  turn under the anatomy it was actually about rather than under whatever
   *  happens to be selected once the answer lands. */
  const askedAboutRef = useRef(new Map<string, string[]>());
  /** Grades arrive mid-turn, before the session row exists. Applied on `done`. */
  const verdictRef = useRef(new Map<string, { score: number; verdict: string }>());
  /**
   * The provider each question was sent to.
   *
   * Per request rather than read back off the drawer when the answer lands: the
   * reader can switch provider mid-answer, and the one thing a ledger may never
   * do is file a turn's cost against a provider that did not serve it.
   */
  const askedWithRef = useRef(new Map<string, AiProvider>());

  /** Drop a turn's bookkeeping. A turn that failed is never going to be filed. */
  const forgetTurn = useCallback((requestId: string) => {
    askedAboutRef.current.delete(requestId);
    verdictRef.current.delete(requestId);
    askedWithRef.current.delete(requestId);
  }, []);

  const persistTurn = useCallback((requestId: string) => {
    const chat = useChatStore.getState();
    const turn = chat.turn(requestId);
    const organIds = askedAboutRef.current.get(requestId) ?? [];
    askedAboutRef.current.delete(requestId);
    const grade = verdictRef.current.get(requestId);
    verdictRef.current.delete(requestId);
    if (!turn) return;

    // A review is a reading of the journal, not work in it. Filing one would
    // put generated prose into a record that otherwise holds only what the
    // reader did — and the journal's own CHECK on `kind` would refuse it
    // anyway. What it *does* cost is tokens, and `recordSpend` still runs.
    if (chat.mode === "review") return;

    const study = useStudyStore.getState();
    const { profile: askedProfile, language: askedLanguage } = turnContextRef.current;

    void study
      .saveTurn({
        session_id: chat.sessionId,
        kind: chat.mode,
        title: chat.messages.find((message) => message.role === "user")?.content ?? "",
        profile: askedProfile,
        language: askedLanguage,
        question: turn.question,
        answer: turn.answer,
        organ_ids: organIds,
        // Filed with the answer so reopening the session — or printing it —
        // can still say what wrote this. The ledger in `token_usage` cannot:
        // it is keyed by conversation and survives the session's deletion,
        // which is right for accounting and useless for provenance.
        model: turn.model ?? null,
        input_tokens: turn.usage?.input_tokens ?? null,
        output_tokens: turn.usage?.output_tokens ?? null,
        // Which virtual patient this conversation is a visit to, if any. Read
        // by the journal only when the session row is created: the visit
        // number is fixed then, and a conversation cannot change case halfway
        // through without every later digest silently changing meaning.
        //
        // Only in case mode. A tutor conversation that happened to be open
        // while a case was selected is not a consultation.
        case_id: chat.mode === "case" ? useCaseStore.getState().activeCaseId : null,
      })
      // Strictly after the turn, and only if it landed: the session row is
      // created by that save, so grading a failed one would raise a second,
      // unrelated error about a session that was never written.
      .then((saved) => {
        if (!saved) return;
        if (grade) {
          void study.recordVerdict(chat.sessionId, grade.score, grade.verdict);
        }
        // The case store holds `visit_count`, and filing a visit is what
        // changes it. Reloading only the study store left the chip saying
        // "visit 8" while the journal beside it listed visit 10 — the same
        // two-stores-one-write mistake the journal restore made.
        if (chat.mode === "case" && useCaseStore.getState().activeCaseId) {
          void useCaseStore.getState().refresh();
        }
      });
  }, []);

  /**
   * File what the turn cost, whatever became of it.
   *
   * Deliberately not inside `persistTurn`. That refuses to file a failed or
   * cancelled turn, which is the right rule for a study journal — half-answers
   * would read as gaps in the student's own understanding — but it is exactly
   * the wrong rule for a ledger. A turn that burnt eight thousand input tokens
   * and then hit a rate limit cost real money and belongs in the total.
   *
   * Both fields are required rather than defaulted. A count with no model is
   * unattributable, and guessing at either would put a number in the panel that
   * nobody can check against a provider's bill.
   */
  const recordSpend = useCallback(
    (requestId: string, usage: TokenUsage | null, model: string | null) => {
      const provider = askedWithRef.current.get(requestId);
      askedWithRef.current.delete(requestId);
      if (!usage || !model || !provider) return;

      void useUsageStore.getState().record({
        session_id: useChatStore.getState().sessionId,
        provider,
        model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      });
    },
    [],
  );

  /**
   * Whether the engine on disk speaks the protocol this build was compiled
   * against.
   *
   * The two are built from one repository and shipped in one installer, so a
   * disagreement is never something a reader configured — it is a build that
   * froze one side and not the other. That happened: `tauri build` rebuilt the
   * frontend and left a two-hour-old engine in place, and the only symptom was
   * a validation error in the middle of a question, naming a field the reader
   * had never heard of. Refusing at boot with a sentence costs one comparison.
   *
   * Both directions are wrong, and neither is recoverable from in the app, so
   * neither gets a "continue anyway": an older engine rejects requests it
   * cannot parse, and a newer one sends events this build cannot read.
   */
  const acceptEngine = useCallback((protocolVersion: number) => {
    if (protocolVersion === PROTOCOL_VERSION) {
      setEngineReady(true);
      return;
    }
    setEngineReady(false);
    setTransportError(
      `This build of Anatria3D speaks protocol ${PROTOCOL_VERSION}, but the ` +
        `engine bundled with it speaks ${protocolVersion}. That is a broken ` +
        `installation rather than anything you did — reinstall from a single ` +
        `release, and if it persists please report it.`,
    );
  }, []);

  useSceneCommands({
    onReady: acceptEngine,
    // The engine boots before the window does, so its `ready` frame — or the
    // reason it never came — is usually already gone by the time we are
    // listening. Asking, once attached, is what makes the composer's enabled
    // state a fact rather than a race.
    onAttached: useCallback(() => {
      void engineStatus().then(
        (status) => {
          // The usual path, not the exception: the engine boots before the
          // window, so its `ready` frame is normally already gone. The version
          // has to be checked from here too, or the check only fires in the
          // rare case where the race was won.
          if (status.ready && status.protocol_version !== null) {
            acceptEngine(status.protocol_version);
          } else if (status.ready) {
            setEngineReady(true);
          } else if (status.error) {
            setTransportError(status.error);
          }
        },
        () => undefined,
      );
    }, [acceptEngine]),
    onTextDelta: useCallback(
      (requestId: string, text: string) => appendDelta(requestId, text),
      [appendDelta],
    ),
    onToolStarted: useCallback(
      (requestId: string, tool: string) => noteTool(requestId, tool),
      [noteTool],
    ),
    onModels: useCallback(
      (requestId: string, modelProvider: AiProvider, models: ModelInfo[]) =>
        receiveModels(modelProvider, requestId, models),
      [receiveModels],
    ),
    onCaseVerdict: useCallback(
      (requestId: string, score: number, verdict: string) => {
        noteScore(requestId, score);
        verdictRef.current.set(requestId, { score, verdict });
      },
      [noteScore],
    ),
    onDone: useCallback(
      (requestId: string, usage: TokenUsage | null, model: string | null) => {
        finishTurn(requestId, usage ?? undefined, model ?? undefined);
        // Saving is best-effort by construction: `studyStore` swallows its own
        // failures, so a broken journal costs the student their history, never
        // the answer they are reading.
        persistTurn(requestId);
        recordSpend(requestId, usage, model);
      },
      [finishTurn, persistTurn, recordSpend],
    ),
    // A frame this build cannot read is not a quiet degradation — it is an
    // answer that arrives looking fine while nothing behind it happens. Said
    // out loud, with the fix, because the only people who can hit it are
    // building from source and the cause is never obvious from the symptom.
    onProtocolViolation: useCallback((_payload: unknown, issues: string) => {
      console.error("[engine] protocol violation", issues);
      setTransportError(
        "The engine sent something this build could not read, so the last " +
          "answer was not filed or counted. If you built from source, rebuild " +
          "the analysis engine — it is probably older than this window.",
      );
    }, []),
    onError: useCallback(
      (code: string, message: string, requestId: string | null) => {
        // The engine reports its own death with no request id. Clearing the
        // ready flag is what surfaces the restart button.
        if (requestId === null && message.includes("stopped unexpectedly")) {
          setEngineReady(false);
        }
        // A failed model check owns its request id; route it to the settings
        // drawer so the badge turns red instead of a phantom chat turn failing.
        if (requestId && useModelStore.getState().providerFor(requestId)) {
          failCheck(requestId, code, message);
          return;
        }
        const turnId = requestId ?? pendingRef.current;
        // Engine-level failures (a dead sidecar) carry no request id, so they
        // cannot be attached to a turn — surface them above the composer.
        if (turnId) {
          failTurn(turnId, `${code}: ${message}`);
          forgetTurn(turnId);
        } else setTransportError(message);
      },
      [failTurn, failCheck, forgetTurn],
    ),
  });

  // Written on every change rather than inside each handler: there is one place
  // to look when a setting stops being remembered, and a control added later is
  // covered without anyone having to remember to wire it up. The model id is not
  // here — `modelStore` owns that half and merges into the same record.
  useEffect(() => {
    patchChatPreferences({ provider, profile, language });
  }, [provider, profile, language]);

  // Follow the stream, but only when the reader is already at the bottom —
  // yanking the view away while they scroll back through an answer is worse
  // than a stale scroll position.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceFromBottom < 120) node.scrollTop = node.scrollHeight;
  }, [messages]);

  // Only the systems actually loaded. Sending the whole manifest would put
  // every structure in the atlas into the prompt on every turn — tens of
  // thousands of tokens for anatomy that is not even on screen.
  const structures = useMemo(
    () => Object.values(organs).filter((organ) => !hiddenSystems.includes(organ.system)),
    [organs, hiddenSystems],
  );
  const loadedSystems = useMemo(
    () => new Set(structures.map((organ) => organ.system)),
    [structures],
  );
  const canSend = engineReady && draft.trim().length > 0 && !pendingRequestId;

  async function send(text?: string) {
    const prompt = (text ?? draft).trim();
    if (!prompt || !engineReady || pendingRequestId) return;

    const requestId = newRequestId();
    const history = useChatStore.getState().history();
    // The whole selection travels, so a question can be about the set.
    const selection = selectedOrganIds
      .map((id) => organs[id])
      .filter((organ) => !!organ)
      .map((organ) => ({
        organ_id: organ.organ_id,
        ta2_latin: organ.ta2_latin,
        name_en: organ.name_en,
        system: organ.system,
      }));

    setDraft("");
    setTransportError(null);
    startTurn(requestId, prompt);
    askedAboutRef.current.set(
      requestId,
      selection.map((organ) => organ.organ_id),
    );
    askedWithRef.current.set(requestId, provider);

    try {
      await askAgent({
        request_id: requestId,
        query: prompt,
        history,
        provider,
        ...(selectedModel ? { model: selectedModel } : {}),
        profile,
        language,
        gender_model: "male",
        mode,
        selection,
        // The engine validates every organ_id the model produces against this
        // list, so its scene tools cannot reference anatomy that is not loaded.
        available_organs: structures.map(({ mesh_file: _f, node: _n, ...meta }) => meta),
        // Who the drill is about, when it is about anyone. Read fresh at send
        // time rather than captured, because the reader can pick a patient
        // between one question and the next.
        ...(mode === "case" || mode === "review"
          ? await virtualPatientContext(
              useChatStore.getState().sessionId,
              (organId) => {
                const organ = useSceneStore.getState().organs[organId];
                return organ ? organLabel(organ) : null;
              },
              mode,
            )
          : {}),
      });
    } catch (err) {
      failTurn(requestId, String(err));
    }
  }

  async function stop() {
    if (!pendingRequestId) return;
    try {
      await cancelRequest(pendingRequestId);
    } finally {
      markCancelled(pendingRequestId);
      forgetTurn(pendingRequestId);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <h1 className="text-sm font-semibold tracking-tight">
          Anatria<span className="text-sky-400">3D</span>
        </h1>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase ${
            engineReady
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {engineReady ? "ready" : "offline"}
        </span>
        {!engineReady && (
          <button
            type="button"
            onClick={() => {
              setTransportError(null);
              void restartEngine().catch((err: unknown) =>
                setTransportError(`Could not restart the engine: ${String(err)}`),
              );
            }}
            className="ml-auto rounded border border-amber-700/60 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
          >
            Restart engine
          </button>
        )}
        <div className={`flex items-center gap-1.5 ${engineReady ? "ml-auto" : ""}`}>
          <NewSessionButton
            mode={mode}
            onStart={beginSession}
            disabled={messages.length === 0}
          />
          <ModeSwitch mode={mode} onChange={beginSession} />
        </div>
      </header>

      {/* Only in case mode: a one-off drill has no patient to belong to, and a
          tutor conversation is not a consultation. */}
      {(mode === "case" || mode === "review") && (
        <CaseBar profile={profile} language={language} />
      )}

      <SettingsDrawer
        provider={provider}
        onProviderChange={setProvider}
        profile={profile}
        onProfileChange={setProfile}
        language={language}
        onLanguageChange={setLanguage}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {messages.length === 0 && mode === "tutor" && (
          <div className="space-y-2 pt-6 text-center text-xs text-slate-500">
            <p>Ask about any structure in the viewport.</p>
            <p className="text-slate-600">
              The assistant moves the camera as it explains.
            </p>
            <p className="text-[10px] text-slate-700">
              {structures.length} structures loaded — switch on more systems in the
              left panel
            </p>
          </div>
        )}

        {messages.length === 0 && mode === "case" && (
          <div className="space-y-3 pt-6 text-center text-xs text-slate-500">
            <p>Pick a scenario, or describe one yourself.</p>
            <p className="text-slate-600">
              You will get a patient, the anatomy marked on the model, and a question
              to answer. Your answer is graded and kept.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 pt-1">
              {CASE_STARTERS.filter((starter) => loadedSystems.has(starter.system)).map(
                (starter) => (
                  <button
                    key={starter.label}
                    type="button"
                    disabled={!engineReady}
                    onClick={() => void send(starter.prompt)}
                    className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-amber-600 hover:text-amber-200 disabled:opacity-30"
                  >
                    {starter.label}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={!engineReady}
                onClick={() =>
                  void send(
                    "Start a case drill on any system currently loaded. " +
                      "Pick something I am unlikely to have practised.",
                  )
                }
                className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-amber-600 hover:text-amber-200 disabled:opacity-30"
              >
                Surprise me
              </button>
            </div>
            <p className="text-[10px] text-slate-700">
              Simulated patients, invented for practice.
            </p>
          </div>
        )}

        {messages.length === 0 && mode === "review" && (
          <ReviewIntro
            disabled={!engineReady}
            onAsk={() =>
              void send(
                "Summarise this case: what was presented, what has been reasoned " +
                  "across the visits, and where the gaps are.",
              )
            }
          />
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      {transportError && (
        <p className="mx-3 mb-2 rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-[11px] text-rose-300">
          {transportError}
        </p>
      )}

      <CostNotice messages={messages} mode={mode} />

      <div className="border-t border-slate-800 p-3">
        <div className="relative">
          <GrowingTextarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line. Composing (IME) must
              // pass through untouched or Cyrillic input would send mid-word.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder={
              !engineReady
                ? "Waiting for the engine…"
                : mode === "review"
                  ? "Ask for the summary, or about anything in the file…"
                  : mode === "case"
                    ? "Answer the case, or ask for a new one…"
                  : "Ask about the anatomy…"
            }
            disabled={!engineReady}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-16 text-[13px] outline-none placeholder:text-slate-600 focus:border-sky-600 disabled:opacity-50"
          />
          {pendingRequestId ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="absolute bottom-2 right-2 rounded bg-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-100"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="absolute bottom-2 right-2 rounded bg-sky-600 px-2.5 py-1 text-[11px] font-medium disabled:opacity-30"
            >
              Send
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-slate-600">
          Educational use only — not for diagnosis or treatment.
        </p>
      </div>
    </div>
  );
}
