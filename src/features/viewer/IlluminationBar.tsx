import { organLabel, useSceneStore } from "@/stores/sceneStore";

/**
 * What the assistant is pointing at, and how to stop it.
 *
 * Same argument as the study bar and the exploded-view chip: the reader did not
 * put the scene in this state, so there has to be a visible way out of it that
 * does not depend on knowing which control caused it. It also answers the
 * question the light itself cannot — *why* is this lit — by naming the
 * structures, which is what makes the light readable when several are on at
 * once.
 */
export function IlluminationBar() {
  const illuminated = useSceneStore((s) => s.illuminated);
  const organs = useSceneStore((s) => s.organs);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const setHovered = useSceneStore((s) => s.setHovered);

  const lit = illuminated.map((id) => organs[id]).filter((organ) => !!organ);
  if (lit.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center">
      <div className="pointer-events-auto flex max-w-[80%] items-center gap-2 rounded-full border border-amber-700/60 bg-slate-900/95 px-3 py-1.5 shadow-lg backdrop-blur">
        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
          Lit
        </span>

        <div className="flex min-w-0 items-center gap-2">
          {/* The first few by name. The whole list would be the wall the light
              is meant to save the reader from. */}
          {lit.slice(0, 3).map((organ) => (
            <span
              key={organ.organ_id}
              onMouseEnter={() => setHovered(organ.organ_id)}
              onMouseLeave={() => setHovered(null)}
              className="max-w-48 truncate text-xs italic text-slate-300"
            >
              {organLabel(organ)}
            </span>
          ))}
          {lit.length > 3 && (
            <span className="shrink-0 text-[10px] text-slate-500">
              +{lit.length - 3}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => applyCommand({ action: "illuminate_structures", organ_ids: [] })}
          title="Turn the assistant's light off"
          className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-amber-600 hover:text-amber-200"
        >
          Turn off
        </button>
      </div>
    </div>
  );
}
