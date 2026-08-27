import { useEffect, useMemo } from "react";

import { useUsageStore } from "@/stores/usageStore";

import { byModel, summarise, totals, type Grain } from "./aggregate";
import { formatTokens } from "./tokens";

/**
 * What the assistant has cost, over time and per model.
 *
 * # Why this is a panel of its own
 *
 * The per-answer count belongs next to the answer, where it is one faint line
 * you can ignore. Everything else — trends, models, months — is a different
 * activity: you go looking for it, once, when the provider's bill surprises
 * you. Putting it in the chat would tax every reading of every answer with a
 * dashboard nobody asked for at that moment.
 *
 * # No prices
 *
 * Tokens only, deliberately — see `tokens.ts`. Rates change without notice and
 * differ by tier, region and cache state; a euro figure would be quietly wrong
 * for somebody within the month. Being silent about the bill is better than
 * being confidently wrong about it, and the provider's own dashboard is the
 * authority.
 */

const GRAINS: { id: Grain; label: string; window: string }[] = [
  { id: "day", label: "Daily", window: "last 14 days" },
  { id: "week", label: "Weekly", window: "last 12 weeks" },
  { id: "month", label: "Monthly", window: "last 12 months" },
];

export function UsagePanel() {
  const buckets = useUsageStore((s) => s.buckets);
  const grain = useUsageStore((s) => s.grain);
  const loaded = useUsageStore((s) => s.loaded);
  const error = useUsageStore((s) => s.error);
  const refresh = useUsageStore((s) => s.refresh);
  const setGrain = useUsageStore((s) => s.setGrain);
  const dismissError = useUsageStore((s) => s.dismissError);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const periods = useMemo(() => summarise(buckets, grain), [buckets, grain]);
  const models = useMemo(() => byModel(buckets), [buckets]);
  const sum = useMemo(() => totals(buckets), [buckets]);
  const window = GRAINS.find((entry) => entry.id === grain)?.window ?? "";

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-800 px-3 py-2">
        {GRAINS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => void setGrain(entry.id)}
            aria-pressed={grain === entry.id}
            title={`Group by ${entry.label.toLowerCase().replace("ly", "")} — ${entry.window}`}
            className={`rounded border px-2 py-1 text-[11px] transition ${
              grain === entry.id
                ? "border-sky-500 bg-sky-500/10 text-sky-300"
                : "border-slate-700 text-slate-400 hover:border-slate-600"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-[10px] text-rose-300">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={dismissError} className="text-rose-400">
            ×
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <Total sum={sum} window={window} loaded={loaded} />

        {periods.length > 0 && (
          <Section title={`Over the ${window}`}>
            <Timeline periods={periods} />
          </Section>
        )}

        {models.length > 0 && (
          <Section title="By model">
            <div className="space-y-1.5">
              {models.map((row) => (
                <div key={`${row.provider}/${row.model}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                      {row.model}
                    </span>
                    <span className="tabular-nums text-[11px] text-slate-400">
                      {formatTokens(row.total)}
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-[10px] text-slate-600">
                      {Math.round(row.share * 100)}%
                    </span>
                  </div>
                  <Bar fraction={row.share} />
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    {row.provider} · {row.turns} {row.turns === 1 ? "answer" : "answers"} ·{" "}
                    {formatTokens(row.input)} sent, {formatTokens(row.output)} received
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {loaded && buckets.length === 0 && (
          <p className="pt-4 text-center text-[11px] leading-relaxed text-slate-600">
            Nothing yet. Every answer the assistant gives is counted here, from the
            next one on.
          </p>
        )}

        <p className="border-t border-slate-800/70 pt-3 text-[10px] leading-relaxed text-slate-600">
          Counts are what your provider reported for each answer, stored on this
          machine only. No prices: rates change and differ by tier and region, so
          your provider&apos;s own dashboard is the authority on the bill.
        </p>
      </div>
    </div>
  );
}

function Total({
  sum,
  window,
  loaded,
}: {
  sum: { input: number; output: number; cached: number; total: number; turns: number };
  window: string;
  loaded: boolean;
}) {
  if (!loaded) return <p className="text-[11px] text-slate-500">Reading…</p>;

  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{window}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">
        {formatTokens(sum.total)}
        <span className="ml-1 text-[11px] font-normal text-slate-500">tokens</span>
      </p>
      <p className="mt-0.5 text-[10px] text-slate-500">
        {formatTokens(sum.input)} sent · {formatTokens(sum.output)} received ·{" "}
        {sum.turns} {sum.turns === 1 ? "answer" : "answers"}
        {sum.turns > 0 && ` · ${formatTokens(sum.total / sum.turns)} each on average`}
      </p>
      {/*
        Said only when there is something to say. Every question re-sends the
        whole conversation, which is what makes the number above grow — but a
        provider that recognises the repetition charges a fraction for it, and
        without this line the panel reports the volume as though all of it were
        paid for at full rate. Turns recorded before the journal counted this
        contribute nothing, so the figure can only ever understate the saving.
      */}
      {sum.cached > 0 && (
        <p className="mt-0.5 text-[10px] text-slate-500">
          {formatTokens(sum.cached)} of what was sent came back out of the
          provider&rsquo;s cache, billed at a reduced rate.
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">{title}</p>
      {children}
    </div>
  );
}

/**
 * Bars scaled against the busiest period rather than against the total.
 *
 * The question a reader brings here is "is this week worse than last week",
 * which is a comparison between the rows — scaling to the sum would flatten
 * every row into a sliver as soon as there were a dozen of them.
 */
function Timeline({
  periods,
}: {
  periods: { key: string; label: string; total: number; turns: number }[];
}) {
  const peak = Math.max(...periods.map((period) => period.total), 1);

  return (
    <div className="space-y-1">
      {periods.map((period) => (
        <div key={period.key} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-[10px] text-slate-500">
            {period.label}
          </span>
          <div className="min-w-0 flex-1">
            <Bar fraction={period.total / peak} />
          </div>
          <span
            className="w-12 shrink-0 text-right tabular-nums text-[10px] text-slate-400"
            title={`${period.turns} ${period.turns === 1 ? "answer" : "answers"}`}
          >
            {formatTokens(period.total)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A hairline stays visible for a period that cost almost nothing but not nothing. */
function Bar({ fraction }: { fraction: number }) {
  return (
    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-sky-500/70"
        style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}
