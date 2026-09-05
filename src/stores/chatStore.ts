import { create } from "zustand";

import type { SceneCommand, SessionMode, TokenUsage } from "@/lib/schemas";
import type { SessionDetail } from "@/lib/studyDb";

/**
 * Conversation state for the assistant panel.
 *
 * Kept apart from `sceneStore` on purpose: the scene is what the viewport
 * shows, this is what was said. They are updated by the same stream of engine
 * events but have different lifetimes — clearing the conversation must not
 * reset the camera, and reframing the model must not erase the transcript.
 *
 * The transcript also has an identity now. `sessionId` is what the study
 * journal files each turn under, so a conversation can be reopened weeks later
 * with its questions, its answers and the structures it covered intact.
 */

export type MessageStatus = "streaming" | "complete" | "cancelled" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Scene tools invoked during this turn, in call order, for the activity trail. */
  tools: string[];
  /**
   * The scene commands this answer actually applied, in the order it applied
   * them — enough to put the model back the way it left it.
   *
   * The trail above says *what* happened and is what the reader reads; this is
   * the payload behind it, and the difference matters: a name cannot be
   * replayed, a command can. Recorded only once the viewport has applied it, so
   * nothing here claims a change that did not happen.
   *
   * Every action is absolute rather than a toggle — `focus_organ X`,
   * `isolate_structures [...]` — so replaying the sequence from whatever the
   * scene looks like now reproduces the same end state. `add_supply` is the one
   * that adds to what is already isolated; on an unchanged scene it still lands
   * where it did.
   */
  commands?: SceneCommand[];
  status: MessageStatus;
  error?: string;
  usage?: TokenUsage;
  /**
   * The model that produced this answer, defaults resolved by the engine.
   *
   * Recorded per message rather than read from the settings drawer, because the
   * point of showing it is comparison: a transcript where two answers came from
   * two different models has to say so, and the drawer only ever knows what is
   * selected *now*.
   *
   * Stored in the journal and restored on reopening. Absent only where it
   * genuinely is not known: an answer written before the journal recorded it.
   * Nothing is backfilled — a guessed model name would look like a fact.
   */
  model?: string;
  /** Set on the assistant turn that graded a case drill. */
  score?: number;
}

/** One completed exchange, in the shape the journal stores. */
export interface CompletedTurn {
  question: string;
  answer: string;
  /** Which model wrote the answer, and what it cost. Absent if unreported. */
  model?: string;
  usage?: TokenUsage;
}

interface ChatStore {
  messages: ChatMessage[];
  /** The in-flight request, or null when idle. Also gates the stop button. */
  pendingRequestId: string | null;
  /** Journal identity of this conversation. */
  sessionId: string;
  /** Lesson or clinical drill. A session is one or the other for its lifetime. */
  mode: SessionMode;

  startTurn: (requestId: string, prompt: string) => void;
  appendDelta: (requestId: string, text: string) => void;
  noteTool: (requestId: string, tool: string) => void;
  /** Record a command the viewport has applied, against the turn that sent it. */
  noteCommand: (requestId: string, command: SceneCommand) => void;
  finishTurn: (requestId: string, usage?: TokenUsage, model?: string) => void;
  failTurn: (requestId: string, message: string) => void;
  markCancelled: (requestId: string) => void;
  noteScore: (requestId: string, score: number) => void;

  /** Start a fresh conversation in `mode`, abandoning the current transcript. */
  beginSession: (mode: SessionMode) => void;
  /** Reopen a conversation from the journal, read-only history and all. */
  loadSession: (detail: SessionDetail) => void;

  /** The finished exchange for a request, for the journal. */
  turn: (requestId: string) => CompletedTurn | null;
  /** Prior turns for the next request: complete turns only, oldest first. */
  history: () => { role: "user" | "assistant"; content: string }[];
}

let counter = 0;
const nextId = () => `m${++counter}`;

const newSessionId = () => crypto.randomUUID();

