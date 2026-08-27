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
  { letter: "A", title: "Anterior — looking at the front", at: "left-1/2 top-0" },
  { letter: "L", title: "Left lateral — the body's own left side", at: "left-0 top-1/2" },
  { letter: "S", title: "Superior — looking down from above", at: "left-1/2 top-1/2" },
] as const;

export function StudyViewsFrame() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Hairlines rather than borders: the panels butt against each other, so
          one rule down the middle and one across is the whole grid. */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-500/30" />
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-500/30" />

      {/* Anchored to each panel's *inner* corner, by the centre cross. The
          outer corners belong to the application — the collapse toggle, the
          colour key, the controls hint, the viewpoint bar — and a letter put
          there lands on top of one of them, which is what the first version
          did. */}
      {PANELS.map(({ letter, title, at }) => (
        <span
          key={letter}
          title={title}
          className={`absolute ${at} m-2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-slate-400`}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}
