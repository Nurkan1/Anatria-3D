import { organLabel, organSubtitle, useSceneStore } from "@/stores/sceneStore";

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
  const organs = useSceneStore((s) => s.organs);
  const hovered = useSceneStore((s) => s.hoveredOrganId);
  const setHovered = useSceneStore((s) => s.setHovered);
  const applyCommand = useSceneStore((s) => s.applyCommand);

  const layers = stack.map((id) => organs[id]).filter((organ) => !!organ);
  // One entry is the thing already named under the cursor. A panel that adds
  // nothing to the hover label is furniture.
  // Switched off from the left panel or from the structure menu. Checked here
  // rather than at the mount point so the reading itself keeps being taken —
  // the renderer computes the stack either way, and turning the panel back on
  // should show the truth immediately rather than after the next pointer move.
  if (!visible) return null;
  if (layers.length < 2) return null;

  return (
    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
      <div className="pointer-events-auto w-60 overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/90 shadow-lg backdrop-blur">
        <p className="border-b border-slate-800 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Under the cursor
          <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-600">
            surface inwards
          </span>
        </p>

        <ol className="max-h-[46vh] overflow-y-auto py-1">
          {layers.map((organ, index) => (
            <li key={organ.organ_id}>
              <button
                type="button"
                onMouseEnter={() => setHovered(organ.organ_id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() =>
                  applyCommand({ action: "focus_organ", organ_id: organ.organ_id })
                }
                title={organSubtitle(organ)}
                className={`flex w-full items-center gap-2 px-2.5 py-1 text-left transition ${
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
            </li>
          ))}
        </ol>

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
