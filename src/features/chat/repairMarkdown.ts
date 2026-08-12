/**
 * Small repairs to model-written Markdown, before it is parsed.
 *
 * # Why this exists at all
 *
 * A model streams prose, not a document. It sometimes runs a heading straight
 * onto the end of the sentence before it:
 *
 *     ...a determinare vasocostrizione durante uno spavento.## 3. Il bulbo
 *
 * CommonMark requires an ATX heading to begin a line, so that is not a heading
 * — it is a paragraph with two hashes in the middle of it. react-markdown is
 * right to render it literally, and the reader sees `##` in their prose and a
 * section title swallowed by the previous paragraph. Observed in an Italian
 * answer where it happened at every single heading.
 *
 * We could call that the model's fault and leave it. That would be the wrong
 * call: this application's stated position is that the *reasoning* is the
 * model's, and everything around it is ours. Rendering is ours.
 *
 * # Why it is this conservative
 *
 * A false positive is worse than a missed repair. Turning a sentence into a
 * heading damages text that was fine; leaving one glued costs two visible
 * hashes. So the split fires only where the run of hashes is welded to
 * **sentence-ending punctuation** — the shape a wrapped heading actually takes,
 * and one that cannot occur in ordinary prose. `C## is fine` is untouched, and
 * so is `problem #3`, which has no space after the hash.
 *
 * Fenced code is skipped outright. A `#` there is a comment or a shell prompt
 * and never a heading.
 */

/** Opens or closes a fenced block. Info strings after the fence are ignored. */
const FENCE = /^(?:```|~~~)/;

/**
 * A heading welded to the end of the previous sentence.
 *
 * The space after the hashes is required: it is what distinguishes an ATX
 * heading from a `#tag` or an issue number.
 */
const GLUED_HEADING = /([.!?:])(#{1,6}[ \t])/g;

export function repairGluedHeadings(markdown: string): string {
  // Cheap bail-out: the overwhelming majority of answers need nothing done.
  if (!markdown.includes("#")) return markdown;

  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (FENCE.test(line.trimStart())) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      // A blank line rather than one, so the heading closes the paragraph
      // instead of merely interrupting it — the same shape the model would
      // have written had it not run them together.
      return line.replace(GLUED_HEADING, "$1\n\n$2");
    })
    .join("\n");
}
