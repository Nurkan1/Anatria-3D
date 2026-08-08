import type { AnatomicalSystem } from "@/lib/schemas";
import { organLabel, useSceneStore } from "@/stores/sceneStore";

import { useDraggablePanel } from "./useDraggablePanel";

/** Where the pathway badge sits, remembered between sessions. */
const POSITION_KEY = "anatria3d.pathwayBar.v1";

/**
 * Systems a route needs that are currently switched off.
 *
 * The viewer skips stops it cannot measure, so the badge would otherwise name
 * three stops while the curve joins two — a wrong picture with no explanation.
 * Deduplicated: a route crossing four unloaded digestive structures is one
 * switch to throw, not four.
 */
export function unloadedSystems(
  stops: { system: AnatomicalSystem }[],
  hiddenSystems: AnatomicalSystem[],
): AnatomicalSystem[] {
  const hidden = new Set(hiddenSystems);
  return [...new Set(stops.map((stop) => stop.system).filter((system) => hidden.has(system)))];
}

/**
 * The badge shown while a physiological route is being traced.
 *
 * An animation running in the viewport with nothing to name or stop it is the
 * same trap as isolation without an exit: the reader sees a violet marker
 * crossing the body and has no way to know what it represents, or to make it
 * stop. So the route announces what it is, lists its stops in order, and offers
 * both a replay and a way out.
 *
 * The order matters as much as the animation — a reader who missed the marker
 * passing through the duodenum can still read that it went there, and in what
 * position. That is why this lists the stops rather than only counting them.
 */
export function PathwayBar() {
  const pathway = useSceneStore((s) => s.pathway);
  const organs = useSceneStore((s) => s.organs);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);
  const toggleSystem = useSceneStore((s) => s.toggleSystem);
  const clearPathway = useSceneStore((s) => s.clearPathway);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const { ref, position, moved, reset, handleProps } = useDraggablePanel(POSITION_KEY);

  if (!pathway) return null;

  const stops = pathway.organIds
    .map((organId) => organs[organId])
    .filter((organ) => !!organ);

  /**
   * Stops the viewer cannot draw, because their system is switched off and so
   * they were never measured.
   *
   * The route silently skips them, which leaves the badge naming three stops
   * while the curve joins two — a discrepancy the reader has no way to explain.
   * Naming the missing system, and offering to switch it on, turns a wrong
   * picture into a fixable one.
   */
  const unloaded = unloadedSystems(stops, hiddenSystems);

  return (
    <div
      ref={ref}
      {...(position
        ? { style: { left: position.x, top: position.y } }
        : // Below the top bar, not under it. The disclaimer strip and the panel
          // toggles own the first 36 px, and a badge starting above that has its
          // own header — the label and the stop buttons — hidden behind them.
          { style: { right: 12, top: 44 } })}
      className="pointer-events-auto absolute w-64 overflow-hidden rounded-lg border border-fuchsia-800/60 bg-slate-900/95 shadow-lg backdrop-blur"
    >
      <div
        {...handleProps}
        onDoubleClick={reset}
        title="Drag to move · double-click to put it back"
        className="flex cursor-grab items-center gap-2 px-2.5 py-1.5 active:cursor-grabbing"
      >
        <span aria-hidden className="select-none text-[10px] leading-none text-slate-600">
          ⠿
        </span>
        <span className="shrink-0 rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-300">
          Pathway
        </span>
        {moved && (
          <button
            type="button"
            onClick={reset}
            title="Put the badge back where it started"
            className="shrink-0 rounded px-1 text-[9px] text-slate-600 transition hover:text-slate-300"
          >
            reset
          </button>
        )}
        <button
          type="button"
          // Re-issuing the same command bumps `seq`, which is what the viewer
          // watches to restart the traversal from the first stop.
          onClick={() =>
            applyCommand({
              action: "highlight_pathway",
              label: pathway.label,
              organ_ids: pathway.organIds,
              step_seconds: pathway.stepSeconds,
              loop: pathway.loop,
            })
          }
          title="Trace it again from the start"
          className="ml-auto shrink-0 rounded px-1 text-[10px] text-slate-500 transition hover:text-fuchsia-200"
        >
          replay
        </button>
        <button
          type="button"
          onClick={clearPathway}
          title="Stop tracing this route"
          aria-label="Stop tracing this route"
          className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] leading-none text-slate-400 transition hover:border-fuchsia-600 hover:text-fuchsia-200"
        >
          ✕
        </button>
      </div>

      <div className="border-t border-slate-800 px-2.5 py-1.5">
        <p className="text-[11px] font-medium text-slate-200">{pathway.label}</p>
        {stops.length > 0 && (
          <p
            // Capped: a 24-stop route would otherwise grow the badge over the
            // model it is describing.
            className="mt-1 max-h-24 overflow-y-auto text-[10px] italic leading-snug text-slate-500"
          >
            {stops.map(organLabel).join(" → ")}
          </p>
        )}

        {unloaded.length > 0 && (
          <p className="mt-1.5 text-[10px] leading-snug text-amber-400">
            Part of this route is not on screen —{" "}
            {unloaded.map((system, index) => (
              <span key={system}>
                {index > 0 && ", "}
                <button
                  type="button"
                  onClick={() => toggleSystem(system)}
                  className="underline decoration-dotted underline-offset-2 hover:text-amber-300"
                >
                  switch on {system}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
