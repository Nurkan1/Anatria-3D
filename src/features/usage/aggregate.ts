import type { UsageBucket } from "@/lib/studyDb";

import { totalTokens } from "./tokens";

/**
 * Rolling per-day spend up into what a reader actually asks.
 *
 * SQLite hands back one row per local day and model. Everything above that —
 * weeks, months, per-model shares, the grand total — is arithmetic on a few
 * hundred rows, so it is done here where it is pure and can be tested without
 * a database or a clock.
 *
 * # Dates are handled as local wall-clock, throughout
 *
 * `day` arrives as `YYYY-MM-DD` already converted to the reader's timezone by
 * the query. It must never be fed to `new Date(string)`, which parses that
 * shape as **UTC** — west of Greenwich every day would shift back one, moving
 * spend across week and month boundaries and making the first of the month
 * belong to the previous one. The parts are split and passed to the
 * `Date(y, m, d)` constructor, which is local by definition.
 */

export type Grain = "day" | "week" | "month";

export interface Period {
  /** Sort key: `2026-08-12`, `2026-W33`, `2026-08`. */
  key: string;
  /** What the row is labelled with. */
  label: string;
  input: number;
  output: number;
  total: number;
  turns: number;
}

export interface ModelShare {
  provider: string;
  model: string;
  input: number;
  output: number;
  total: number;
  turns: number;
  /** 0–1 of the total tokens in the window. Zero when nothing was spent. */
  share: number;
}

export interface UsageTotals {
  input: number;
  output: number;
  /**
   * Of `input`, how much the provider served from its own prompt cache.
   *
   * Carried separately rather than subtracted because both numbers are true
   * and they answer different questions: how much context the reader's
   * questions needed, and how much of it was charged at full rate. Days whose
   * rows predate the column contribute zero, which understates the saving
   * rather than inventing one.
   */
  cached: number;
  total: number;
  turns: number;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2026-08-12` as a local `Date` at midnight. Invalid input yields `null`. */
export function parseDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(year, month - 1, date);
  // Rejects 2026-02-31, which the constructor would roll into March.
  if (parsed.getMonth() !== month - 1 || parsed.getDate() !== date) return null;
  return parsed;
}

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * The Monday of the week a date falls in.
 *
 * Monday rather than Sunday: this is an atlas used in Europe, where the week
 * starts on Monday, and a "this week" that resets on Sunday evening would put
 * a Sunday revision session into the week that is about to begin.
 */
export function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() is 0 for Sunday, which is six days *after* the Monday, not before.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

function label(date: Date, grain: Grain): string {
  if (grain === "month") return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  if (grain === "day") return `${date.getDate()} ${MONTHS[date.getMonth()]}`;

  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6);
  // "10–16 Aug" within one month, "29 Jul – 4 Aug" across two.
  return date.getMonth() === end.getMonth()
    ? `${date.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}`
    : `${date.getDate()} ${MONTHS[date.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

function periodKey(date: Date, grain: Grain): string {
  if (grain === "day") return iso(date);
  if (grain === "month") return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return `W${iso(weekStart(date))}`;
}

/**
 * Roll the buckets up to `grain`, newest first.
 *
 * Periods with no spend are absent rather than zero. A row of zeroes is a
 * claim that nothing was asked that day, which is true — but a list made
 * mostly of them buries the days that did cost something, and this panel
 * exists to show those.
 */
export function summarise(buckets: UsageBucket[], grain: Grain): Period[] {
  const periods = new Map<string, Period>();

  for (const bucket of buckets) {
    const date = parseDay(bucket.day);
    if (!date) continue;
    const anchor = grain === "week" ? weekStart(date) : date;
    const key = periodKey(date, grain);

    const period = periods.get(key) ?? {
      key,
      label: label(grain === "month" ? date : anchor, grain),
      input: 0,
      output: 0,
      total: 0,
      turns: 0,
    };
    period.input += bucket.input_tokens;
    period.output += bucket.output_tokens;
    period.total += totalTokens(bucket);
    period.turns += bucket.turns;
    periods.set(key, period);
  }

  return [...periods.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/** Spend per model over the whole window, heaviest first. */
export function byModel(buckets: UsageBucket[]): ModelShare[] {
  const models = new Map<string, ModelShare>();

  for (const bucket of buckets) {
    const key = `${bucket.provider}/${bucket.model}`;
    const entry = models.get(key) ?? {
      provider: bucket.provider,
      model: bucket.model,
      input: 0,
      output: 0,
      total: 0,
      turns: 0,
      share: 0,
    };
    entry.input += bucket.input_tokens;
    entry.output += bucket.output_tokens;
    entry.total += totalTokens(bucket);
    entry.turns += bucket.turns;
    models.set(key, entry);
  }

  const grand = totals(buckets).total;
  const rows = [...models.values()];
  for (const row of rows) row.share = grand > 0 ? row.total / grand : 0;
  return rows.sort((a, b) => b.total - a.total);
}

export function totals(buckets: UsageBucket[]): UsageTotals {
  return buckets.reduce<UsageTotals>(
    (sum, bucket) => ({
      input: sum.input + bucket.input_tokens,
      output: sum.output + bucket.output_tokens,
      cached: sum.cached + bucket.cache_read_tokens,
      total: sum.total + totalTokens(bucket),
      turns: sum.turns + bucket.turns,
    }),
    { input: 0, output: 0, cached: 0, total: 0, turns: 0 },
  );
}
