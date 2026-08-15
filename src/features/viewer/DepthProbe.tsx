import { organLabel, organSubtitle, useSceneStore } from "@/stores/sceneStore";

import { depthReadingState, DISMISS_HINT, HEADING, SUBHEADING } from "./depthReading";
import { MAX_STACK } from "./depthStack";
import { tissueHex } from "./palette";

/**
 * Everything under the cursor, from the surface inwards.
 *
 * # Why this earns its space
 *
 * "What do I pass through to reach the carotid?" is a surgical approach and an
 * oral exam in the same sentence. An atlas that only names the topmost surface
 * cannot answer it, and the answer is not a fact to look up — it depends on
 * exactly where you are pointing.
 *
 * Nothing here is inferred. It is not a model of tissue layers or a guess at
 * depth: it is the geometry a ray from the cursor actually crossed, in the
 * order it crossed it. The renderer was already computing the whole list on
 * every pointer move and discarding all but the first entry.
 */
export function DepthProbe() {
  const visible = useSceneStore((s) => s.depthProbeVisible);
  const stack = useSceneStore((s) => s.depthStack);
  const pinned = useSceneStore((s) => s.pinnedStack);
  const dismiss = useSceneStore((s) => s.dismissDepthStack);
  const organs = useSceneStore((s) => s.organs);
  const hovered = useSceneStore((s) => s.hoveredOrganId);
  const setHovered = useSceneStore((s) => s.setHovered);
  const applyCommand = useSceneStore((s) => s.applyCommand);

  // The pinned reading wins over whatever the pointer is crossing now. That
  // is the whole point of it: the journey to this panel goes over the model.
  const showing = pinned ?? stack;
  const state = depthReadingState(pinned !== null);
  const layers = showing.map((id) => organs[id]).filter((organ) => !!organ);
  // Switched off from the left panel or from the structure menu. Checked here
  // rather than at the mount point so the reading itself keeps being taken —
  // the renderer computes the stack either way, and turning the panel back on
  // should show the truth immediately rather than after the next pointer move.
  if (!visible) return null;
  // One entry is the thing already named under the cursor. A panel that adds
  // nothing to the hover label is furniture.
  if (layers.length < 2) return null;

  return (
    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
      <div
        className={`pointer-events-auto w-60 overflow-hidden rounded-lg border bg-slate-900/90 shadow-lg backdrop-blur transition-colors ${
          state === "live" ? "border-slate-700/80" : "border-sky-700/70"
        }`}
      >
        <p className="flex items-center gap-1.5 border-b border-slate-800 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {/*
            The heading changes with the state, rather than a badge appearing
            beside a fixed one. "Under the cursor" is a claim about where the
            pointer is, and the moment the pointer is elsewhere it stops being
            true — a list that says it while pointing at nothing is the kind of
            small lie that costs an interface its credibility.
          */}
          {HEADING[state]}
          <span className="font-normal normal-case tracking-normal text-slate-600">
            {SUBHEADING[state]}
          </span>
          <button
            type="button"
            onClick={dismiss}
            title={DISMISS_HINT[state]}
            className="ml-auto rounded px-1 text-slate-600 transition hover:text-slate-200"
          >
            ✕
          </button>
        </p>

        <ol className="max-h-[46vh] overflow-y-auto py-1">
          {layers.map((organ, index) => (
            <li key={organ.organ_id} className="group flex items-stretch">
              <button
                type="button"
                onMouseEnter={() => setHovered(organ.organ_id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() =>
                  applyCommand({ action: "focus_organ", organ_id: organ.organ_id })
                }
                title={organSubtitle(organ)}
                className={`flex min-w-0 flex-1 items-center gap-2 py-1 pl-2.5 pr-1 text-left transition ${
                  hovered === organ.organ_id ? "bg-sky-600/20" : "hover:bg-slate-800/70"
                }`}
              >
                <span className="w-3 shrink-0 text-right text-[9px] tabular-nums text-slate-600">
                  {index + 1}
                </span>
                {/* The tissue's own colour, so the list reads as the same body
                    the viewport is showing rather than as a table about it. */}
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/40"
                  style={{ backgroundColor: tissueHex(organ) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] italic text-slate-200">
                    {organLabel(organ)}
                  </span>
                  <span className="block truncate text-[9px] text-slate-500">
                    {organSubtitle(organ)}
                  </span>
                </span>
              </button>
              {/*
                Its own control, not a second meaning for the row.

                Clicking a line still flies to it, which is what it has always
                done and what a reader scanning the list expects. Isolating is
                a bigger act — it empties the viewport of everything else — and
                giving one gesture both jobs would make the safe one feel
                dangerous.

                `solo` because the systems list already calls it that. A panel
                that invented a third word for hiding everything else would be
                teaching a vocabulary the app does not use.
              */}
              <button
                type="button"
                onMouseEnter={() => setHovered(organ.organ_id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() =>
                  applyCommand({
                    action: "isolate_structures",
                    organ_ids: [organ.organ_id],
                  })
                }
                title={`Show only ${organLabel(organ)} — Esc restores`}
                className="shrink-0 px-1.5 text-[8px] uppercase tracking-wide text-slate-700 opacity-0 transition group-hover:opacity-100 hover:text-sky-300 focus-visible:opacity-100"
              >
                solo
              </button>
            </li>
          ))}
        </ol>

        {/*
          The whole crossing, which is the thing this panel is actually about.
          A ray through the shoulder is a surgical approach written down, and
          isolating it leaves exactly that on screen with the rest of the body
          out of the way.
        */}
        {layers.length > 1 && (
          <button
            type="button"
            onClick={() =>
              applyCommand({
                action: "isolate_structures",
                organ_ids: layers.map((organ) => organ.organ_id),
              })
            }
            title="Leave only what the ray crosses — Esc restores"
            className="w-full border-t border-slate-800 px-2.5 py-1 text-left text-[9px] uppercase tracking-wide text-slate-500 transition hover:bg-slate-800/60 hover:text-sky-300"
          >
            Isolate these {layers.length}
          </button>
        )}

        {layers.length >= MAX_STACK && (
          // Said out loud rather than left as a silent truncation: a ray
          // through the abdomen crosses far more than a dozen things, and a
          // list that simply stops looks like an answer that ended.
          <p className="border-t border-slate-800 px-2.5 py-1 text-[9px] text-slate-600">
            Nearest {MAX_STACK} — the ray goes deeper than this.
          </p>
        )}
      </div>
    </div>
  );
}
