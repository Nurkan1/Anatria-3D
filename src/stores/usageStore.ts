import { create } from "zustand";

import type { Grain } from "@/features/usage/aggregate";
import { recordTokenUsage, tokenUsage, type UsageBucket, type UsageInput } from "@/lib/studyDb";

/**
 * What the assistant has cost, as the consumption panel sees it.
 *
 * Same rule as the study journal: **this never throws into the rest of the
 * app.** A failed write records itself and returns. Accounting is the least
 * important thing in the application — a reader whose database is locked should
 * lose their spend history, never their answer.
 *
 * Kept apart from `studyStore` deliberately. That store is about what someone
 * learned and is theirs to curate: they rename sessions, delete them, export
 * them. This one is a ledger, and a ledger you can edit is not one — deleting a
 * conversation is explicitly not allowed to change the total (see the
 * `ON DELETE SET NULL` in the schema).
 */

/**
 * How far back each grain looks.
 *
 * One control rather than two. A window and a grain as separate pickers is six
 * combinations, four of which are useless — nobody wants ninety days broken
 * down by day in a side panel, and a week grouped by month is one bar. Each
 * view here answers a whole question on its own: what am I spending lately,
 * how is that trending, and what has this cost me overall.
 */
export const WINDOW_DAYS: Record<Grain, number> = {
  day: 14,
  week: 84,
  month: 366,
};

interface UsageStore {
  buckets: UsageBucket[];
  grain: Grain;
  /** False until the first successful load, so the panel can say "loading". */
  loaded: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  setGrain: (grain: Grain) => Promise<void>;
  /** File a finished turn, then fold it into what is on screen. */
  record: (usage: UsageInput) => Promise<void>;
  dismissError: () => void;
}

export const useUsageStore = create<UsageStore>()((set, get) => ({
  buckets: [],
  grain: "day",
  loaded: false,
  error: null,

  refresh: async () => {
    try {
      const buckets = await tokenUsage(WINDOW_DAYS[get().grain]);
      set({ buckets, loaded: true, error: null });
    } catch (err) {
      set({ error: `Could not read your consumption history: ${String(err)}` });
    }
  },

  setGrain: async (grain) => {
    set({ grain });
    await get().refresh();
  },

  record: async (usage) => {
    try {
      await recordTokenUsage(usage);
    } catch (err) {
      // Deliberately quiet. This runs at the end of every turn, and a panel the
      // reader may never open must not put an error bar over the answer they
      // are reading. It is surfaced when they go looking.
      set({ error: `Could not record what that turn cost: ${String(err)}` });
      return;
    }
    // Only once the write landed: a panel showing spend that was never stored
    // would disagree with itself at the next launch.
    await get().refresh();
  },

  dismissError: () => set({ error: null }),
}));
