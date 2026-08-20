import { stripOrganRefs } from "./organRefs";

/**
 * Turn a written answer into something worth listening to.
 *
 * The assistant writes Markdown aimed at a reader: headings, bullets, bold,
 * code spans, and `[[organ_id]]` markers the viewport consumes. Handing that
 * to a speech engine verbatim produces a voice saying "hash hash Left
 * ventricle asterisk asterisk", which is worse than no speech at all.
 *
 * This is deliberately **not** a Markdown parser. It strips the handful of
 * constructs the assistant actually emits and leaves everything else alone; a
 * stray character that slips through is spoken as a word, which is a small
 * cost next to a dependency and a tree walk.
 *
 * Part of the local voice experiment (branch `experiment/voice`).
 */

/**
 * Ceiling on what is sent for synthesis.
 *
 * Piper is realtime-ish on a CPU, so a long answer takes about as long to
 * synthesise as it takes to say — a 4000-character answer is minutes of audio
 * nobody waits for, arriving as one base64 blob on one NDJSON line. Long
 * answers are cut at a sentence boundary and the reader keeps the written one,
 * which is the authoritative copy anyway.
 */
export const MAX_SPOKEN_CHARS = 700;

export function speakableText(markdown: string): string {
  let text = stripOrganRefs(markdown);

  text = text
    // Fenced code: never worth speaking, and usually long.
    .replace(/```[\s\S]*?```/g, " ")
    // Inline code, keeping the word inside — `aorta` is still "aorta".
    .replace(/`([^`]+)`/g, "$1")
    // Images before links: both use bracket syntax, and an image's alt text is
    // not something to read out.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Links: keep the label, drop the URL. A spoken https:// is unbearable.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Heading marks, list bullets and blockquote marks, at line starts only,
    // so a hyphen inside a word survives.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    // Ordered lists: "1." read aloud is noise, the order is audible anyway.
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "")
    // Emphasis: **bold**, *italic*, __bold__, _italic_.
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Horizontal rules.
    .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, " ")
    // Table pipes, which otherwise become a stream of "vertical bar".
    .replace(/\|/g, " ")
    // Collapse the whitespace all of that leaves behind. A paragraph break
    // becomes a full stop so the voice pauses where the writing did.
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

  return truncateAtSentence(text, MAX_SPOKEN_CHARS);
}

/**
 * Cut to `limit`, preferring the last sentence end before it.
 *
 * Stopping mid-clause sounds like a fault; stopping at a full stop sounds like
 * the end of a thought. If there is no sentence break in the last third, the
 * cut falls back to a word boundary rather than slicing a word in half.
 */
function truncateAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);
  const lastSentence = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("? "),
    head.lastIndexOf("! "),
  );
  if (lastSentence > limit * 0.6) return head.slice(0, lastSentence + 1);

  const lastSpace = head.lastIndexOf(" ");
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd() + "…";
}
