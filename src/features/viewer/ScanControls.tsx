import { useEffect, useRef } from "react";

import { useScanStore } from "@/stores/scanStore";

import { SWEEP_PROGRESS } from "./scanBand";

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
  const toggle = useScanStore((s) => s.toggle);
  const hold = useScanStore((s) => s.hold);
  const release = useScanStore((s) => s.release);
  const slider = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enabled || held) return;
    let frame = 0;
    const tick = () => {
      if (slider.current) slider.current.value = String(SWEEP_PROGRESS.value);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, held]);

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
        </div>
      )}
    </div>
  );
}
