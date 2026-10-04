import { useEffect, useState } from "react";

import { useBreathStore } from "@/stores/breathStore";
import { useSceneStore } from "@/stores/sceneStore";

import { BREATH_NOW } from "./BreathDriver";
import { BREATH_PATTERNS, type BreathPatternId } from "./breathing";
import { OVERLAY_SWITCH_OFF, OVERLAY_SWITCH_ON } from "./overlayChrome";

/**
 * The breathing's switch, and what it needs to say. See `breathing.ts`.
 *
 * *Illustrative* on its face, as the heartbeat says it: the right parts move
 * the right way and by about the right amount, and that is all that is
 * claimed. And the panel says what is happening *now* — breathing in, the
 * diaphragm descending; breathing out, the lungs recoiling — because the
 * motion is the half of it a student sees and the cause is the half they need.
 */

const PHASE = {
  in: "Breathing in — the diaphragm contracts and descends; the ribs swing up and out.",
  out: "Breathing out — at rest no muscle works: the lungs and the chest wall recoil.",
};

const ORDER: BreathPatternId[] = ["quiet", "deep"];

/**
 * Which half of the breath it is, re-rendering only when that changes — twice
 * a breath, not sixty times a second.
 */
function useBreathPhase(active: boolean): "in" | "out" {
  const [phase, setPhase] = useState<"in" | "out">("in");
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const read = () => {
      const now = BREATH_NOW.inhaling ? "in" : "out";
      setPhase((before) => (before === now ? before : now));
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return phase;
}

export function BreathControls() {
  const enabled = useBreathStore((s) => s.enabled);
  const patternId = useBreathStore((s) => s.pattern);
  const toggle = useBreathStore((s) => s.toggle);
  const setPattern = useBreathStore((s) => s.setPattern);
  const lungsHidden = useSceneStore((s) => s.hiddenSystems.includes("respiratory"));
  const phase = useBreathPhase(enabled);
  const pattern = BREATH_PATTERNS[patternId];

  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        title={
          enabled
            ? "Stop the breathing"
            : "Breathe: the diaphragm descends, the lungs fill, the ribs lift"
        }
        className={`rounded border px-2 py-1 text-xs ${enabled ? OVERLAY_SWITCH_ON.sky : OVERLAY_SWITCH_OFF}`}
      >
        Breathing
      </button>

      {enabled && (
        <div className="max-w-52 rounded border border-sky-900/60 bg-slate-950/80 px-2 py-1.5 text-[9px] leading-snug text-slate-400">
          <p className="uppercase tracking-wider text-sky-300/80">{pattern.rate} · illustrative</p>
          <p className="mt-0.5 font-medium text-slate-200">{pattern.label}</p>
          <p className="mt-0.5" aria-live="off">{PHASE[phase]}</p>
          <p className="mt-0.5 text-slate-500">{pattern.what}</p>
          {lungsHidden && (
            <p className="mt-0.5 text-amber-300/80">
              Switch the respiratory system on to see the lungs fill.
            </p>
          )}
          <div role="radiogroup" aria-label="Breathing pattern" className="mt-1.5 flex gap-1">
            {ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === patternId}
                onClick={() => setPattern(id)}
                className={`rounded border px-1.5 py-0.5 text-[9px] ${
                  id === patternId
                    ? "border-sky-500 text-sky-200"
                    : "border-slate-700 text-slate-400 hover:border-sky-700 hover:text-sky-200"
                }`}
              >
                {id === "quiet" ? "At rest" : "Deep"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
