import { useEffect, useRef } from "react";

import { useScanStore } from "@/stores/scanStore";

import { SWEEP_PROGRESS } from "./scanBand";
import { SCAN_TINTS } from "./scanTints";

/**
 * The scanner's switch, and the handle that puts its light where you want it.
 *
 * # Why the slider is uncontrolled
 *
 * It has to follow a sweep that moves sixty times a second, and it has to be
 * draggable. A controlled input would mean the sweep's position living in React
 * state, which re-renders a tree with 3,478 meshes in it to move a thumb a
 * pixel. So the loop below writes `value` straight onto the element — the same
 * technique the crossing readout uses — and stops writing while the reader has
 * hold of it, because an input being dragged must not be argued with.
 *
 * # Why holding is a state and not a mode
 *
 * Letting go resumes the travel from the height it was left at rather than from
 * wherever the clock had got to. That is the difference between a control and
 * an interruption: the reader moves the light to the diaphragm, looks, lets go,
 * and the sweep carries on downward from the diaphragm.
 */
export function ScanControls() {
  const enabled = useScanStore((s) => s.enabled);
  const held = useScanStore((s) => s.held);
  const pinned = useScanStore((s) => s.pinned);
  const sweepOnAnswer = useScanStore((s) => s.sweepOnAnswer);
  const toggle = useScanStore((s) => s.toggle);
  const hold = useScanStore((s) => s.hold);
  const release = useScanStore((s) => s.release);
  const togglePin = useScanStore((s) => s.togglePin);
  const setSweepOnAnswer = useScanStore((s) => s.setSweepOnAnswer);
  const tint = useScanStore((s) => s.tint);
  const setTint = useScanStore((s) => s.setTint);
  const slider = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Nothing to follow while the reader has it, and nothing to follow while it
    // is pinned either — the sweep is not moving, and writing the same value
    // sixty times a second would fight a thumb somebody is about to drag.
    if (!enabled || held || pinned) return;
    let frame = 0;
    const tick = () => {
      if (slider.current) slider.current.value = String(SWEEP_PROGRESS.value);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, held, pinned]);

  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        title={
          enabled
            ? "Stop the scanner"
            : "Sweep a plane of light through the body, lighting each structure it reaches"
        }
        className={`rounded border px-2 py-1 text-xs ${
          enabled
            ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
            : "border-slate-700 bg-slate-950/70 text-slate-400"
        }`}
      >
        Scanner
      </button>

      {enabled && (
        <div className="rounded border border-cyan-900/60 bg-slate-950/80 px-2 py-1.5">
          <label
            htmlFor="scan-position"
            className="mb-1 block text-[9px] uppercase tracking-wider text-cyan-500/70"
          >
            Drag to hold the light
          </label>
          <input
            ref={slider}
            id="scan-position"
            type="range"
            min={0}
            max={1}
            step={0.001}
            defaultValue={SWEEP_PROGRESS.value}
            // Vertical, because the thing it moves is: a horizontal handle for
            // a light that travels head to feet reads backwards in the hand.
            className="h-28 w-4 cursor-ns-resize accent-cyan-400"
            style={{ writingMode: "vertical-lr", direction: "rtl" }}
            onPointerDown={(event) => {
              hold(Number(event.currentTarget.value));
              // Keep receiving the drag even when the pointer leaves the
              // handle, which on a 4px-wide control is most of the time.
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onChange={(event) => hold(Number(event.target.value))}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(event) => {
              // Arrow keys move a range input, and a reader who nudges it and
              // then watches it snap back has been told the control is broken.
              if (event.key.startsWith("Arrow")) hold(Number(event.currentTarget.value));
            }}
            onBlur={release}
          />

          {/*
            A control rather than a held modifier.

            Ctrl-drag was the obvious shape for this and it is the wrong one: it
            binds a feature to a keyboard layout, it cannot be found by looking
            at the screen, and it is out of reach on a machine driven by touch
            or by one hand. A button that says what it does works everywhere.
          */}
          {/*
            The colour of the light.

            Swatches rather than names, and no picker. The light is added to the
            tissue's own colour, so the hue is what decides which structures
            separate and which sink into their neighbours — which makes this a
            reading control, not a theme. Four that are known to separate from
            something beat several hundred thousand that mostly do not.
          */}
          <div className="mt-1.5 flex gap-1" role="group" aria-label="Light colour">
            {SCAN_TINTS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                onClick={() => setTint(swatch.id)}
                aria-pressed={tint === swatch.id}
                title={`${swatch.label} light`}
                className={`h-4 flex-1 rounded-sm border transition-colors ${
                  tint === swatch.id
                    ? "border-slate-200"
                    : "border-slate-700 hover:border-slate-500"
                }`}
                style={{ backgroundColor: swatch.hex }}
              >
                <span className="sr-only">{swatch.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={togglePin}
            aria-pressed={pinned}
            title={
              pinned
                ? "Let the light travel again"
                : "Keep the light where it is, so you can look without holding it"
            }
            className={`mt-1.5 w-full rounded border px-1 py-0.5 text-[9px] ${
              pinned
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                : "border-slate-700 text-slate-400 hover:border-slate-600"
            }`}
          >
            {pinned ? "Held" : "Hold"}
          </button>
        </div>
      )}

      {/*
        The one setting, and it is here rather than buried in a drawer because
        this is where somebody is when they decide their machine cannot take it.
        Remembered across launches: being asked to turn it off every morning is
        the application forgetting the only thing it was told.
      */}
      <label className="flex max-w-[9.5rem] cursor-pointer items-start gap-1.5 rounded border border-slate-800/70 bg-slate-950/70 px-1.5 py-1 text-[9px] leading-snug text-slate-400">
        <input
          type="checkbox"
          checked={sweepOnAnswer}
          onChange={(event) => setSweepOnAnswer(event.target.checked)}
          className="mt-[1px] accent-cyan-500"
        />
        Sweep while the assistant answers
      </label>
    </div>
  );
}
