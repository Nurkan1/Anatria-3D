import { create } from "zustand";

import { readLocal, writeLocal } from "@/lib/localStore";
import type { LocalModelInfo } from "@/lib/schemas";

/**
 * The local chat: a conversation with a model in Ollama on this computer.
 * See `engine/anatria_engine/local_chat.py` for what it can and cannot do.
 *
 * # What is remembered
 *
 * The chosen model, because picking it again every launch is friction and a
 * model name is not sensitive. Not the conversation: it lives for the session.
 * The study journal files every conversation under a kind — tutor or case —
 * and a third kind is a schema migration on the reader's own journal, which a
 * build of this branch would apply to the same file the released app opens.
 * That is not something an experiment gets to do.
 */

const MODEL_KEY = "anatria.localChat.model";

export interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  /** Why it failed, in words the reader can act on. */
  error?: string;
  /** The model that answered, as the engine reported it: `ollama:<name>`. */
  model?: string;
}

/** Whether Ollama answered on this computer, as of the last check. */
export type OllamaStatus = "unknown" | "checking" | "running" | "absent" | "error";

interface LocalChatState {
  open: boolean;
  model: string | null;
  models: LocalModelInfo[];
  status: OllamaStatus;
  statusDetail: string | null;
  messages: LocalMessage[];
  /** The turn in flight, if any. */
  pendingId: string | null;
  setOpen: (open: boolean) => void;
  setModel: (model: string) => void;
  receiveModels: (running: boolean, models: LocalModelInfo[]) => void;
  setStatus: (status: OllamaStatus, detail?: string | null) => void;
  begin: (requestId: string, question: string) => void;
  append: (requestId: string, text: string) => void;
  finish: (requestId: string, model: string | null) => void;
  fail: (requestId: string, error: string) => void;
  clear: () => void;
}

/**
 * The model to preselect: the one chosen before if Ollama still has it, else
 * the first that is not a coding model — those answer anatomy badly and only
 * sort first by name.
 */
export function preferredModel(models: readonly LocalModelInfo[], remembered: string | null): string | null {
  if (remembered && models.some((model) => model.name === remembered)) return remembered;
  const general = models.find((model) => !/coder|code\b/i.test(model.name));
  return (general ?? models[0])?.name ?? null;
}

export const useLocalChatStore = create<LocalChatState>()((set) => ({
  open: false,
  model: readLocal(MODEL_KEY),
  models: [],
  status: "unknown",
  statusDetail: null,
  messages: [],
  pendingId: null,
  setOpen: (open) => set({ open }),
  setModel: (model) => {
    writeLocal(MODEL_KEY, model);
    set({ model });
  },
  receiveModels: (running, models) =>
    set((state) => ({
      models,
      status: running ? "running" : "absent",
      statusDetail: null,
      model: preferredModel(models, state.model),
    })),
  setStatus: (status, detail = null) => set({ status, statusDetail: detail }),
  begin: (requestId, question) =>
    set((state) => ({
      pendingId: requestId,
      messages: [
        ...state.messages,
        { id: `${requestId}:q`, role: "user", content: question, status: "done" },
        { id: requestId, role: "assistant", content: "", status: "streaming" },
      ],
    })),
  append: (requestId, text) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === requestId ? { ...message, content: message.content + text } : message,
      ),
    })),
  finish: (requestId, model) =>
    set((state) => ({
      pendingId: state.pendingId === requestId ? null : state.pendingId,
      messages: state.messages.map((message) =>
        message.id === requestId ? { ...message, status: "done", ...(model ? { model } : {}) } : message,
      ),
    })),
  fail: (requestId, error) =>
    set((state) => ({
      pendingId: state.pendingId === requestId ? null : state.pendingId,
      messages: state.messages.map((message) =>
        // A refused answer is not shown: it may have been written without the
        // safety rules (a truncated prompt) or be half an answer.
        message.id === requestId ? { ...message, status: "error", content: "", error } : message,
      ),
    })),
  clear: () => set({ messages: [], pendingId: null }),
}));
