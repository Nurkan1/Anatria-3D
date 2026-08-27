import type { TokenUsage } from "@/lib/schemas";

/**
 * Token arithmetic and presentation, in one place.
 *
 * # Tokens, not money
 *
 * Nothing here converts to a currency, and that is a decision rather than an
 * omission. Prices change without warning, vary by tier and region, and are
 * different again for cached input — a figure in euros would be wrong for
 * somebody within the month and wrong for everybody eventually, and being
 * quietly wrong about what a student is spending is worse than being silent.
 * Tokens are what the provider actually reports, so tokens are what is shown.
 * The provider's own dashboard is the authority on the bill.
 */

/**
 * One turn's input and output added together.
 *
 * Asks for the two fields it adds rather than a whole `TokenUsage`, so the
 * daily rows the database aggregates — which are counts, not turns — can be
 * summed by the same function without pretending to be something they are not.
 */
export function totalTokens(usage: Pick<TokenUsage, "input_tokens" | "output_tokens">): number {
  return usage.input_tokens + usage.output_tokens;
}

/**
 * The part of a turn that was actually composed rather than re-read.
 *
 * `input_tokens` is an inclusive total: it counts the context the provider
 * served out of its own cache alongside the context it had to take in fresh.
 * Both figures are true, and they answer different questions — how much
 * context the turn needed, and how much of it was paid for at full rate.
 *
 * This is the second question, and it is the one worth acting on. Every turn
 * re-sends the whole transcript, which makes a long conversation look alarming
 * by the first measure; but a long conversation is also the one a provider
 * caches best, and cache reads are billed at a fraction — a tenth on some
 * providers, half on others. OpenAI caches any prompt over 1,024 tokens
 * without being asked, so this is the ordinary case rather than a special one.
 */
export function uncachedTokens(usage: TokenUsage): number {
  const fresh = Math.max(0, usage.input_tokens - (usage.cache_read_tokens ?? 0));
  return fresh + usage.output_tokens;
}

/**
 * Where a conversation is worth mentioning the cost of.
 *
 * Nothing about a chat box suggests that asking the same question later costs
 * more than asking it now, and yet it does: every turn re-sends the whole
 * transcript, so the price of a question is set by the length of the
 * conversation it is asked in. That is not something a reader can be expected
 * to work out, and they are paying for it with their own key.
 *
 * # Where the number comes from, measured rather than guessed
 *
 * It used to be justified as the point where a turn stops being dominated by
 * the anatomy inventory, which was then some 53,000 tokens on every turn. That
 * is no longer true of this application: above 120 loaded structures the prompt
 * sends a summary and a search tool instead of a list, and the whole system
 * prompt with the complete 3,478-structure atlas open now measures about 2,800
 * tokens. The worst case is 120 structures exactly — the last size still listed
 * in full — at roughly 5,000.
 *
 * So the fixed part of a turn is a few thousand tokens, and everything above
 * that is transcript. 20,000 of context the reader paid full rate for is a
 * conversation long enough that starting a fresh one is worth the sentence it
 * takes to say so, and short of that the notice would be noise.
 *
 * # Why it is measured against the uncached part
 *
 * Because that is the part that grows. A provider serving most of the
 * transcript from its cache is the good case, and firing a warning at it would
 * train people to ignore the warning in the bad one.
 */
export const LONG_CONVERSATION_TOKENS = 20_000;

export function conversationIsCostly(usage: TokenUsage | null | undefined): boolean {
  return usage ? uncachedTokens(usage) >= LONG_CONVERSATION_TOKENS : false;
}

/**
 * A count at a glance: `1,240`, `12.4k`, `1.2M`.
 *
 * Grouped below ten thousand because at that size the exact number is still
 * meaningful to a reader deciding whether an answer was expensive; abbreviated
 * above it because by then the magnitude is the only part anyone reads, and a
 * seven-digit run of numerals in a table column is worse than useless.
 *
 * Deliberately locale-independent. This is the one number in the application
 * that a reader may compare against a provider's billing page, and a decimal
 * comma against that page's decimal point invites the wrong conclusion.
 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  const whole = Math.round(count);
  if (whole < 10_000) return whole.toLocaleString("en-US");
  if (whole < 1_000_000) return `${trim(whole / 1_000)}k`;
  return `${trim(whole / 1_000_000)}M`;
}

/** One decimal, but never a trailing `.0` — `12k` reads better than `12.0k`. */
function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
