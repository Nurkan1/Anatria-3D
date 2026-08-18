/**
 * What lies under the cursor, from the surface inwards.
 *
 * # The question this answers
 *
 * "What do I go through to reach the carotid?" is a surgical approach and an
 * oral exam in the same sentence, and an atlas that only ever names the topmost
 * surface cannot answer it. Point at the neck and the honest answer is a list:
 * skin region, platysma, sternocleidomastoid, carotid sheath, common carotid.
 *
 * # Why this costs almost nothing
 *
 * The renderer already computes it. A ray cast into the scene returns *every*
 * mesh it crosses, sorted by distance — the viewer has always taken the first
 * one and thrown the rest away on every pointer move. This reads the list that
 * was already there.
 *
 * Nothing is inferred. It is not a model of layers or a guess at depth: it is
 * the geometry the ray actually passed through, in the order it passed through
 * it.
 */

/**
 * How deep the list goes before it stops being read.
 *
 * A ray through the abdomen crosses a great many things. Past a dozen the panel
 * stops being an answer and becomes a wall, and the entries that matter for an
 * approach are the near ones.
 */
export const MAX_STACK = 12;

/**
 * How deep the light reaches.
 *
 * The panel lists a dozen structures; lighting a dozen at once would be a lit
 * column rather than a lit organ. Six is about as far as the eye follows a
 * gradient before the far end stops reading as "further away" and starts
 * reading as "also selected".
 */
export const PROBE_REACH = 6;

/**
 * How brightly a structure at this depth is lit, 0 to 1.
 *
 * Linear falloff, deliberately: the point is to read *order* — which of these
 * is nearer the surface — and an exponential curve collapses everything past
 * the second layer into the same dimness.
 */
export function probeGlow(depth: number): number {
  if (!Number.isFinite(depth) || depth < 0 || depth >= PROBE_REACH) return 0;
  return 1 - depth / PROBE_REACH;
}

/**
 * The dimmest the assistant's light ever falls, on the last structure it named.
 *
 * Not zero, and that is the whole point of the constant existing.
 */
export const LIT_DIMMEST = 0.55;

/**
 * How brightly the assistant's light falls on the structure it named `index`th.
 *
 * # Why this is not `probeGlow`
 *
 * It used to be, and the two are different measurements wearing the same shape.
 * `probeGlow` grades a **depth** — how far into the body the cursor's ray has
 * travelled — and returns 0 past `PROBE_REACH`, which is correct there: a
 * column six layers deep is as far as the eye follows a gradient.
 *
 * An illumination index is not a depth. It is the order the assistant named
 * things in, the engine allows 24 of them, and borrowing the depth falloff meant
 * **the seventh structure named and everything after it was not lit at all** —
 * while the answer still carried a numbered pin pointing at it. Within the six
 * that did light, the last arrived at a sixth of the brightness of the first,
 * which on a deep structure behind a ghosted cerebrum is indistinguishable from
 * unlit.
 *
 * The gradient is kept, because reading order is worth something and the first
 * structure named is usually the subject of the sentence. It now runs from full
 * brightness to `LIT_DIMMEST` across however many were named, so the dimmest is
 * still unmistakably lit and nothing the assistant points at is invisible.
 */
export function illuminationGlow(index: number, count: number): number {
  if (!Number.isFinite(index) || index < 0 || index >= count) return 0;
  if (count <= 1) return 1;
  return 1 - (index / (count - 1)) * (1 - LIT_DIMMEST);
}

/** The shape this needs from a three.js intersection, and no more. */
interface Crossed {
  object: { userData?: Record<string, unknown> };
}

/**
 * Structure ids along the ray, nearest first.
 *
 * Deduplicated, because a single concave mesh is crossed more than once — a ray
 * entering and leaving a ventricle would otherwise name it twice with something
 * else sandwiched in between, which reads as an anatomical claim rather than as
 * an artefact of the shape.
 */
export function stackFromCrossings(crossings: Iterable<Crossed>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];

  for (const crossing of crossings) {
    const organId = crossing.object?.userData?.organId;
    if (typeof organId !== "string" || seen.has(organId)) continue;
    seen.add(organId);
    order.push(organId);
    if (order.length >= MAX_STACK) break;
  }
  return order;
}

/**
 * Whether two readings are the same list.
 *
 * The pointer emits far more moves than the stack changes, and every write is a
 * re-render of the scene graph. Comparing first is what keeps a slow sweep
 * across the chest from re-rendering three thousand meshes sixty times a
 * second.
 */
export function sameStack(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/**
 * Knowing when the pointer is over nothing at all.
 *
 * A mesh reports a reading only when the ray hits it. Move onto the background
 * and no handler runs, so the last reading would sit there describing a place
 * the cursor left. The panel has to clear, and only the container knows the
 * pointer moved at all.
 *
 * The two halves are in different trees — the crossings are inside the canvas,
 * the fallback is DOM — so a shared flag rather than event plumbing, the same
 * shape as the lasso's click suppression. It works because the canvas's own
 * listener runs while the event is still bubbling, before React dispatches to
 * the container above it.
 */
let reported = false;

export function reportDepthStack(): void {
  reported = true;
}

/** True if a structure answered for the pointer event that just happened. */
export function consumeDepthStackReport(): boolean {
  const answered = reported;
  reported = false;
  return answered;
}

let clicked = false;

/**
 * A structure took the click, so the viewport does not have to.
 *
 * The same shape as the flag above, for a different gap. A structure faded
 * past `GHOST_CLICK_THROUGH` refuses clicks on purpose — that is what lets you
 * ghost the skin and pick the muscle under it, because the event carries on
 * down the ray to the first thing solid enough to want it.
 *
 * With the whole body ghosted there is no such thing, and every handler along
 * the ray declines in turn. Single-click selection simply stopped working,
 * while double-click — which never had the guard — went on isolating, so the
 * viewport looked like it was ignoring one gesture and not the other.
 *
 * The reading is still being taken the whole time: `onPointerMove` has no
 * guard either, which is why the panel keeps listing what is there. So the
 * viewport can answer the click from what it already knows, and this flag is
 * how it learns nobody else did.
 */
export function reportClick(): void {
  clicked = true;
}

export function consumeClickReport(): boolean {
  const answered = clicked;
  clicked = false;
  return answered;
}