/** Apply a change to the assistant message of a turn, ignoring stale requests. */
function updateAssistant(
  messages: ChatMessage[],
  requestId: string,
  change: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  let touched = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant" || message.id !== `a:${requestId}`) return message;
    touched = true;
    return change(message);
  });
  // A late event from a turn the user already cleared has nothing to update.
  // Dropping it beats resurrecting a message into an empty transcript.
  return touched ? next : messages;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  messages: [],
  pendingRequestId: null,
  sessionId: newSessionId(),
  mode: "tutor",

  startTurn: (requestId, prompt) =>
    set((state) => ({
      pendingRequestId: requestId,
      messages: [
        ...state.messages,
        // Both halves are keyed by request id so out-of-order engine events
        // always find the right message, and so the journal can pair the
        // question with its answer without counting positions.
        {
          id: `u:${requestId}`,
          role: "user",
          content: prompt,
          tools: [],
          status: "complete",
        },
        {
          id: `a:${requestId}`,
          role: "assistant",
          content: "",
          tools: [],
          status: "streaming",
        },
      ],
    })),

  appendDelta: (requestId, text) =>
    set((state) => ({
      messages: updateAssistant(state.messages, requestId, (message) => ({
        ...message,
        content: message.content + text,
      })),
    })),

  noteTool: (requestId, tool) =>
    set((state) => ({
      messages: updateAssistant(state.messages, requestId, (message) => ({
        ...message,
        tools: [...message.tools, tool],
      })),
    })),

  noteCommand: (requestId, command) =>
    set((state) => ({
      messages: updateAssistant(state.messages, requestId, (message) => ({
        ...message,
        commands: [...(message.commands ?? []), command],
      })),
    })),

  finishTurn: (requestId, usage, model) =>
    set((state) => ({
      pendingRequestId: state.pendingRequestId === requestId ? null : state.pendingRequestId,
      messages: updateAssistant(state.messages, requestId, (message) => ({
        ...message,
        status: message.status === "streaming" ? "complete" : message.status,
        // Spread conditionally so a `done` carrying neither — the frame that
        // closes a model-list request — cannot blank out a real one.
        ...(usage ? { usage } : {}),
        ...(model ? { model } : {}),
      })),
    })),

  failTurn: (requestId, message) =>
    set((state) => ({
      pendingRequestId: state.pendingRequestId === requestId ? null : state.pendingRequestId,
      messages: updateAssistant(state.messages, requestId, (entry) => ({
        ...entry,
        status: "error",
        error: message,
      })),
    })),

  markCancelled: (requestId) =>
    set((state) => ({
      pendingRequestId: state.pendingRequestId === requestId ? null : state.pendingRequestId,
      messages: updateAssistant(state.messages, requestId, (message) => ({
        ...message,
        status: "cancelled",
      })),
    })),

  noteScore: (requestId, score) =>
    set((state) => ({
      messages: updateAssistant(state.messages, requestId, (message) => ({
        ...message,
        score,
      })),
    })),

  beginSession: (mode) =>
    set({ messages: [], pendingRequestId: null, sessionId: newSessionId(), mode }),

  loadSession: (detail) =>
    set({
      pendingRequestId: null,
      sessionId: detail.session.id,
      mode: detail.session.kind,
      // Reopened turns carry no request id, so they are keyed by position.
      // Nothing can stream into them — they are finished by definition.
      //
      // Provenance comes back with them. An answer that said which model wrote
      // it while it was on screen and then went blank on reopening was the
      // journal quietly forgetting, not a deliberate silence: a student
      // comparing two models across a week's sessions needs it most at exactly
      // the moment they come back to them.
      messages: detail.messages.map((message) => ({
        id: nextId(),
        role: message.role,
        content: message.content,
        tools: [],
        status: "complete" as const,
        ...(message.model ? { model: message.model } : {}),
        ...(message.input_tokens !== null && message.output_tokens !== null
          ? {
              usage: {
                input_tokens: message.input_tokens,
                output_tokens: message.output_tokens,
                // Null in the journal means the turn predates the column, and
                // zero is how that reads downstream: nothing is *known* to
                // have been cached. The alternative would be to leave the
                // whole usage record off, which would hide counts the reader
                // does have because of one they do not.
                cache_read_tokens: message.cache_read_tokens ?? 0,
              },
            }
          : {}),
      })),
    }),

  turn: (requestId) => {
    const messages = get().messages;
    const question = messages.find((message) => message.id === `u:${requestId}`);
    const answer = messages.find((message) => message.id === `a:${requestId}`);
    if (!question || !answer) return null;
    // A failed or cancelled turn is not worth filing: the journal would fill
    // with half-answers that read as gaps in the student's own understanding.
    if (answer.status !== "complete" || answer.content.trim().length === 0) return null;
    return {
      question: question.content,
      answer: answer.content,
      ...(answer.model ? { model: answer.model } : {}),
      ...(answer.usage ? { usage: answer.usage } : {}),
    };
  },

  history: () =>
    get()
      .messages.filter(
        (message) => message.status === "complete" && message.content.trim().length > 0,
      )
      .map((message) => ({ role: message.role, content: message.content })),
}));
