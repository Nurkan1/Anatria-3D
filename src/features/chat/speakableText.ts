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
 * The speech itself is the platform's: `speechSynthesis` drives the voices the
 * operating system already has. Nothing here is sent anywhere, no engine is
 * bundled, and the installer does not grow — see `useSpokenAnswer`.
 */

/**
 * Ceiling on what is queued for speech.
 *
 * Truncation is the wrong answer to a long answer: an explanation that stops
 * after its first paragraph loses exactly the part the reader was waiting for,
 * and stops without saying why. *Stop* is the answer to "too long" — the
 * button is always there — so this sits far above anything the assistant
 * writes and exists only to bound the queue.
 */
export const MAX_SPOKEN_CHARS = 8000;

/**
 * Longest run of text handed to a single utterance.
 *
 * WebView2 is Chromium, and Chromium's `speechSynthesis` **stops partway
 * through a long utterance** — the engine goes quiet after roughly a quarter
 * of a minute with no `end` event and no error, which reads to a listener as
 * the app breaking mid-sentence. Speaking a whole answer as one utterance
 * would hit that on every answer worth listening to.
 *
 * Queueing several short utterances avoids it, and pays twice: `cancel()`
 * takes effect at the next boundary instead of being ignored, and the queue
 * can be abandoned without waiting for a long buffer to drain.
 */
const MAX_UTTERANCE_CHARS = 220;

export function speakableText(markdown: string, limit = 0): string {
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

  // `0` means "no preference", and the ceiling above is then the only limit. A
  // reader who wants shorter speech sets one in Settings; nothing here decides
  // it for them.
  const ceiling = limit > 0 ? Math.min(limit, MAX_SPOKEN_CHARS) : MAX_SPOKEN_CHARS;
  return truncateAtSentence(text, ceiling);
}

/**
 * Cut to `limit`, preferring the last sentence end before it.
 *
 * Reached only by a reader who has chosen a shorter limit in Settings, or by
 * an answer at the 8000-character ceiling, which is far past anything the
 * assistant writes. A cut at a full stop sounds like the end of a thought
 * where a cut mid-clause sounds like a fault.
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

/**
 * Split prepared text into utterances a browser engine will actually finish.
 *
 * Sentences first: a break at a full stop is a break the listener expects, and
 * most sentences are already well under the limit. A sentence that is not gets
 * broken between words — never inside one, which is the only cut that sounds
 * like a fault rather than a pause.
 */
export function speechChunks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const sentence of splitSentences(trimmed)) {
    // Long enough to need breaking on its own. Whatever was accumulating ends
    // here, at a sentence boundary, rather than being carried into the split.
    if (sentence.length > MAX_UTTERANCE_CHARS) {
      flush();
      chunks.push(...splitBetweenWords(sentence));
      continue;
    }

    // Sentences are packed rather than spoken one per utterance: every
    // boundary is a small seam in the delivery, and a paragraph of short
    // sentences read as six separate utterances sounds clipped.
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > MAX_UTTERANCE_CHARS) {
      flush();
      current = sentence;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}

/**
 * Split on sentence punctuation, keeping it attached so the voice still falls.
 *
 * A boundary detected wrongly — "e.g.", "Fig. 3" — costs one extra beat of
 * silence and nothing more, which is why this stays a regex instead of growing
 * into an abbreviation table nobody would maintain.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]*\s*/g);
  if (!matches) return [text];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

/** Greedy fill up to the limit. A single word longer than it is left whole. */
function splitBetweenWords(sentence: string): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const word of sentence.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_UTTERANCE_CHARS && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
