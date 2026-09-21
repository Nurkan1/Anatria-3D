import type { SessionSummary, StudyNote } from "@/lib/studyDb";

/**
 * The study journal, read as a sequence of memories.
 *
 * Every conversation with the assistant, every case visit and every note is
 * one memory, and they are laid out in the order they happened. Nothing new is
 * stored: this is a way of looking at the journal, and erasing a memory is the
 * journal's own delete.
 */

export type MemoryKind = "session" | "case" | "note";

export interface Memory {
  /** Unique across kinds: `session:<id>` or `note:<id>`. */
  key: string;
  kind: MemoryKind;
  /** The journal's own id for it, to read it back or delete it. */
  id: string;
  title: string;
  /** When it was first made, in milliseconds. */
  at: number;
  /** How many structures it touched (sessions) or the one it is on (notes). */
  structures: number;
  /** A line to show before it is opened. */
  preview: string;
}

const PREVIEW = 140;

function trimmed(text: string, length = PREVIEW): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** Oldest first: the path runs from the first thing studied to the last. */
export function memoriesFrom(sessions: readonly SessionSummary[], notes: readonly StudyNote[]): Memory[] {
  const out: Memory[] = [];
  for (const session of sessions) {
    out.push({
      key: `session:${session.id}`,
      kind: session.kind === "case" ? "case" : "session",
      id: session.id,
      title: session.title,
      at: session.created_at,
      structures: session.structure_count,
      preview:
        session.kind === "case" && session.score !== null
          ? `Case visit · scored ${session.score}`
          : `${session.message_count} messages · ${session.structure_count} structures`,
    });
  }
  for (const note of notes) {
    out.push({
      key: `note:${note.id}`,
      kind: "note",
      id: String(note.id),
      title: note.organ_label ? `Note on ${note.organ_label}` : "Note",
      at: note.created_at,
      structures: note.organ_id ? 1 : 0,
      preview: trimmed(note.body),
    });
  }
  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** How many of each kind, for the counters. */
export function tally(memories: readonly Memory[]): Record<MemoryKind, number> {
  const counts: Record<MemoryKind, number> = { session: 0, case: 0, note: 0 };
  for (const memory of memories) counts[memory.kind] += 1;
  return counts;
}

/**
 * Memories per month, oldest first, for the timeline's bars. A month with
 * nothing in it between the first and the last is still there, as zero, so the
 * gaps in someone's studying are visible rather than closed up.
 */
export function byMonth(memories: readonly Memory[]): { month: string; count: number }[] {
  if (memories.length === 0) return [];
  const key = (ms: number) => {
    const d = new Date(ms);
    return d.getFullYear() * 12 + d.getMonth();
  };
  const first = key(memories[0]!.at);
  const last = key(memories[memories.length - 1]!.at);
  const counts = new Map<number, number>();
  for (const memory of memories) counts.set(key(memory.at), (counts.get(key(memory.at)) ?? 0) + 1);
  const out: { month: string; count: number }[] = [];
  for (let m = first; m <= last; m++) {
    const label = new Date(Math.floor(m / 12), m % 12, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    out.push({ month: label, count: counts.get(m) ?? 0 });
  }
  return out;
}

/**
 * Where each memory sits on the cortex.
 *
 * The memories follow one path: a spiral that starts low at the back of the
 * brain and winds up and forward, two turns in all, so the order in which
 * things were studied can be read off the shape. Each step of the spiral is
 * pinned to the cortex point that lies most nearly in its direction.
 *
 * `surface` is a flat xyz list of candidate points in the brain's own space,
 * centred on the origin. Returns an index into it for each memory.
 */
export function placeOnCortex(count: number, surface: ArrayLike<number>): number[] {
  const points = Math.floor(surface.length / 3);
  if (count === 0 || points === 0) return [];
  const lengths = new Float32Array(points);
  for (let p = 0; p < points; p++) {
    lengths[p] = Math.hypot(surface[p * 3]!, surface[p * 3 + 1]!, surface[p * 3 + 2]!) || 1;
  }
  const used = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const height = -0.25 + t * 0.95;
    const around = Math.PI + t * Math.PI * 4;
    const ring = Math.sqrt(Math.max(0, 1 - height * height));
    const dx = Math.sin(around) * ring;
    const dy = height;
    const dz = Math.cos(around) * ring;
    let best = -1;
    let bestScore = -Infinity;
    for (let p = 0; p < points; p++) {
      const score =
        (surface[p * 3]! * dx + surface[p * 3 + 1]! * dy + surface[p * 3 + 2]! * dz) / lengths[p]! -
        // Nudge two memories apart when they would share a point.
        (used.has(p) ? 0.05 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    used.add(best);
    out.push(best);
  }
  return out;
}

/**
 * The memory beside `current` in the order they were made, for the arrow keys.
 *
 * With nothing open, left starts from the newest and right from the oldest —
 * each from the end it points away from. At either end it stays put rather than
 * wrapping: jumping from the last memory back to the first reads as a mistake.
 */
export function stepMemory(keys: readonly string[], current: string | null, direction: -1 | 1): string | null {
  if (keys.length === 0) return null;
  const at = current === null ? -1 : keys.indexOf(current);
  if (at === -1) return direction === -1 ? keys[keys.length - 1]! : keys[0]!;
  return keys[Math.min(keys.length - 1, Math.max(0, at + direction))]!;
}
