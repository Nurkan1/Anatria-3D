import { describe, expect, it } from "vitest";

import {
  conversationIsCostly,
  formatTokens,
  LONG_CONVERSATION_TOKENS,
  totalTokens,
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
  const usage = (total: number) => ({ input_tokens: total - 100, output_tokens: 100 });

  it("says nothing about a conversation that has just started", () => {
    // Warning early would train people to ignore the notice, which costs more
    // than saying nothing.
    expect(conversationIsCostly(usage(4_000))).toBe(false);
  });

  it("speaks up once the transcript is what a turn is made of", () => {
    expect(conversationIsCostly(usage(LONG_CONVERSATION_TOKENS))).toBe(true);
    expect(conversationIsCostly(usage(70_000))).toBe(true);
  });

  it("says nothing when the provider reported no usage at all", () => {
    // Absent counts are not zero counts, and a notice built on a blank would
    // appear at the wrong moment or never.
    expect(conversationIsCostly(null)).toBe(false);
    expect(conversationIsCostly(undefined)).toBe(false);
  });
});
