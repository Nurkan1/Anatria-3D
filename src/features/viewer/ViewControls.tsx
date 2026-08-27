import { GLASS_OPACITY, useSceneStore } from "@/stores/sceneStore";
import { useStudyViewsStore } from "@/stores/studyViewsStore";

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
  const scan = useSceneStore((s) => s.scan);
  const toggleScan = useSceneStore((s) => s.toggleScan);
  const systemOpacity = useSceneStore((s) => s.systemOpacity);
  const clearGhosting = useSceneStore((s) => s.clearGhosting);
  const resetView = useSceneStore((s) => s.resetView);
  const manifest = useSceneStore((s) => s.manifest);
  const studyViews = useStudyViewsStore((s) => s.wanted);
  const setStudyViews = useStudyViewsStore((s) => s.setWanted);

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
      <button
        type="button"
        onClick={toggleScan}
        title="Drain the colour from everything except what is marked, selected or isolated"
        aria-pressed={scan}
        className={`rounded border px-2 py-1 text-xs ${
          scan
            ? "border-slate-300/70 bg-slate-200/15 text-slate-100"
            : "border-slate-700 text-slate-400"
        }`}
      >
        Scan
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
      {/*
        Here rather than floating over the viewport, because it answers the
        same question the buttons beside it do: how the model is drawn.

        Only offered once something is isolated, and that is a limit rather than
        a preference. Four panels of the whole atlas is four passes over 3,478
        meshes — about fourteen thousand draw calls, which holds no frame rate
        anywhere. One isolated structure is one draw call, so four panels of it
        cost four. The gate is the whole reason the mode is affordable, which is
        why it is enforced here and not written down somewhere as advice.
      */}
      <button
        type="button"
        onClick={() => setStudyViews(!studyViews)}
        disabled={isolatedOrganIds === null}
        aria-pressed={studyViews}
        title={
          isolatedOrganIds === null
            ? "Isolate a structure first — four views of the whole atlas will not hold a frame rate"
            : "See what is isolated from three fixed angles at once, beside the view you drive"
        }
        className={`rounded border px-2 py-1 text-xs disabled:opacity-40 ${
          studyViews
            ? "border-sky-500 bg-sky-500/10 text-sky-300"
            : "border-slate-700 text-slate-400"
        }`}
      >
        Study views
      </button>
    </section>
  );
}
