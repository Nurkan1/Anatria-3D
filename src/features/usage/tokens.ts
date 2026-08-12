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

/** One turn's input and output added together. */
export function totalTokens(usage: TokenUsage): number {
  return usage.input_tokens + usage.output_tokens;
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
