import { VIEW_HINT } from "./cameraViews";
import { domRect, MAIN, panelLayout, type AuxiliaryView } from "./studyLayout";
import { useStudyViewsStore } from "@/stores/studyViewsStore";

/**
 * The lines between the panels, and the letter naming each one.
 *
 * # Why this is DOM and not WebGL
 *
 * A divider drawn into the scene would have to be a screen-space quad in a
 * fifth pass, sized in device pixels, redrawn every frame, and told about the
 * device pixel ratio. Absolutely-positioned rules do the same job, stay crisp
 * at any DPR, and cost nothing per frame. The same goes for the letters: text
 * in WebGL means a texture atlas; text in the DOM means text.
 *
 * # Why the letters are buttons
 *
 * Because the panel they name is the thing a reader wants to be rid of. Three
 * angles is right for learning a shape and wrong for reading a long structure,
 * and the letter is already sitting on the panel it would close — a separate
 * control elsewhere would be a second thing to find and learn. Switching the
 * last one off is allowed: that leaves the view you drive filling the canvas,
 * which is a legitimate thing to want without leaving the mode.
 */

/** One letter per view, matching the viewpoint bar. */
const LETTER: Record<AuxiliaryView, string> = {
  anterior: "A",
  left: "L",
  superior: "S",
};

/**
 * Where a panel's letter sits: the corner of that panel nearest the middle of
 * the canvas, pushed back inside it.
 *
 * The edges of the viewport are all spoken for — the collapse toggle, the
 * colour key, the study bar, the controls column, the viewpoint bar — and the
 * first two attempts at this put a letter underneath one of them. The middle is
 * the only ground nothing else claims, and every panel has a corner facing it.
 *
 * In the quartered layout this puts all three letters around the centre point,
 * which is where they already were.
 */
function corner(rect: ReturnType<typeof domRect>) {
  const nearX = Math.min(Math.max(0.5, rect.left), rect.left + rect.width);
  const nearY = Math.min(Math.max(0.5, rect.top), rect.top + rect.height);
  const pad = "0.5rem";

  return {
    left: `${nearX * 100}%`,
    top: `${nearY * 100}%`,
    transform: `translate(${nearX > rect.left ? `calc(-100% - ${pad})` : pad}, ${
      nearY > rect.top ? `calc(-100% - ${pad})` : pad
    })`,
  };
}

export function StudyViewsFrame() {
  const active = useStudyViewsStore((state) => state.active);
  const toggleView = useStudyViewsStore((state) => state.toggleView);
  const layout = panelLayout(active);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* One rule along each inner edge. Drawn from the panels themselves
          rather than as a fixed cross, so a layout with one divider gets one
          and the quartered one still gets two. An edge that lies on the canvas
          border is not a divider and is skipped. */}
      {layout.map((panel) => {
        const rect = domRect(panel);
        return (
          <div key={`edge-${panel.id}`}>
            {rect.left > 0 && (
              <div
                className="absolute w-px bg-slate-500/30"
                style={{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            )}
            {rect.top > 0 && (
              <div
                className="absolute h-px bg-slate-500/30"
                style={{
                  top: `${rect.top * 100}%`,
                  left: `${rect.left * 100}%`,
                  width: `${rect.width * 100}%`,
                }}
              />
            )}
          </div>
        );
      })}

      {/* The main panel is deliberately unlettered. It is the one being driven,
          it has the controls and the labels, and a letter on it would be naming
          the thing the reader is already holding. */}
      {layout.map((panel) => {
        // Skipped by identity rather than by position: `panelLayout` puts the
        // driven panel first today, and this must not quietly start lettering
        // it if that ever changes.
        if (panel.id === MAIN) return null;
        const view: AuxiliaryView = panel.id;
        return (
          <button
            key={panel.id}
            type="button"
            onClick={() => toggleView(view)}
            title={`${VIEW_HINT[view]} — click to close this panel`}
            style={{ position: "absolute", ...corner(domRect(panel)) }}
            className="pointer-events-auto rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            {LETTER[view]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The views that are switched off, offered back.
 *
 * Separate from the frame because a panel that does not exist has nowhere to
 * put its own letter. This lives in the column of view controls over the
 * viewport, beside the switch that opened the mode — which is where a reader
 * goes looking for the thing that turns panels on, and the only place in that
 * corner with room.
 *
 * Renders nothing at all while every view is on, so the common case pays no
 * chrome for a control it does not need.
 */
export function ClosedViews() {
  const active = useStudyViewsStore((state) => state.active);
  const toggleView = useStudyViewsStore((state) => state.toggleView);
  const closed = (Object.keys(LETTER) as AuxiliaryView[]).filter(
    (view) => !active.includes(view),
  );

  if (closed.length === 0) return null;

  return (
    <div className="pointer-events-auto flex items-center gap-1">
      {closed.map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => toggleView(view)}
          title={`${VIEW_HINT[view]} — click to open this panel again`}
          className="rounded border border-slate-800/60 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-slate-600 transition hover:border-slate-600 hover:text-slate-300"
        >
          {LETTER[view]}
        </button>
      ))}
    </div>
  );
}
