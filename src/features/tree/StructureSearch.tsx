import { useMemo, useState } from "react";

import type { ManifestOrgan } from "@/lib/schemas";
import { useSceneStore } from "@/stores/sceneStore";

/** Enough to choose from without turning the panel into a scroll marathon. */
const MAX_RESULTS = 40;

/**
 * Search every structure in the atlas, loaded or not.
 *
 * With ~2,400 structures across nine systems, browsing the tree stops being a
 * way to find anything specific. Searching covers the whole manifest rather
 * than the visible systems, because "where is the cornea?" is exactly the
 * question you ask *before* knowing which system to switch on — a result from a
 * hidden system says so and offers to load it.
 *
 * Matching runs over Latin and English together, so either nomenclature finds
 * the structure.
 */
export function StructureSearch() {
  const organs = useSceneStore((s) => s.organs);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);
  const selectOrgan = useSceneStore((s) => s.selectOrgan);
  const setHovered = useSceneStore((s) => s.setHovered);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const toggleSystem = useSceneStore((s) => s.toggleSystem);

  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (needle.length < 2) return [];
    const matches: ManifestOrgan[] = [];
    for (const organ of Object.values(organs)) {
      if (
        organ.ta2_latin.toLowerCase().includes(needle) ||
        organ.name_en.toLowerCase().includes(needle)
      ) {
        matches.push(organ);
      }
    }
    // Shortest name first: an near-exact term outranks the long compound names
    // that merely contain it.
    matches.sort((a, b) => a.ta2_latin.length - b.ta2_latin.length);
    return matches;
  }, [organs, needle]);

  const shown = results.slice(0, MAX_RESULTS);

  function reveal(organ: ManifestOrgan) {
    // A hit in a system that is switched off is useless until it is loaded, so
    // selecting one turns its system on rather than quietly doing nothing.
    if (hiddenSystems.includes(organ.system)) toggleSystem(organ.system);
    selectOrgan(organ.organ_id);
    applyCommand({ action: "focus_organ", organ_id: organ.organ_id });
  }

  return (
    <section className="border-b border-slate-800 px-3 py-2">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all structures…"
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 pr-12 text-xs outline-none placeholder:text-slate-600 focus:border-sky-500"
        />
        {needle.length >= 2 && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">
            {results.length}
          </span>
        )}
      </div>

      {needle.length >= 2 && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded border border-slate-800 bg-slate-950/60">
          {shown.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-slate-600">No structure matches.</p>
          )}
          {shown.map((organ) => {
            const notLoaded = hiddenSystems.includes(organ.system);
            return (
              <button
                key={organ.organ_id}
                type="button"
                onMouseEnter={() => !notLoaded && setHovered(organ.organ_id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => reveal(organ)}
                className="flex w-full flex-col items-start gap-0.5 border-b border-slate-900 px-2 py-1.5 text-left last:border-0 hover:bg-slate-800/60"
              >
                {organ.path.length > 0 && (
                  <span className="w-full truncate text-[9px] text-slate-600">
                    {organ.path.slice(-2).join(" › ")}
                  </span>
                )}
                <span className="w-full truncate text-[11px] italic text-slate-200">
                  {organ.ta2_latin}
                </span>
                <span className="flex w-full items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">
                    {organ.name_en}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1 text-[9px] ${
                      notLoaded
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {notLoaded ? `load ${organ.system}` : organ.system}
                  </span>
                </span>
              </button>
            );
          })}
          {results.length > shown.length && (
            <p className="px-2 py-1.5 text-[10px] text-slate-600">
              {results.length - shown.length} more — narrow the search.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
