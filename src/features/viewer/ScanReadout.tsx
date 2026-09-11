import { useEffect, useRef, useState } from "react";

import { organLabel, useSceneStore } from "@/stores/sceneStore";
import { useScanStore } from "@/stores/scanStore";

import { CURRENT_CROSSING, SWEEP_RUNNING } from "./scanCrossing";
import { CURRENT_LEVEL } from "./vertebralLevel";
import { OVERLAY_CHIP, OVERLAY_CHIP_ACTION } from "./overlayChrome";

/**
 * What the sweep is passing through, named as it passes it.
 *
 * # Why this is the half that matters
 *
 * A glowing line travelling down a chest looks like a scanner and teaches
 * nothing — it does not say *lung*. This is where the mode stops being a
 * screensaver: the reader watches the plane arrive at something and is told
 * what it has reached.
 *
 * # Why it writes to the DOM instead of re-rendering
 *
 * The same reason `RenderStats` does. The crossing changes several times a
 * second, and putting that through React state would re-render a tree with
 * 3,478 meshes in it to change six words. The panel keeps its own frame loop
 * and writes `textContent`, so the scene never learns this exists.
 *
 * # Why the count is shown even though the names are not
 *
 * A plane through the thorax crosses two hundred structures. Six of them are
 * named because six is what anyone reads, and the rest are counted because a
 * shortlist that looked like the whole list would be a claim about anatomy that
 * is false. "and 212 more" is the honest half of the sentence.
 */
export function ScanReadout() {
  const organs = useSceneStore((s) => s.organs);
  /**
   * Visibility is React state; the words are not.
   *
   * The two change at completely different rates. This flips once when the
   * sweep is switched on and once when it is switched off, which is exactly
   * what state is for. The names change several times a second, which is
   * exactly what it is not — those are written straight to the DOM below.
   *
   * It began as an imperative `style.display` for both, and that failed
   * silently: React owns the props of an element it renders, and telling it one
   * thing while writing another to the DOM is a race nobody can see losing.
   */
  const [running, setRunning] = useState(false);
  const shown = useScanStore((s) => s.readout);
  const toggleReadout = useScanStore((s) => s.toggleReadout);
  const list = useRef<HTMLParagraphElement>(null);
  const rest = useRef<HTMLParagraphElement>(null);
  const level = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      const { organIds, total } = CURRENT_CROSSING.value;
      // Shown while the sweep runs, not while it happens to be crossing
      // something. The two are different, and a panel that could not tell them
      // apart hid a bug behind an empty screen once already.
      setRunning(SWEEP_RUNNING.value);

      // Written every frame, deliberately.
      //
      // There was a cache here — remember the last set of ids, skip the write
      // when they match — and it bought nothing while costing a real bug. On
      // the first pass the panel is not mounted, so the guarded write was
      // skipped *while the cache was updated anyway*; from then on the ids
      // always matched and the text was never written at all. The panel
      // appeared and stayed blank.
      //
      // Two `textContent` assignments a frame is not a cost worth a cache.
      if (list.current) {
        const named = organIds
          .map((organId) => {
            const organ = organs[organId];
            return organ ? organLabel(organ) : organId;
          })
          .join(" · ");
        list.current.textContent =
          named ||
          (useScanStore.getState().plane === "front"
            ? "nothing at this depth"
            : "nothing at this height");
      }
      if (level.current) {
        // Written like the names, not through state: it changes as often as
        // they do and for the same reason.
        const at = CURRENT_LEVEL.value;
        level.current.textContent = at ? ` · ${at}` : "";
      }
      if (rest.current) {
        const hidden = Math.max(0, total - organIds.length);
        rest.current.textContent = hidden > 0 ? `and ${hidden} more` : "";
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [organs]);

  if (!running) return null;

  if (!shown) {
    return (
      <button
        type="button"
        onClick={toggleReadout}
        title="Name what the plane is crossing again"
        className={`pointer-events-auto select-none ${OVERLAY_CHIP} ${OVERLAY_CHIP_ACTION}`}
      >
        crossing · show
      </button>
    );
  }

  return (
    /*
     * The panel itself stays transparent to the pointer, and only the header
     * takes clicks. It lies over the model, and a reader aiming at a structure
     * behind it should reach the structure — the one thing this panel must
     * never do is become an obstacle while claiming to be a label.
     */
    <div className="pointer-events-none select-none rounded border border-cyan-800/50 bg-slate-950/80 px-2.5 py-1.5 shadow-lg">
      <button
        type="button"
        onClick={toggleReadout}
        title="Hide this, and look at what the plane has lit"
        className="pointer-events-auto flex w-full items-center justify-between gap-4 text-[9px] uppercase tracking-wider text-cyan-500/70 hover:text-cyan-300"
      >
        <span>
          Crossing now
          <span ref={level} className="text-cyan-300" />
        </span>
        <span className="text-slate-500">hide</span>
      </button>
      <p ref={list} className="max-w-md text-[11px] italic leading-snug text-cyan-100" />
      <p ref={rest} className="text-[9px] text-slate-500" />
    </div>
  );
}
