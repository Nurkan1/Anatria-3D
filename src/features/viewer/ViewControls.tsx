import { GLASS_OPACITY, useSceneStore } from "@/stores/sceneStore";

/**
 * How the model is drawn, as opposed to what is in it.
 *
 * # Why it is not inside the anatomy tree any more
 *
 * It was, and that made it reachable only from the Atlas tab. But these are the
 * controls somebody reaches for *while reading* — turning the body to glass to
 * see what a note describes, draining the colour to find what is marked,
 * putting the view back after losing it. Reading is what the Study tab is for,
 * and having to leave it to make the model legible is the wrong way round.
 *
 * So the strip belongs to the panel rather than to any one tab, and it is
 * mounted once below all three.
 *
 * # Why it stays pinned
 *
 * The reason it was pinned inside the tree still holds: Systems expands, one
 * open system is hundreds of rows, and anything sharing that scroll container
 * is a scroll away the moment somebody opens one. These are the controls
 * reached for most often, which makes them the ones that must not move.
 *
 * No heading, unlike the sections above it. This is on screen permanently, so
 * its height is paid for on every frame, and the buttons already say what they
 * do.
 */
export function ViewControls() {
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const clearIsolation = useSceneStore((s) => s.clearIsolation);
  const showAllSystems = useSceneStore((s) => s.showAllSystems);
  const glassBody = useSceneStore((s) => s.glassBody);
  const bodyTone = useSceneStore((s) => s.bodyTone);
  const cycleBodyTone = useSceneStore((s) => s.cycleBodyTone);
  const systemOpacity = useSceneStore((s) => s.systemOpacity);
  const clearGhosting = useSceneStore((s) => s.clearGhosting);
  const resetView = useSceneStore((s) => s.resetView);
  const manifest = useSceneStore((s) => s.manifest);

  // Every system at the glass setting, which is what the button both makes and
  // undoes. Derived rather than stored: a flag could disagree with the
  // opacities the moment one system was cycled by hand. Read from the manifest
  // because that is the list the action itself works from.
  const isGlass =
    (manifest?.systems.length ?? 0) > 0 &&
    (manifest?.systems ?? []).every(
      (entry) => systemOpacity[entry.system] === GLASS_OPACITY,
    );

  return (
    <section className="flex shrink-0 flex-wrap gap-2 border-t border-slate-800 px-4 py-3">
      {isolatedOrganIds !== null && (
        <button
          type="button"
          onClick={clearIsolation}
          className="rounded border border-amber-600/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-300"
        >
          Showing {isolatedOrganIds.length} isolated — clear
        </button>
      )}
      <button
        type="button"
        onClick={showAllSystems}
        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400"
      >
        Show all systems
      </button>
      <button
        type="button"
        onClick={glassBody}
        title="Turn the whole body to glass — then point at it, and what lies under the cursor lights up"
        aria-pressed={isGlass}
        className={`rounded border px-2 py-1 text-xs ${
          isGlass
            ? "border-amber-500/70 bg-amber-400/15 text-amber-200"
            : "border-slate-700 text-slate-400"
        }`}
      >
        Glass body
      </button>
      {/*
        Beside Glass body rather than as another checkbox above, because it
        answers the same question those buttons do — *how* the body is drawn,
        not *what* is drawn. There are already several ways to play down the
        anatomy, and grouping the ones that change its appearance keeps them
        from reading as five unrelated switches.
      */}
      {/*
        One button stepping through three tones rather than three buttons.

        They are mutually exclusive answers to one question — how much of the
        tissue's own appearance survives — and a row of three would read as
        three unrelated switches in a column that already has several. The label
        says what you are looking at, not what the next press does: a control
        that names a state you cannot see is a riddle.
      */}
      <button
        type="button"
        onClick={cycleBodyTone}
        title={
          bodyTone === "solid"
            ? "Drain the colour from everything except what is marked, selected or isolated"
            : bodyTone === "scan"
              ? "Press the drained body down towards black, so the scanner's light has somewhere to go"
              : "Give the body its colour back"
        }
        aria-pressed={bodyTone !== "solid"}
        className={`rounded border px-2 py-1 text-xs ${
          bodyTone === "carbon"
            ? "border-slate-100/80 bg-slate-950 text-slate-100"
            : bodyTone === "scan"
              ? "border-slate-300/70 bg-slate-200/15 text-slate-100"
              : "border-slate-700 text-slate-400"
        }`}
      >
        {bodyTone === "carbon" ? "Carbon" : "Scan"}
      </button>
      {Object.keys(systemOpacity).length > 0 && (
        <button
          type="button"
          onClick={clearGhosting}
          title="Make every layer solid again"
          className="rounded border border-sky-700/70 bg-sky-600/15 px-2 py-1 text-xs text-sky-300"
        >
          Solid again
        </button>
      )}
      <button
        type="button"
        onClick={resetView}
        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400"
      >
        Reset view
      </button>
    </section>
  );
}
