import { describe, expect, it } from "vitest";

import type { SessionSummary, StudyNote } from "@/lib/studyDb";

import { EraseQueue, RESTORE_WINDOW_S } from "./eraseQueue";
import { byMonth, memoriesFrom, placeOnCortex, tally } from "./memories";

const session = (id: string, at: number, extra: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    id,
    kind: "tutor",
    title: `Session ${id}`,
    profile: "student",
    language: "en",
    score: null,
    verdict: null,
    message_count: 4,
    structure_count: 2,
    case_id: null,
    visit_no: null,
    created_at: at,
    updated_at: at,
    ...extra,
  }) as SessionSummary;

const note = (id: number, at: number, body = "The heart has four chambers."): StudyNote => ({
  id,
  organ_id: "heart",
  organ_label: "Heart",
  session_id: null,
  body,
  created_at: at,
  updated_at: at,
});

describe("reading the journal as memories", () => {
  it("puts sessions, case visits and notes on one timeline, oldest first", () => {
    const memories = memoriesFrom(
      [session("b", 300), session("a", 100, { kind: "case", score: 80 })],
      [note(1, 200)],
    );
    expect(memories.map((m) => m.key)).toEqual(["session:a", "note:1", "session:b"]);
    expect(memories[0]!.kind).toBe("case");
    expect(memories[0]!.preview).toContain("80");
    expect(memories[1]!.title).toBe("Note on Heart");
  });

  it("shortens a long note to a preview", () => {
    const [memory] = memoriesFrom([], [note(1, 1, "word ".repeat(200))]);
    expect(memory!.preview.length).toBeLessThanOrEqual(140);
    expect(memory!.preview.endsWith("…")).toBe(true);
  });

  it("counts each kind", () => {
    const memories = memoriesFrom([session("a", 1), session("b", 2, { kind: "case" })], [note(1, 3)]);
    expect(tally(memories)).toEqual({ session: 1, case: 1, note: 1 });
  });

  it("keeps empty months in the timeline, so the gaps show", () => {
    const jan = new Date(2026, 0, 10).getTime();
    const apr = new Date(2026, 3, 10).getTime();
    const months = byMonth(memoriesFrom([session("a", jan), session("b", apr)], []));
    expect(months.map((m) => m.count)).toEqual([1, 0, 0, 1]);
  });
});

describe("placing memories on the cortex", () => {
  // A ring of points around the equator and two at the poles.
  const surface: number[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    surface.push(Math.sin(a), 0, Math.cos(a));
  }
  surface.push(0, 1, 0, 0, -1, 0);

  it("gives every memory a point, and spreads them", () => {
    const places = placeOnCortex(20, surface);
    expect(places).toHaveLength(20);
    expect(new Set(places).size).toBeGreaterThan(12);
  });

  it("rises from the first memory to the last", () => {
    const places = placeOnCortex(10, surface);
    const y = (index: number) => surface[index * 3 + 1]!;
    expect(y(places[9]!)).toBeGreaterThanOrEqual(y(places[0]!));
  });

  it("copes with nothing to place", () => {
    expect(placeOnCortex(0, surface)).toEqual([]);
    expect(placeOnCortex(3, [])).toEqual([]);
  });
});

describe("erasing with a way back", () => {
  it("deletes nothing until the window has passed", () => {
    const queue = new EraseQueue();
    queue.erase("note:1", 0);
    expect(queue.due(RESTORE_WINDOW_S * 1000 - 1)).toEqual([]);
    expect(queue.secondsLeft("note:1", 1000)).toBe(RESTORE_WINDOW_S - 1);
    expect(queue.due(RESTORE_WINDOW_S * 1000)).toEqual(["note:1"]);
    expect(queue.isPending("note:1")).toBe(false);
  });

  it("forgets a restored memory for good", () => {
    const queue = new EraseQueue();
    queue.erase("session:a", 0);
    expect(queue.restore("session:a")).toBe(true);
    expect(queue.due(60_000)).toEqual([]);
    expect(queue.restore("session:a")).toBe(false);
  });

  it("hands back everything pending when the lab closes", () => {
    const queue = new EraseQueue();
    queue.erase("a", 0);
    queue.erase("b", 0);
    expect(queue.flush().sort()).toEqual(["a", "b"]);
    expect(queue.flush()).toEqual([]);
  });
});
