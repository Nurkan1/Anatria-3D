import type { ManifestOrgan } from "@/lib/schemas";

/**
 * The atlas structures a local model's answer names, so the reader can show
 * them with one click.
 *
 * # Why the reader clicks and the model does not act
 *
 * The local model has no tools by design (`local_chat.py`): a small model
 * guesses at structure ids, and a guess that moved the atlas would teach
 * something false with the atlas's authority. Here the model only *names*
 * structures, and a name becomes a button only when it is exactly a
 * Terminologia Anatomica name the atlas has. An invented or misspelt Latin name
 * offers nothing — it cannot point at the wrong structure — and nothing moves
 * until the reader asks.
 *
 * # Why Latin
 *
 * The answer is in the reader's language and the atlas is labelled in Latin and
 * English. The Latin is the one spelling shared by every answer, so the model is
 * asked to put it in parentheses after each structure it names.
 *
 * - A Latin name **in parentheses** is matched even when it is one word
 *   ("(Hepar)"), because that is where the model was asked to put it.
 * - A Latin name **of two words or more** is matched anywhere in the text: long
 *   enough that "ventriculus sinister" cannot be an accident.
 * - A one-word Latin name outside parentheses is not, because short words turn up
 *   inside ordinary prose in Spanish and Bulgarian transliteration.
 */

/** A button: one Latin name, and every loaded structure that carries it. */
export interface Mention {
  latin: string;
  organIds: string[];
}

/** Buttons offered under one answer, at most. */
export const MAX_MENTIONS = 8;

/** Lower case, accents gone, runs of space made one: the form both sides are compared in. */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Latin name → the loaded structures named so, built once per set of structures. */
export function latinIndex(organs: readonly ManifestOrgan[]): Map<string, Mention> {
  const index = new Map<string, Mention>();
  for (const organ of organs) {
    const key = normalise(organ.ta2_latin);
    if (!key) continue;
    const entry = index.get(key);
    if (entry) entry.organIds.push(organ.organ_id);
    else index.set(key, { latin: organ.ta2_latin, organIds: [organ.organ_id] });
  }
  return index;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The structures `answer` names, in the order it first names them. */
export function mentionedStructures(answer: string, index: ReadonlyMap<string, Mention>): Mention[] {
  const text = normalise(answer);
  const found = new Map<string, number>();
  const note = (key: string, at: number) => {
    if (index.has(key) && (!found.has(key) || found.get(key)! > at)) found.set(key, at);
  };

  // Inside parentheses: each comma- or semicolon-separated part is a candidate.
  for (const match of text.matchAll(/\(([^()]{2,120})\)/g)) {
    for (const part of match[1]!.split(/[,;]/)) note(part.trim(), match.index ?? 0);
  }

  // Anywhere: Latin names of two words or more, on word boundaries.
  for (const key of index.keys()) {
    if (!key.includes(" ")) continue;
    const at = text.search(new RegExp(`(^|[^\\p{L}])${escapeRegExp(key)}($|[^\\p{L}])`, "u"));
    if (at >= 0) note(key, at);
  }

  return [...found.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_MENTIONS)
    .map(([key]) => index.get(key)!);
}
