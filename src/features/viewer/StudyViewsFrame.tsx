/**
 * The lines between the panels, and the letter naming each one.
 *
 * # Why this is DOM and not WebGL
 *
 * A divider drawn into the scene would have to be a screen-space quad in a
 * fifth pass, sized in device pixels, redrawn every frame, and told about the
 * device pixel ratio. Two absolutely-positioned rules do the same job, stay
 * crisp at any DPR, and cost nothing per frame. The same goes for the letters:
 * text in WebGL means a texture atlas; text in the DOM means text.
 *
 * It is also where the `A/P`, `L/R` and `S/I` indicators belong when they
 * arrive — they are exactly this kind of chrome.
 */

/**
 * The three auxiliary panels and the corner each one owns.
 *
 * The main panel is deliberately unlabelled. It is the one being driven, it
 * has the controls and the labels, and a letter on it would be naming the
 * thing the reader is already holding.
 */
const PANELS = [
  {
    letter: "A",
    title: "Anterior — looking at the front",
    // Above the rule and right of it: inside the top-right panel.
    shift: "translate(0.5rem, calc(-100% - 0.5rem))",
  },
  {
    letter: "L",
    title: "Left lateral — the body's own left side",
    shift: "translate(calc(-100% - 0.5rem), 0.5rem)",
  },
  {
    letter: "S",
    title: "Superior — looking down from above",
    shift: "translate(0.5rem, 0.5rem)",
  },
] as const;

export function StudyViewsFrame() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Hairlines rather than borders: the panels butt against each other, so
          one rule down the middle and one across is the whole grid. */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-500/30" />
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-500/30" />

      {/* All three hang off the centre point, each pushed into its own panel.
          The edges of the viewport are all spoken for — the collapse toggle,
          the colour key, the study bar, the controls hint, the viewpoint bar —
          and the first two attempts put a letter under one of them. The middle
          is the only ground nothing else claims. */}
      {PANELS.map(({ letter, title, shift }) => (
        <span
          key={letter}
          title={title}
          style={{ transform: shift }}
          className="absolute left-1/2 top-1/2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-slate-400"
        >
          {letter}
        </span>
      ))}
    </div>
  );
}
