import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/features/chat/Markdown";
import { askLocal, cancelRequest, listLocalModels, newRequestId, onEngineEvent } from "@/lib/ipc";
import type { ChatTurn, GenderModel, Language, OrganContext, UserProfile } from "@/lib/schemas";
import { useLocalChatStore, type LocalMessage } from "@/stores/localChatStore";
import { useSceneStore } from "@/stores/sceneStore";

import { latinIndex, mentionedStructures, type Mention } from "./mentions";

/**
 * A conversation with a model running in Ollama on this computer.
 *
 * # Its own screen
 *
 * Over the assistant's panel rather than inside it, opened from a button beside
 * Tutor and Case drill: the tutor's conversation stays exactly where it was
 * underneath, and settings — already the most crowded place in the app — gain
 * nothing. It stays mounted while hidden, so an answer still streaming when the
 * reader goes back to the tutor is not lost.
 *
 * # What it promises, on its face
 *
 * That nothing leaves the computer, that it cannot move the atlas, that small
 * local models make more mistakes, and that it is not saved. Each is true by
 * construction — see `engine/anatria_engine/local_chat.py` — and each is said
 * where the reader types, not in a tooltip.
 */

const LOCAL_PREFIX = "local-";

/** Gigabytes, one decimal: a fair guide to the memory a model will take. */
function gigabytes(bytes: number | null | undefined): string | null {
  return typeof bytes === "number" ? `${(bytes / 1e9).toFixed(1)} GB` : null;
}

function history(messages: readonly LocalMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const question = messages[i]!;
    const answer = messages[i + 1]!;
    if (question.role === "user" && answer.role === "assistant" && answer.status === "done") {
      turns.push({ role: "user", content: question.content });
      turns.push({ role: "assistant", content: answer.content });
    }
  }
  return turns.slice(-100);
}

