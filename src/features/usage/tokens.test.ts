import { describe, expect, it } from "vitest";

import {
  conversationIsCostly,
  describeTurnCost,
  formatTokens,
  LONG_CONVERSATION_TOKENS,
  totalTokens,
  uncachedTokens,
} from "./tokens";

describe("totalTokens", () => {
  it("adds input and output", () => {
    expect(totalTokens({ input_tokens: 834, output_tokens: 406 })).toBe(1240);
  });
});

describe("formatTokens", () => {
  it("groups exact counts below ten thousand", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(940)).toBe("940");
    expect(formatTokens(9_999)).toBe("9,999");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatTokens(10_000)).toBe("10k");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(999_400)).toBe("999.4k");
    expect(formatTokens(1_240_000)).toBe("1.2M");
  });

  /**
   * This is the one number a reader may hold up against a provider's billing
   * page, so it must not be rendered in their locale — a decimal comma against
   * that page's decimal point invites exactly the wrong conclusion.
   */
  it("uses the same separators regardless of locale", () => {
    expect(formatTokens(1_234)).toBe("1,234");
  });

  it("refuses to render nonsense as a number", () => {
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
  });
});

describe("conversationIsCostly", () => {
  const usage = (total: number, cached = 0) => ({
    input_tokens: total - 100,
    output_tokens: 100,
    cache_read_tokens: cached,
  });

  it("says nothing about a conversation that has just started", () => {
    // Warning early would train people to ignore the notice, which costs more
    // than saying nothing.
    expect(conversationIsCostly(usage(4_000))).toBe(false);
  });

  it("speaks up once the transcript is what a turn is made of", () => {
    expect(conversationIsCostly(usage(LONG_CONVERSATION_TOKENS))).toBe(true);
    expect(conversationIsCostly(usage(70_000))).toBe(true);
  });

  it("stays quiet when the provider served the transcript from its cache", () => {
    // The case the old threshold got wrong. A long conversation is the one a
    // provider caches best, and warning about the cheap turn would teach the
    // reader to ignore the warning on the expensive one.
    expect(conversationIsCostly(usage(70_000, 65_000))).toBe(false);
  });

  it("says nothing when the provider reported no usage at all", () => {
    // Absent counts are not zero counts, and a notice built on a blank would
    // appear at the wrong moment or never.
    expect(conversationIsCostly(null)).toBe(false);
    expect(conversationIsCostly(undefined)).toBe(false);
  });
});

describe("uncachedTokens", () => {
  it("counts only the input the provider had to take in fresh", () => {
    expect(
      uncachedTokens({ input_tokens: 50_000, output_tokens: 800, cache_read_tokens: 48_000 }),
    ).toBe(2_800);
  });

  it("treats a turn with no cache as entirely fresh", () => {
    expect(
      uncachedTokens({ input_tokens: 3_000, output_tokens: 400, cache_read_tokens: 0 }),
    ).toBe(3_400);
  });

  it("never reports less than the output when the counts disagree", () => {
    // A provider reporting more cache than input would otherwise make a turn
    // cost a negative number of tokens.
    expect(
      uncachedTokens({ input_tokens: 100, output_tokens: 50, cache_read_tokens: 4_000 }),
    ).toBe(50);
  });
});

describe("describeTurnCost", () => {
  /**
   * The turn that prompted this. Measured from the real journal: one answer on
   * gpt-6-astra drove thirty-odd scene commands, which re-sent the same prefix
   * thirty-odd times, and the provider served 96.8% of it from its cache.
   *
   * The panel used to print "418.9k tokens" against a turn charged like
   * sixteen thousand.
   */
  const ASTRA = {
    input_tokens: 415_895,
    output_tokens: 3_000,
    cache_read_tokens: 402_775,
  };

  it("leads with what was paid for, and keeps the figure the provider will show", () => {
    expect(describeTurnCost(ASTRA).label).toBe("16.1k of 418.9k tokens");
  });

  it("says where the difference went, rather than leaving a reader to guess", () => {
    const detail = describeTurnCost(ASTRA).detail;
    expect(detail).toContain("415.9k of context sent");
    expect(detail).toContain("402.8k");
    expect(detail).toContain("cache");
    expect(detail).toContain("3,000 received");
  });

  it("shows one number when nothing was cached", () => {
    // A reader on a provider that does not cache must not be made to read
    // "16.1k of 16.1k".
    expect(
      describeTurnCost({
        input_tokens: 12_000,
        output_tokens: 4_100,
        cache_read_tokens: 0,
      }).label,
    ).toBe("16.1k tokens");
  });

  it("treats an uncounted turn as uncached rather than as free", () => {
    // A turn taken before the journal recorded caching reaches here as zero,
    // which is the honest reading: nothing is *known* to have been cached.
    // Showing it as fully cached would price a real turn at nothing.
    expect(
      describeTurnCost({
        input_tokens: 900,
        output_tokens: 100,
        cache_read_tokens: 0,
      }).label,
    ).toBe("1,000 tokens");
  });

  it("does not go negative if a provider reports more cached than sent", () => {
    const { label } = describeTurnCost({
      input_tokens: 100,
      output_tokens: 10,
      cache_read_tokens: 500,
    });
    expect(label).toBe("10 of 110 tokens");
  });
});
