import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatTokens, totalTokens } from "@/features/usage/tokens";
import { useSceneCommands } from "@/features/viewer/useSceneCommands";
import {
  askAgent,
  cancelRequest,
  engineStatus,
  newRequestId,
  restartEngine,
} from "@/lib/ipc";
import type {
  AiProvider,
  AnatomicalSystem,
  Language,
  ModelInfo,
  SessionMode,
  TokenUsage,
  UserProfile,
} from "@/lib/schemas";
import { useChatStore, type ChatMessage } from "@/stores/chatStore";
import { chatPreferences, patchChatPreferences } from "@/stores/chatPreferences";
import { useModelStore } from "@/stores/modelStore";
import { organLabel, useSceneStore } from "@/stores/sceneStore";
import { useStudyStore } from "@/stores/studyStore";
import { useUsageStore } from "@/stores/usageStore";

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
            <span className="italic">{organ.ta2_latin}</span>
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
 * Lesson or drill, and the way to start a fresh conversation.
 *
 * The two are one control because a session is one or the other for its whole
 * life — the journal files it under a single kind, and a transcript that is
 * half explanation and half graded drill is not something either view can
 * present honestly. Pressing the mode you are already in starts a new session
 * of it, which is what the old "New chat" button did.
 */
function ModeSwitch({
  mode,
  onChange,
  dirty,
}: {
  mode: SessionMode;
  onChange: (mode: SessionMode) => void;
  dirty: boolean;
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
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={
              active
                ? dirty
                  ? `Start a new ${option.label.toLowerCase()} session`
                  : option.label
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
      })
      // Strictly after the turn, and only if it landed: the session row is
      // created by that save, so grading a failed one would raise a second,
      // unrelated error about a session that was never written.
      .then((saved) => {
        if (saved && grade) {
          void study.recordVerdict(chat.sessionId, grade.score, grade.verdict);
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

  useSceneCommands({
    onReady: useCallback(() => setEngineReady(true), []),
    // The engine boots before the window does, so its `ready` frame — or the
    // reason it never came — is usually already gone by the time we are
    // listening. Asking, once attached, is what makes the composer's enabled
    // state a fact rather than a race.
    onAttached: useCallback(() => {
      void engineStatus().then(
        (status) => {
          if (status.ready) setEngineReady(true);
          else if (status.error) setTransportError(status.error);
        },
        () => undefined,
      );
    }, []),
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
        <div className={engineReady ? "ml-auto" : ""}>
          <ModeSwitch
            mode={mode}
            onChange={beginSession}
            dirty={messages.length > 0}
          />
        </div>
      </header>

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
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      {transportError && (
        <p className="mx-3 mb-2 rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-[11px] text-rose-300">
          {transportError}
        </p>
      )}

      <div className="border-t border-slate-800 p-3">
        <div className="relative">
          <textarea
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
                : mode === "case"
                  ? "Answer the case, or ask for a new one…"
                  : "Ask about the anatomy…"
            }
            disabled={!engineReady}
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-16 text-[13px] outline-none placeholder:text-slate-600 focus:border-sky-600 disabled:opacity-50"
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