export function LocalChatPanel({
  open,
  engineReady,
  profile,
  language,
  genderModel,
}: {
  open: boolean;
  engineReady: boolean;
  profile: UserProfile;
  language: Language;
  genderModel: GenderModel;
}) {
  const store = useLocalChatStore();
  const { model, models, status, statusDetail, messages, pendingId } = store;
  const organs = useSceneStore((s) => s.organs);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The model check in flight, so its answer is recognised. */
  const modelsRequest = useRef<string | null>(null);

  // Only structures on screen can be shown; a button for a hidden system would do nothing.
  const index = useMemo(
    () => latinIndex(Object.values(organs).filter((organ) => !hiddenSystems.includes(organ.system))),
    [organs, hiddenSystems],
  );

  // Listening starts the first time the screen opens and then stays on, so an
  // answer still streaming when the reader goes back to the tutor is not lost —
  // and a reader who never opens it costs nothing: no second subscription on
  // the engine's channel beside the tutor's one.
  const [armed, setArmed] = useState(false);
  /** True once the subscription is attached — nothing may be asked before then. */
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (open) setArmed(true);
  }, [open]);

  // Answers arrive on the engine's one channel; this panel takes only its own.
  useEffect(() => {
    if (!armed) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void onEngineEvent((event) => {
      if (!("request_id" in event) || typeof event.request_id !== "string") return;
      const id = event.request_id;
      if (!id.startsWith(LOCAL_PREFIX)) return;
      const state = useLocalChatStore.getState();
      switch (event.type) {
        case "local_models":
          if (id === modelsRequest.current) state.receiveModels(event.running, event.models);
          break;
        case "text_delta":
          if (id === state.pendingId) state.append(id, event.text);
          break;
        case "done":
          if (id === state.pendingId) state.finish(id, event.model);
          break;
        case "error":
          if (id === modelsRequest.current) state.setStatus("error", event.message);
          else if (id === state.pendingId) state.fail(id, event.message);
          break;
      }
    }).then((off) => {
      if (cancelled) {
        off();
        return;
      }
      stop = off;
      // Only now: a request sent before the listener is attached can be
      // answered before it is, and a local Ollama answers in milliseconds.
      setListening(true);
    });
    return () => {
      cancelled = true;
      stop?.();
      setListening(false);
    };
  }, [armed]);

  const checkModels = () => {
    const id = `${LOCAL_PREFIX}models-${newRequestId()}`;
    modelsRequest.current = id;
    useLocalChatStore.getState().setStatus("checking");
    void listLocalModels({ request_id: id }).catch((err: unknown) =>
      useLocalChatStore.getState().setStatus("error", String(err)),
    );
  };

  // Ask Ollama what it has each time the screen opens: models come and go.
  useEffect(() => {
    if (open && engineReady && listening) checkModels();
  }, [open, engineReady, listening]);

  // Follow the stream when the reader is already at the bottom.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 120) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const ready = listening && engineReady && status === "running" && model !== null;
  const canSend = ready && draft.trim().length > 0 && pendingId === null;

  const send = () => {
    const question = draft.trim();
    if (!canSend || !model) return;
    const id = `${LOCAL_PREFIX}${newRequestId()}`;
    const selection: OrganContext[] = selectedOrganIds
      .map((organId) => organs[organId])
      .filter((organ) => !!organ)
      .slice(0, 64)
      .map(({ organ_id, ta2_latin, name_en, system }) => ({ organ_id, ta2_latin, name_en, system }));
    const past = history(messages);
    store.begin(id, question);
    setDraft("");
    void askLocal({
      request_id: id,
      query: question.slice(0, 8000),
      history: past,
      model,
      profile,
      language,
      gender_model: genderModel,
      selection,
    }).catch((err: unknown) => useLocalChatStore.getState().fail(id, String(err)));
  };

  const stop = () => {
    if (!pendingId) return;
    void cancelRequest(pendingId);
    store.fail(pendingId, "Stopped.");
  };

  const show = (mention: Mention) => {
    const apply = useSceneStore.getState().applyCommand;
    apply({ action: "isolate_structures", organ_ids: mention.organIds.slice(0, 64) });
    apply({ action: "focus_organ", organ_id: mention.organIds[0]! });
  };

  return (
    <section
      aria-label="Local model"
      aria-hidden={!open}
      className={open ? "absolute inset-0 z-20 flex flex-col bg-slate-950" : "hidden"}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-800 px-3 py-2">
        <button
          type="button"
          onClick={() => store.setOpen(false)}
          className="whitespace-nowrap rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-sky-700 hover:text-sky-200"
          title="Back to the tutor — its conversation is where you left it"
        >
          ← Tutor
        </button>
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">Local</h2>
        <span className="whitespace-nowrap rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-violet-300">
          on this computer
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <label className="sr-only" htmlFor="local-model">Local model</label>
          <select
            id="local-model"
            value={model ?? ""}
            disabled={models.length === 0 || pendingId !== null}
            onChange={(event) => store.setModel(event.target.value)}
            className="min-w-0 max-w-40 truncate rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200 disabled:opacity-50"
          >
            {models.length === 0 && <option value="">No model</option>}
            {models.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {[entry.name, entry.parameter_size, gigabytes(entry.size_bytes)].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={checkModels}
            disabled={!listening || !engineReady || status === "checking"}
            className="whitespace-nowrap rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
            title="Ask Ollama again which models it has"
          >
            {status === "checking" ? "Checking…" : "Check"}
          </button>
          <button
            type="button"
            onClick={store.clear}
            disabled={messages.length === 0 || pendingId !== null}
            className="whitespace-nowrap rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
          >
            New
          </button>
        </div>
      </header>

      <StatusLine engineReady={engineReady} status={status} detail={statusDetail} empty={models.length === 0} />

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="mx-auto max-w-sm space-y-2 pt-6 text-center text-xs text-slate-500">
            <p className="text-slate-300">Chat with a model running in Ollama on this computer.</p>
            <p>Nothing you write here is sent anywhere else, and no key is needed.</p>
            <p>
              Words only — it cannot move the atlas. When it names a structure the atlas has, a
              button appears under the answer to show it.
            </p>
            <p className="text-amber-300/80">
              Local models make more mistakes than the large ones. Check anything that matters.
            </p>
            <p className="text-[10px] text-slate-600">Not saved to your journal.</p>
          </div>
        )}
        {messages.map((message) => (
          <LocalBubble key={message.id} message={message} index={index} onShow={show} />
        ))}
      </div>

      <div className="border-t border-slate-800 p-2">
        <div className="flex items-end gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-2 focus-within:border-violet-700">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={8000}
            disabled={!ready}
            placeholder={ready ? "Ask the local model…" : "Waiting for Ollama…"}
            className="min-h-10 flex-1 resize-none bg-transparent text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
          />
          {pendingId ? (
            <button
              type="button"
              onClick={stop}
              className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="rounded bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-500 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
        <p className="mt-1 text-[10px] text-slate-600">
          Educational use only — not for diagnosis or treatment. Runs in Ollama on this computer.
        </p>
      </div>
    </section>
  );
}

function StatusLine({
  engineReady,
  status,
  detail,
  empty,
}: {
  engineReady: boolean;
  status: string;
  detail: string | null;
  empty: boolean;
}) {
  let text: string | null = null;
  if (!engineReady) text = "The engine is not running — restart it from the tutor's panel.";
  else if (status === "absent")
    text = "Ollama is not running on this computer. Start it, then press Check.";
  else if (status === "error") text = detail ?? "Ollama could not be asked for its models.";
  else if (status === "running" && empty)
    text = "Ollama has no chat model yet. Pull one — for example: ollama pull gemma3:4b — then press Check.";
  if (!text) return null;
  return (
    <p role="status" className="border-b border-amber-900/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
      {text}
    </p>
  );
}

function LocalBubble({
  message,
  index,
  onShow,
}: {
  message: LocalMessage;
  index: ReadonlyMap<string, Mention>;
  onShow: (mention: Mention) => void;
}) {
  const mentions = useMemo(
    () => (message.role === "assistant" && message.status === "done" ? mentionedStructures(message.content, index) : []),
    [message.role, message.status, message.content, index],
  );

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-violet-600/20 px-3 py-2 text-[13px] text-slate-100">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.status === "error") {
    return (
      <div className="rounded-lg rounded-bl-sm border border-amber-900/50 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
        {message.error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-lg rounded-bl-sm bg-slate-900/70 px-3 py-2">
        {message.content.trim().length === 0 ? (
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
        {mentions.length > 0 && (
          <div className="mt-2 border-t border-slate-800 pt-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Show in the atlas</p>
            <div className="flex flex-wrap gap-1">
              {mentions.map((mention) => (
                <button
                  key={mention.latin}
                  type="button"
                  onClick={() => onShow(mention)}
                  className="rounded-full border border-violet-800/70 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200 hover:border-violet-500 hover:bg-violet-500/20"
                  title={`Isolate ${mention.latin} in the atlas`}
                >
                  {mention.latin}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {message.model && (
        <p className="text-[10px] text-slate-600">{message.model.replace(/^ollama:/, "")} · on this computer</p>
      )}
    </div>
  );
}
