import { describe, expect, it } from "vitest";

import type { UsageBucket } from "@/lib/studyDb";

import { byModel, parseDay, summarise, totals, weekStart } from "./aggregate";

function bucket(
  day: string,
  model: string,
  input: number,
  output: number,
  turns = 1,
): UsageBucket {
  return {
    day,
    provider: "google",
    model,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: 0,
    turns,
  };
}

describe("parseDay", () => {
  /**
   * The regression this whole module is arranged around: `new Date("2026-08-12")`
   * parses as UTC, so west of Greenwich it is the 11th at 8pm — which moves the
   * first of a month into the previous one and makes the monthly totals wrong
   * for half the planet.
   */
  it("reads a day as local wall-clock, not UTC", () => {
    const date = parseDay("2026-08-12");
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(12);
    expect(date?.getHours()).toBe(0);
  });

  it.each(["", "2026-8-12", "12/08/2026", "2026-02-31", "not a day"])(
    "refuses %p",
    (raw) => {
      expect(parseDay(raw)).toBeNull();
    },
  );
});

describe("weekStart", () => {
  it("returns the Monday of that week", () => {
    // 2026-08-12 is a Wednesday.
    expect(weekStart(new Date(2026, 7, 12)).getDate()).toBe(10);
  });

  /** getDay() is 0 for Sunday, which is six days *after* its Monday. */
  it("puts Sunday at the end of its week, not the start of the next", () => {
    expect(weekStart(new Date(2026, 7, 16)).getDate()).toBe(10);
  });

  it("crosses a month boundary", () => {
    // 2026-08-02 is a Sunday; its Monday is in July.
    const monday = weekStart(new Date(2026, 7, 2));
    expect(monday.getMonth()).toBe(6);
    expect(monday.getDate()).toBe(27);
  });
});

describe("summarise", () => {
  const week = [
    bucket("2026-08-10", "flash", 100, 50),
    bucket("2026-08-12", "flash", 200, 100, 2),
    bucket("2026-08-12", "pro", 40, 20),
    bucket("2026-08-17", "flash", 10, 5),
  ];

  it("keeps days apart and adds the models within one", () => {
    const days = summarise(week, "day");
    expect(days.map((period) => period.key)).toEqual([
      "2026-08-17",
      "2026-08-12",
      "2026-08-10",
    ]);
    expect(days[1]).toMatchObject({ input: 240, output: 120, total: 360, turns: 3 });
  });

  it("folds a week onto its Monday", () => {
    const weeks = summarise(week, "week");
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.label).toBe("17–23 Aug");
    expect(weeks[1]).toMatchObject({ label: "10–16 Aug", total: 510, turns: 4 });
  });

  it("labels a week that spans two months with both", () => {
    expect(summarise([bucket("2026-08-02", "flash", 1, 1)], "week")[0]?.label).toBe(
      "27 Jul – 2 Aug",
    );
  });

  it("folds months", () => {
    const months = summarise(
      [...week, bucket("2026-07-30", "flash", 1000, 500)],
      "month",
    );
    expect(months.map((period) => period.key)).toEqual(["2026-08", "2026-07"]);
    expect(months[0]?.total).toBe(525);
    expect(months[1]?.label).toBe("Jul 2026");
  });

  /** A list mostly of zeroes buries the days that did cost something. */
  it("omits periods with no spend rather than padding them", () => {
    expect(summarise(week, "day")).toHaveLength(3);
  });

  it("ignores a row whose day it cannot read", () => {
    expect(summarise([bucket("garbage", "flash", 999, 999)], "day")).toEqual([]);
  });

  it("has nothing to say about nothing", () => {
    expect(summarise([], "month")).toEqual([]);
  });
});

describe("byModel", () => {
  it("ranks models by what they cost and gives each its share", () => {
    const rows = byModel([
      bucket("2026-08-10", "flash", 100, 50),
      bucket("2026-08-12", "flash", 200, 50),
      bucket("2026-08-12", "pro", 80, 20),
    ]);

    expect(rows.map((row) => row.model)).toEqual(["flash", "pro"]);
    expect(rows[0]).toMatchObject({ total: 400, turns: 2 });
    expect(rows[0]?.share).toBeCloseTo(0.8);
    expect(rows[1]?.share).toBeCloseTo(0.2);
  });

  it("keeps the same model name apart when two providers serve it", () => {
    const rows = byModel([
      bucket("2026-08-12", "shared", 10, 0),
      { ...bucket("2026-08-12", "shared", 90, 0), provider: "openai" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.provider).toBe("openai");
  });

  /** No division by zero, and no NaN rendered as a percentage. */
  it("gives a zero share when nothing was spent", () => {
    expect(byModel([bucket("2026-08-12", "flash", 0, 0)])[0]?.share).toBe(0);
  });
});

describe("totals", () => {
  it("adds the window up", () => {
    expect(
      totals([bucket("2026-08-10", "flash", 100, 50), bucket("2026-08-12", "pro", 7, 3)]),
    ).toEqual({ input: 107, output: 53, cached: 0, total: 160, turns: 2 });
  });

  it("adds up what the provider served from its cache", () => {
    const cached = (day: string, model: string, input: number, hit: number) => ({
      ...bucket(day, model, input, 10),
      cache_read_tokens: hit,
    });

    // A day that predates the column contributes nothing rather than a guess,
    // so the figure can only understate the saving.
    expect(
      totals([cached("2026-08-10", "flash", 900, 600), bucket("2026-08-12", "pro", 100, 10)]),
    ).toMatchObject({ input: 1_000, cached: 600 });
  });

  it("is zero for an empty window", () => {
    expect(totals([])).toEqual({ input: 0, output: 0, cached: 0, total: 0, turns: 0 });
  });
});
