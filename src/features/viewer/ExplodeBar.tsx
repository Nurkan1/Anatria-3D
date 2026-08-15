import { useEffect, useState } from "react";

import { useSceneStore } from "@/stores/sceneStore";

import { explodeScope, MAX_EXPLODE } from "./explode";
import { viewportKey } from "./viewportKeys";

/**
 * The exploded view's presence over the canvas, and the key that drives it.
 *
 * Same argument as the study bar: a state that rearranges the whole picture
 * needs a visible way out that does not depend on a side panel being open. So
 * this carries the fact that it is on, what it is acting on, the separation
 * itself, and one button to put the body back together.
 *
 * The slider is here as well as in the panel deliberately. Choosing the exact
 * separation that shows a particular relationship is done by *watching the
 * model*, and a control on the far side of the window means looking away from
 * the thing being adjusted while adjusting it.
 *
 * The keyboard handler is deliberately outside the chip, so `X` works before
 * anything has been exploded — which is the moment it is needed.
 */
export function ExplodeBar() {
  const explode = useSceneStore((s) => s.explode);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const cycleExplode = useSceneStore((s) => s.cycleExplode);
  const setExplode = useSceneStore((s) => s.setExplode);

  /**
   * Whether the reader currently has hold of the slider, by pointer or by
   * keyboard focus.
   *
   * The bar exists because something is exploded, so it would otherwise vanish
   * the instant the slider reached zero — out from under the very finger
   * dragging it, with no way back short of starting again. Holding it open
   * while it is being used is what lets someone slide all the way down, see the
   * anatomy closed, and come straight back up.
   */
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!held) return;
    const release = () => setHeld(false);
    // On `window`: a drag that leaves the slider and is released over the
    // canvas would otherwise never let go.
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [held]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (viewportKey(event) !== "x") return;
      event.preventDefault();
      cycleExplode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleExplode]);

  if (explode <= 0 && !held && !focused) return null;

  const scope = explodeScope({ selectedOrganIds, isolatedOrganIds });
  const subject =
    scope === "selection"
      ? `${selectedOrganIds.length} selected`
      : scope === "region"
        ? `${isolatedOrganIds?.length ?? 0} isolated`
        : "the whole body";

  return (
    // Stacked above the viewpoint bar, which is always there and owns the
    // corner. This one only appears while something is exploded.
    <div className="pointer-events-none absolute bottom-14 right-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-violet-800/70 bg-slate-900/95 px-3 py-1.5 shadow-lg backdrop-blur">
        {/* Held open at zero while the slider is in hand, and the label has to
            follow — "Exploded" over an intact body is a small lie the reader
            can see. */}
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            explode > 0
              ? "bg-violet-500/20 text-violet-300"
              : "bg-slate-700/50 text-slate-400"
          }`}
        >
          {explode > 0 ? "Exploded" : "Whole"}
        </span>
        <span className="text-[11px] text-slate-400">{subject}</span>
        {/*
          The same setting as the slider in the panel, put where the reader is
          actually looking.

          The key steps through four fixed amounts, which is right for knocking
          a group apart and back without aiming. Finding the *one* separation
          that shows a particular relationship is a different job, and doing it
          from a panel means watching the model out of the corner of your eye
          while your hand is somewhere else.
        */}
        <input
          type="range"
          min={0}
          max={MAX_EXPLODE}
          step={0.05}
          value={explode}
          aria-label="How far apart to push the parts"
          title="Drag to set the separation — X steps through it from the keyboard"
          onChange={(event) => setExplode(Number(event.target.value))}
          onPointerDown={() => setHeld(true)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-1 w-28 cursor-ew-resize accent-violet-500"
        />
        <button
          type="button"
          onClick={() => setExplode(0)}
          title="Put every part back where the body keeps it"
          className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-violet-600 hover:text-violet-200"
        >
          Reassemble
        </button>
      </div>
    </div>
  );
}
