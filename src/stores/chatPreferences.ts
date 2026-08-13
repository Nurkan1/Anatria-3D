import {
  AiProviderSchema,
  LanguageSchema,
  UserProfileSchema,
  type AiProvider,
  type Language,
  type UserProfile,
} from "@/lib/schemas";

/**
 * The assistant settings worth carrying between sessions.
 *
 * Same line as `viewPreferences`: **configuration, not working state.** Which
 * provider you use, which model of it, who the answers are pitched at and what
 * language they come back in are all decisions someone made once about how they
 * want to work. Re-making them at every launch is not a neutral cost — a student
 * who set Claude and Spanish and opens the app to find Gemini and Bulgarian has
 * to notice the difference before their first question, and the one who does not
 * notice gets an answer in the wrong language and blames the app.
 *
 * The transcript is emphatically *not* in here. That has its own identity in the
 * study journal and is reopened deliberately, never restored behind your back.
 *
 * `localStorage` rather than the Tauri store, for the reason the panel widths
 * use it: it reads synchronously, so the first render is already correct and
 * there is no frame where the settings drawer shows the default provider before
 * flicking to the real one.
 *
 * # No key material, ever
 *
 * Only the *choice* is stored here. API keys live in the operating system's
 * credential manager and never enter this context — a provider name in
 * `localStorage` says nothing a reader of that file did not already know from
 * the presence of the app.
 */

const STORAGE_KEY = "anatria3d.chat.v1";

export interface ChatPreferences {
  provider: AiProvider;
  profile: UserProfile;
  language: Language;
  /**
   * The last model explicitly chosen, per provider.
   *
   * Per provider rather than one field, because switching provider and back
   * should return you to where you were rather than to that provider's default.
   * A stored id is a *preference*, not a promise: the catalogue is re-fetched at
   * boot and `modelStore` drops any id the key can no longer reach, so a model
   * retired by the provider degrades to their recommendation instead of failing
   * the first question with a 404.
   */
  model: Partial<Record<AiProvider, string>>;
  /**
   * Whether the settings drawer is expanded.
   *
   * Remembered because the drawer can open itself — it does so when the chosen
   * provider has no key, which is the one moment a new reader needs to see the
   * key field — but nothing ever closed it again. That made auto-open a
   * one-way door: a single transient "no key" (the keyring reports absence for
   * *any* failed read, including a lock that clears a second later) left the
   * panel expanded for the rest of the session, and the reader collapsing it
   * had no effect on the next launch.
   *
   * Only an explicit press is stored. The automatic open stays transient, so
   * it can still help once without overriding a decision.
   */
  settingsOpen: boolean;
}

/**
 * Gemini Flash Lite, student, Bulgarian.
 *
 * The provider default is the cheapest capable one on purpose: the first
 * question a new reader asks should not be an expensive one, and this is an
 * atlas given to students who are paying for their own key.
 */
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  provider: "google",
  profile: "student",
  language: "bg",
  model: {},
  settingsOpen: false,
};

/**
 * Turn whatever was in storage into something safe to apply.
 *
 * Field by field, so one unreadable entry costs you that entry and not the rest.
 * A build that renames a provider would otherwise strand the whole file and
 * silently reset a reader's language too, which is a much louder failure than
 * the one it is recovering from.
 */
export function sanitiseChatPreferences(raw: unknown): Partial<ChatPreferences> {
  if (typeof raw !== "object" || raw === null) return {};
  const stored = raw as Record<string, unknown>;
  const clean: Partial<ChatPreferences> = {};

  const provider = AiProviderSchema.safeParse(stored.provider);
  if (provider.success) clean.provider = provider.data;

  const profile = UserProfileSchema.safeParse(stored.profile);
  if (profile.success) clean.profile = profile.data;

  const language = LanguageSchema.safeParse(stored.language);
  if (language.success) clean.language = language.data;

  if (typeof stored.settingsOpen === "boolean") clean.settingsOpen = stored.settingsOpen;

  if (typeof stored.model === "object" && stored.model !== null) {
    const model: Partial<Record<AiProvider, string>> = {};
    for (const [key, value] of Object.entries(stored.model)) {
      const known = AiProviderSchema.safeParse(key);
      if (!known.success) continue;
      if (typeof value !== "string" || value.trim().length === 0) continue;
      model[known.data] = value;
    }
    clean.model = model;
  }

  return clean;
}

/** The raw stored value, or null. Parsing failures are treated as absence. */
export function readStoredChat(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The snapshot every reader shares.
 *
 * Held in memory because two independent owners write to this file — the panel
 * owns provider, audience and language, `modelStore` owns the model map — and a
 * read-modify-write against `localStorage` from each of them would let whichever
 * wrote last erase the other's field. They both merge into this instead.
 */
let current: ChatPreferences = {
  ...DEFAULT_CHAT_PREFERENCES,
  ...sanitiseChatPreferences(readStoredChat()),
};

export function chatPreferences(): ChatPreferences {
  return current;
}

/** Merge a change in and persist the whole record. */
export function patchChatPreferences(change: Partial<ChatPreferences>): void {
  current = { ...current, ...change };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // A full or disabled store costs the reader their choice next launch, which
    // is not worth interrupting this session for.
  }
}

/** Remember the model chosen for one provider, leaving the others alone. */
export function rememberModel(provider: AiProvider, modelId: string): void {
  patchChatPreferences({ model: { ...current.model, [provider]: modelId } });
}

/** Reload from storage. Tests only — production reads the snapshot once. */
export function reloadChatPreferences(): void {
  current = { ...DEFAULT_CHAT_PREFERENCES, ...sanitiseChatPreferences(readStoredChat()) };
}
