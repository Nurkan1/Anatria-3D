import { create } from "zustand";

import type { AiProvider, ModelInfo } from "@/lib/schemas";
import { chatPreferences, rememberModel } from "@/stores/chatPreferences";

/**
 * Per-provider model catalogue and the user's choice.
 *
 * The catalogue is fetched from the provider with the stored key, which makes
 * this the key-validation path too: a credential that cannot list models cannot
 * answer questions either, so there is no separate "test key" button that could
 * pass while real requests fail.
 *
 * # Why the choice survives a restart but the catalogue does not
 *
 * The chosen model id is restored from `chatPreferences` at boot; the list of
 * models is not. The two have different truth: what someone picked is a fact
 * about them and cannot go stale, whereas what a key can reach is a fact about
 * the provider today and absolutely can. Restoring a cached catalogue would
 * offer models a rotated key no longer reaches — so the list is always fetched
 * fresh, and `receiveModels` is where the restored id meets reality and is
 * either kept or quietly replaced by the recommendation.
 */

export type KeyStatus = "unknown" | "checking" | "valid" | "invalid" | "error";

interface ProviderState {
  models: ModelInfo[];
  selected: string | null;
  status: KeyStatus;
  message?: string;
  /** Correlates the in-flight list request with its events. */
  requestId?: string;
}

const EMPTY: ProviderState = { models: [], selected: null, status: "unknown" };

/** A blank slate for `provider`, carrying whatever model it was last set to. */
function pending(provider: AiProvider): ProviderState {
  return { ...EMPTY, selected: chatPreferences().model[provider] ?? null };
}

/**
 * Restored choices, with the status left at `unknown` so the settings drawer
 * still fetches — and therefore still validates the key — on the first render.
 */
export function restoredCatalogue(): Partial<Record<AiProvider, ProviderState>> {
  const byProvider: Partial<Record<AiProvider, ProviderState>> = {};
  for (const provider of Object.keys(chatPreferences().model) as AiProvider[]) {
    byProvider[provider] = pending(provider);
  }
  return byProvider;
}

interface ModelStore {
  byProvider: Partial<Record<AiProvider, ProviderState>>;

  get: (provider: AiProvider) => ProviderState;
  beginCheck: (provider: AiProvider, requestId: string) => void;
  receiveModels: (provider: AiProvider, requestId: string, models: ModelInfo[]) => void;
  failCheck: (requestId: string, code: string, message: string) => void;
  select: (provider: AiProvider, modelId: string) => void;
  reset: (provider: AiProvider) => void;
  /** The provider a given request id belongs to, if any is in flight. */
  providerFor: (requestId: string) => AiProvider | null;
}

export const useModelStore = create<ModelStore>()((set, get) => ({
  byProvider: restoredCatalogue(),

  get: (provider) => get().byProvider[provider] ?? EMPTY,

  beginCheck: (provider, requestId) =>
    set((state) => ({
      byProvider: {
        ...state.byProvider,
        [provider]: {
          ...(state.byProvider[provider] ?? EMPTY),
          status: "checking",
          requestId,
          message: undefined,
        },
      },
    })),

  receiveModels: (provider, requestId, models) =>
    set((state) => {
      const current = state.byProvider[provider] ?? EMPTY;
      // A stale response — the user switched provider and back — must not
      // overwrite a newer catalogue.
      if (current.requestId && current.requestId !== requestId) return state;

      // Only a model the engine actually vouches for. Falling back to the
      // first entry of the list was the same unsafe guess `_finish` used to
      // make on the Python side, and fixing it there while leaving it here
      // would have changed nothing: the catalogue is sorted by id, so "first"
      // is whichever name happens to sort highest, not whichever works.
      const recommended = models.find((model) => model.recommended)?.id ?? null;
      // Keep an explicit choice if that model still exists; otherwise take the
      // recommendation, and null when there is none — an empty picker the
      // reader must answer beats a silent switch to something untested.
      const keep =
        current.selected && models.some((model) => model.id === current.selected)
          ? current.selected
          : recommended;

      return {
        byProvider: {
          ...state.byProvider,
          [provider]: {
            models,
            selected: keep,
            status: "valid",
            requestId: undefined,
          },
        },
      };
    }),

  failCheck: (requestId, code, message) =>
    set((state) => {
      const entry = Object.entries(state.byProvider).find(
        ([, value]) => value?.requestId === requestId,
      );
      if (!entry) return state;
      const [provider, value] = entry as [AiProvider, ProviderState];
      return {
        byProvider: {
          ...state.byProvider,
          [provider]: {
            ...value,
            status: code === "invalid_api_key" ? "invalid" : "error",
            message,
            requestId: undefined,
          },
        },
      };
    }),

  select: (provider, modelId) => {
    rememberModel(provider, modelId);
    set((state) => ({
      byProvider: {
        ...state.byProvider,
        [provider]: { ...(state.byProvider[provider] ?? EMPTY), selected: modelId },
      },
    }));
  },

  // The remembered id deliberately survives this. `reset` runs when a key is
  // replaced as well as when one is removed, and rotating a credential is not a
  // reason to lose the model you work with — if the new key still reaches it,
  // `receiveModels` puts it straight back.
  reset: (provider) =>
    set((state) => ({ byProvider: { ...state.byProvider, [provider]: pending(provider) } })),

  providerFor: (requestId) => {
    const entry = Object.entries(get().byProvider).find(
      ([, value]) => value?.requestId === requestId,
    );
    return entry ? (entry[0] as AiProvider) : null;
  },
}));
