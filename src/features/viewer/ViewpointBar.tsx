import { useSceneStore } from "@/stores/sceneStore";

import {
  DOLLY_IN,
  DOLLY_OUT,
  VIEW_HINT,
  VIEW_LABEL,
  VIEW_ORDER,
} from "./cameraViews";

/**
 * Getting back to a known view, in one click.
 *
 * Orbiting a body freehand is how you end up upside down behind its left
 * shoulder with no idea how you got there, and the way out — drag until it
 * looks right again — is guesswork. These are the fixed points: five standard
 * anatomical viewpoints, a frame command, and a zoom that does not depend on
 * having a scroll wheel.
 *
 * # Why the anatomical names
 *
 * *Anterior*, *posterior*, *lateral* and *superior* are the vocabulary the
 * reader is here to learn, and the words on every radiology report they will
 * ever read. Labelling these "front" and "back" would teach the wrong term at
 * the exact moment the reader is looking at the thing it names — so the button
 * carries the letter and the tooltip carries the plain-English gloss.
 *
 * # Why fit and orient are separate
 *
 * `Fit` reframes; the viewpoints only turn, keeping whatever distance you had.
 * Turning to look at a structure from behind must not also throw away the zoom
 * you set to see it, and conflating the two would make every viewpoint button
 * an undo of your own work.
 */
export function ViewpointBar() {
  const fitView = useSceneStore((s) => s.fitView);
  const orientView = useSceneStore((s) => s.orientView);
  const dollyView = useSceneStore((s) => s.dollyView);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);

  const studying = isolatedOrganIds !== null && isolatedOrganIds.length > 0;

  return (
    <div className="pointer-events-none absolute bottom-3 right-3">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 px-2 py-1 shadow-lg backdrop-blur">
        <Key
          onClick={fitView}
          // The same scope rule the exploded view uses, said out loud: after
          // isolating a heart, "frame this" means the heart.
          title={
            studying
              ? `Frame the ${isolatedOrganIds.length} structures you are studying`
              : "Frame the whole body"
          }
          wide
        >
          Fit
        </Key>

        <span aria-hidden className="mx-0.5 h-4 w-px bg-slate-700" />

        {VIEW_ORDER.map((view) => (
          <Key key={view} onClick={() => orientView(view)} title={VIEW_HINT[view]}>
            {VIEW_LABEL[view]}
          </Key>
        ))}

        <span aria-hidden className="mx-0.5 h-4 w-px bg-slate-700" />

        <Key onClick={() => dollyView(DOLLY_OUT)} title="Move further away">
          −
        </Key>
        <Key onClick={() => dollyView(DOLLY_IN)} title="Move closer in">
          +
        </Key>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  title,
  wide = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-6 items-center justify-center rounded text-[11px] font-medium text-slate-400 transition hover:bg-slate-700/60 hover:text-sky-200 ${
        wide ? "px-2" : "w-6"
      }`}
    >
      {children}
    </button>
  );
}
