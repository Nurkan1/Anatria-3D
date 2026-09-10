import { useEffect, useLayoutEffect, useRef } from "react";

import { useSceneStore } from "@/stores/sceneStore";
import { useScanStore } from "@/stores/scanStore";

import { SWEEP_PROGRESS } from "./scanBand";
import { SCAN_TINTS, scanTint } from "./scanTints";

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
/**
 * Put the handle at `progress`, and paint the track under it.
 *
 * The fill is a CSS variable rather than `accent-color` because the track is
 * ours: see the note in `index.css` about the two engines this ships on. Both
 * writes belong together — a thumb that moved while the coloured part stayed
 * put would look like a rendering bug on one platform and be one on both.
 */
function show(input: HTMLInputElement, progress: number): void {
  input.value = String(progress);
  input.style.setProperty("--scan-fill", `${Math.max(0, Math.min(1, progress)) * 100}%`);
}

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
  const reveal = useScanStore((s) => s.reveal);
  const setReveal = useScanStore((s) => s.setReveal);
  const panel = useScanStore((s) => s.panel);
  const togglePanel = useScanStore((s) => s.togglePanel);
  // There is nothing to reveal on a body that already has its colour: the
  // control says so rather than sitting there apparently broken.
  const drained = useSceneStore((s) => s.bodyTone) !== "solid";
  const slider = useRef<HTMLInputElement>(null);

  /**
   * Paint it once on mount, before the loop below has run a frame.
   *
   * The loop does not run while the light is held or pinned, so a scanner
   * opened in that state would otherwise show a thumb at the sweep's position
   * and a coloured track at the stylesheet's fallback — the one mismatch this
   * whole change exists to prevent.
   */
  useLayoutEffect(() => {
    if (slider.current) show(slider.current, SWEEP_PROGRESS.value);
  }, [enabled, panel]);

  useEffect(() => {
    // Nothing to follow while the reader has it, and nothing to follow while it
    // is pinned either — the sweep is not moving, and writing the same value
    // sixty times a second would fight a thumb somebody is about to drag.
    if (!enabled || !panel || held || pinned) return;
    let frame = 0;
    const tick = () => {
      if (slider.current) show(slider.current, SWEEP_PROGRESS.value);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, panel, held, pinned]);

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

      {/*
        Folded away, the controls leave the one thing worth keeping on screen:
        which colour the light is. A pill rather than nothing, for the same
        reason the crossing panel leaves one — a control that can only be
        recovered from memory is a control somebody loses.

        And folding is not switching off. Clearing the view of the palette used
        to mean stopping the instrument, which is the opposite of what somebody
        wants when they are finally looking at something.
      */}
      {enabled && !panel && (
        <button
          type="button"
          onClick={togglePanel}
          title="Show the scanner's controls again"
          className="pointer-events-auto flex items-center gap-1.5 rounded border border-slate-800/60 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 hover:border-cyan-800/60 hover:text-cyan-500/80"
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: scanTint(tint).hex }}
          />
          light · show
        </button>
      )}

      {enabled && panel && (
        <div className="rounded border border-cyan-900/60 bg-slate-950/80 px-2 py-1.5">
          <button
            type="button"
            onClick={togglePanel}
            title="Fold these away without stopping the scanner"
            className="mb-1 flex w-full items-center justify-between gap-3 text-[9px] uppercase tracking-wider text-cyan-500/70 hover:text-cyan-300"
          >
            <span>Drag to hold the light</span>
            <span className="text-slate-500 normal-case">hide</span>
          </button>
          {/*
            Vertical, because the thing it moves is: a horizontal handle for a
            light that travels head to feet reads backwards in the hand.

            The wrapper is the vertical box; the input inside it is an ordinary
            horizontal range turned a quarter turn, which is the one way of
            doing this that every engine has understood for fifteen years. It
            replaced `writing-mode: vertical-lr`, which WebView2 draws and the
            WebKitGTK on a Debian desktop did not — there the control stayed
            horizontal in a 16px box, with no visible track and sixteen pixels
            of travel.
          */}
          <div className="relative h-28 w-4">
          <input
            ref={slider}
            id="scan-position"
            aria-label="Drag to hold the light"
            type="range"
            min={0}
            max={1}
            step={0.001}
            defaultValue={SWEEP_PROGRESS.value}
            className="scan-slider absolute top-1/2 left-1/2 h-4 w-28 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-ns-resize"
            onPointerDown={(event) => {
              hold(Number(event.currentTarget.value));
              // Keep receiving the drag even when the pointer leaves the
              // handle, which on a 4px-wide control is most of the time.
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onChange={(event) => {
              show(event.currentTarget, Number(event.currentTarget.value));
              hold(Number(event.currentTarget.value));
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(event) => {
              // Arrow keys move a range input, and a reader who nudges it and
              // then watches it snap back has been told the control is broken.
              if (!event.key.startsWith("Arrow")) return;
              show(event.currentTarget, Number(event.currentTarget.value));
              hold(Number(event.currentTarget.value));
            }}
            onBlur={release}
          />
          </div>

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

          {/*
            Colour instead of light.

            The glow says where the plane is; this says what it reached, and on
            a drained body colour carries that better than brightness can — a
            lit grey liver is a lit grey shape. They are alternatives rather
            than layers, because an additive wash over a hue returns a paler
            version of the hue.
          */}
          <label
            className={`mt-1.5 flex cursor-pointer items-start gap-1.5 text-[9px] leading-snug ${
              drained ? "text-slate-400" : "cursor-not-allowed text-slate-600"
            }`}
            title={
              drained
                ? "Give each structure its own colour back as the plane reaches it, instead of lighting it"
                : "Switch the body to Scan or Carbon first — at full colour there is nothing to reveal"
            }
          >
            <input
              type="checkbox"
              checked={reveal}
              disabled={!drained}
              onChange={(event) => setReveal(event.target.checked)}
              className="mt-[1px] accent-cyan-500"
            />
            Reveal colour, not light
          </label>

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
