import { useEffect, useRef, useState } from "react";

import { organLabel, useSceneStore } from "@/stores/sceneStore";
import { useScanStore } from "@/stores/scanStore";

import {
  AXIAL_CANVAS,
  formatDistance,
  measureCm,
  panWindow,
  pointInSection,
  pointOnScreen,
  sectionFileName,
  sectionImage,
  RETAKE_INTERVAL_MS,
  restoreSlice,
  SECTION_VIEW,
  SECTION_WINDOW,
  SLICE_PIXELS,
  TORCH,
  torchDirection,
  wantSection,
  wheelSteps,
  WHEEL_SETTLE_MS,
  zoomWindow,
} from "./axialSlice";
import type { SectionMeasure, SliceWindow } from "./axialSlice";
import { SECTION_STEP_CM, stepFraction } from "./scanBand";
import { AXIAL_PROBE } from "./AxialProbe";
import { saveViewImage } from "@/lib/studyDb";
import { CURRENT_CROSSING } from "./scanCrossing";
import { CURRENT_LEVEL } from "./vertebralLevel";
import { tissueColour } from "./palette";

/**
 * The cross-section, once it has left the GPU.
 *
 * # Why this is a plain canvas and not part of the scene
 *
 * Because a section only has to be right while the plane is still. Rendered
 * into the 3D view it would be redrawn sixty times a second for a picture that
 * changes when the reader lets go of a slider — measured on this atlas, a
 * second pass of the body costs about eight milliseconds even after the slab is
 * culled, which as a per-frame cost would take the viewport from fifty frames
 * to thirty.
 *
 * Read back into an ordinary canvas element it costs that once, and then
 * nothing at all. The render loop does not know this exists.
 *
 * # Why there is one canvas and two sizes
 *
 * The pass is rendered far larger than the panel because its cost is draw
 * calls rather than pixels, so resolution is nearly free on the render side —
 * but a panel that size would cover the body it is a section of. It sits small
 * until somebody asks to see it,
 * and the enlarged view is the *same* canvas element moved, not a copy: two
 * canvases would mean painting twice, and the producer knows about one.
 */
/**
 * What the section contains, as a short table.
 *
 * # Why six and not all of them
 *
 * A slab through the chest holds three hundred and eighty structures, and a
 * list of three hundred and eighty is not a table — it is the same nothing the
 * picture already shows. Six is what a person reads, and the rest are counted,
 * which is the honest half of the sentence.
 *
 * It is deliberately the *same* rule and the same source the crossing panel
 * uses. Two lists of "what is here" that disagreed because they ranked
 * differently would be worse than one list.
 *
 * # Why the colours are the tissue's own
 *
 * They are the colours in the picture beside them. A legend whose swatches did
 * not match the image would be a decoration; matching, it is the only thing
 * turning an outline into a reading.
 */
function SliceTable({ compact }: { compact: boolean }) {
  const organs = useSceneStore((s) => s.organs);
  const { organIds, total } = CURRENT_CROSSING.value;
  if (organIds.length === 0) return null;
  const rest = Math.max(0, total - organIds.length);

  return (
    <ul className={compact ? "mt-1 space-y-0.5" : "space-y-1"}>
      {organIds.map((organId) => {
        const organ = organs[organId];
        return (
          <li key={organId} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-sm"
              style={{
                backgroundColor: organ
                  ? `#${tissueColour(organ).getHexString()}`
                  : "#475569",
              }}
            />
            <span
              className={`truncate italic ${
                compact ? "text-[9px] text-cyan-100/80" : "text-[11px] text-cyan-100"
              }`}
            >
              {organ ? organLabel(organ) : organId}
            </span>
          </li>
        );
      })}
      {rest > 0 && (
        <li className={compact ? "text-[9px] text-slate-500" : "text-[11px] text-slate-500"}>
          and {rest} more
        </li>
      )}
    </ul>
  );
}

export function AxialView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const enabled = useScanStore((s) => s.enabled);
  const axial = useScanStore((s) => s.axial);
  /**
   * Subscribed so a new section brings a fresh table with it.
   *
   * `CURRENT_CROSSING` is a plain object the render loop writes into, and
   * nothing re-renders when it changes — deliberately, because it changes
   * several times a second. This counter changes once per section, after the
   * picture has been painted, which is the one instant where the table and the
   * image are describing the same level.
   *
   * It used to watch the finger instead, which worked only because a section
   * was only ever taken by letting go. The wheel takes one without the finger
   * moving at all.
   */
  const sections = useScanStore((s) => s.sections);
  const held = useScanStore((s) => s.held);
  const cut = useScanStore((s) => s.cut);
  const torch = useScanStore((s) => s.torch);
  // Subscribed only so the panel re-renders when the size changes: the canvas
  // is resized by the painter, but the point past which magnifying invents
  // detail moves the moment the setting does.
  useScanStore((s) => s.detail);
  const [full, setFull] = useState(false);
  /**
   * The square of body the section is framed on, or null for the whole thing.
   *
   * Kept in metres rather than as a magnification, because the plane moves: the
   * automatic frame is 108 cm at the chest and a third of that at the neck, so
   * a window remembered as a fraction of the picture would swing across the
   * body as the reader stepped through it. In metres it stays over the same
   * anatomy, which is the point of being able to step while magnified.
   *
   * Mirrored into React state as well as the module value, because the panel
   * reads it while rendering and the render loop reads it while rendering.
   */
  const [shown, setShown] = useState<SliceWindow | null>(null);
  /** The last pointer position of a drag, so moves are deltas. */
  const dragging = useRef<{ x: number; y: number } | null>(null);
  /**
   * The caliper: whether it is out, and what it is across.
   *
   * A visible control rather than a held modifier. Shift-drag was the obvious
   * shape and it is the wrong one for the same reasons the pin was: it binds a
   * feature to a keyboard layout, it cannot be discovered by looking, and it is
   * unreachable on a machine driven by touch or one hand.
   */
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<SectionMeasure | null>(null);
  /** True while an end is being dragged out, so a click alone leaves nothing. */
  const drawing = useRef(false);
  /** The save, and whatever it had to say afterwards. */
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  /**
   * How wide the enlarged window actually is, in screen pixels.
   *
   * Measured rather than assumed, because it is sized in viewport units: a
   * laptop and this desktop get different numbers, and neither changes in a
   * way React would re-render for. It is what decides whether magnifying has
   * run past the source, and a guess there is exactly the bug being fixed.
   */
  const frame = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  /**
   * How this section was arrived at, which changes what the panel may claim.
   *
   * "Where you let go" is the truth about a section taken by releasing the
   * light and a small lie about one reached with the wheel, and a caption that
   * quietly stops being true is how a reader learns to ignore captions.
   */
  const [stepped, setStepped] = useState(false);
  /** Wheel movement not yet worth a step. See `wheelSteps`. */
  const carried = useRef(0);
  /** The pending retake, cancelled by the next notch. See `WHEEL_SETTLE_MS`. */
  const settle = useRef<number | null>(null);
  /** When a moving gesture last cost a section. See `RETAKE_INTERVAL_MS`. */
  const lastRetake = useRef(0);
  /** The retake owed to a hand that stopped between two intervals. */
  const trailing = useRef<number | null>(null);

  /**
   * Retake, at most so often, and always once at the end.
   *
   * Leading and trailing both matter and for different reasons. Without the
   * leading one the picture lags the hand by an interval and feels detached
   * from it; without the trailing one it keeps whatever the gesture happened to
   * be at when the last interval elapsed, which is not where it was left.
   */
  const retakeSoon = () => {
    const now = performance.now();
    const since = now - lastRetake.current;
    if (trailing.current !== null) window.clearTimeout(trailing.current);
    if (since >= RETAKE_INTERVAL_MS) {
      lastRetake.current = now;
      wantSection();
      return;
    }
    trailing.current = window.setTimeout(() => {
      trailing.current = null;
      lastRetake.current = performance.now();
      wantSection();
    }, RETAKE_INTERVAL_MS - since);
  };

  /** Where the pointer is over the picture becomes where the light stands. */
  const aimTorch = (box: DOMRect, x: number, y: number) => {
    if (!torch || box.width <= 0 || box.height <= 0) return;
    const u = (x - box.left - box.width / 2) / (box.width / 2);
    const v = (y - box.top - box.height / 2) / (box.height / 2);
    TORCH.value = torchDirection(u, v);
    retakeSoon();
  };

  /**
   * Move the window, and let the picture follow.
   *
   * The window is the only state there is. There was a CSS transform on top of
   * it once, as a preview, and taking the preview back out when the render
   * landed is what produced the jumps: **a section arriving is not the section
   * you asked for**, because the counter goes up for every pass — a torch
   * retake, a step of the plane, letting the light go. Two truths correlated by
   * hope. One truth cannot disagree with itself.
   */
  const showWindow = (next: SliceWindow | null, now = false) => {
    SECTION_VIEW.value = next;
    setShown(next);
    if (now) {
      if (trailing.current !== null) window.clearTimeout(trailing.current);
      trailing.current = null;
      lastRetake.current = performance.now();
      wantSection();
      return;
    }
    retakeSoon();
  };

  /** What is on screen: the reader's window, or the whole section. */
  const looking = (): SliceWindow => shown ?? AXIAL_PROBE.base;

  const magnify = (by: number, u = 0, v = 0) => {
    if (AXIAL_PROBE.base.half <= 0) return;
    showWindow(zoomWindow(looking(), AXIAL_PROBE.base, by, u, v));
  };

  /**
   * Switched off, the light goes back to the one the mode chooses for itself.
   *
   * And the section is retaken once, because a switch that changes nothing
   * until the reader does something else is a switch they conclude is broken.
   */
  useEffect(() => {
    if (torch || TORCH.value === null) return;
    TORCH.value = null;
    wantSection();
  }, [torch]);

  /**
   * Turn a wheel gesture into whole centimetres of travel.
   *
   * The plane moves now and the picture follows when the hand stops: moving
   * the plane is a uniform write, and the section is fifteen milliseconds.
   */
  const wheelToSteps = (deltaY: number) => {
    const per = stepFraction();
    // Before the body has been measured there is no such thing as a
    // centimetre, and stepping by nothing is better than stepping by NaN.
    if (per === 0) return;
    const { steps, carry } = wheelSteps(carried.current, deltaY);
    carried.current = carry;
    if (steps === 0) return;
    // Down the page is down the body: the slider has the head at the top, and
    // a wheel that disagreed with the control beside it would be a puzzle.
    useScanStore.getState().step(-steps * per);
    setStepped(true);
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      settle.current = null;
      wantSection();
    }, WHEEL_SETTLE_MS);
  };

  useEffect(
    () => () => {
      if (settle.current !== null) window.clearTimeout(settle.current);
      if (trailing.current !== null) window.clearTimeout(trailing.current);
    },
    [],
  );

  // Taking hold of the light again is the other way of choosing a level, and
  // the panel goes back to describing that one.
  useEffect(() => {
    if (held) setStepped(false);
  }, [held]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setFrameWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [full]);

  useEffect(() => {
    // Published while mounted, and taken back on the way out: the producer runs
    // inside the WebGL canvas and would otherwise paint into an element React
    // has already removed.
    AXIAL_CANVAS.value = canvas.current;
    // Whatever was last drawn, straight away. Enlarging mounts a fresh canvas,
    // and a section that blanked at the moment somebody asked to see it
    // properly would answer the wrong question.
    if (canvas.current) restoreSlice(canvas.current);
    return () => {
      AXIAL_CANVAS.value = null;
    };
  }, [enabled, axial, full, sections]);

  useEffect(() => {
    if (!full) return;
    // Escape closes it, because a thing that covers the viewport has to have an
    // exit that does not require finding it first.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The line first, then the panel: Escape should undo the smaller thing
      // the reader is holding before it throws away the bigger one.
      if (measure) {
        setMeasure(null);
        return;
      }
      setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, measure]);

  useEffect(() => {
    // A section nobody can see should not be left open across a switch-off.
    if (!enabled || !axial) setFull(false);
  }, [enabled, axial]);

  useEffect(() => {
    // Opening always starts from the whole picture, and closing puts it back:
    // a thumbnail showing a nine-centimetre crop of somebody's last look is
    // not a thumbnail of the section, and a view that reopened at the
    // magnification left an hour ago is a view that looks broken.
    setMeasure(null);
    if (SECTION_VIEW.value === null) return;
    SECTION_VIEW.value = null;
    setShown(null);
    wantSection();
  }, [full]);

  if (!enabled || !axial) return null;

  /**
   * How wide the picture is, in centimetres of body.
   *
   * Taken from what the pass was framed on and then divided by whatever CSS is
   * doing on top, so it is right during a gesture as well as after it. It
   * replaces the magnification factor on the button: "9 cm" is a measurement a
   * reader can use, and "5.4x" is a number about the software.
   */
  const across = AXIAL_PROBE.frameCm;
  /**
   * The level, when the plane is at one.
   *
   * Read here rather than passed in, on the render that follows a section
   * being taken — the same moment the table is refreshed, for the same reason.
   */
  const level = CURRENT_LEVEL.value;
  /**
   * The caption describes what is actually on screen, which means it changes.
   *
   * It said the cut surfaces were open in both modes — true of the slab, and
   * plainly false of the cut, where the surfaces below the plane read as
   * solid. A caption that keeps insisting on something the picture contradicts
   * teaches the reader to stop reading captions.
   */
  const caption =
    `Anterior at the top${across > 0 ? ` · ${across.toFixed(0)} cm across` : ""}. ` +
    (cut
      ? "The body opened at this plane: you are seeing the surfaces below the " +
        "cut, so there is depth behind what is at this level."
      : "Only what lies at this level, and the cut surfaces are open — an " +
        "outline rather than a filled section.") +
    " Drawn solid whatever the viewport shows. Not a radiograph.";

  if (full) {
    return (
      <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center gap-6 bg-slate-950/95 p-4">
        {/*
          The picture takes the height and the reading material stands beside
          it. Stacked, the caption and the table were spending most of a laptop
          on four lines of prose and leaving the section — the only thing on
          screen that cannot be read at half size — squeezed into what was
          left. Beside it, the same words cost nothing the picture wanted.

          Sized against both edges rather than the height alone: the column
          next to it is a fixed width, so what the picture can have is the
          window minus that, and a square that only watched `vh` would run off
          a wide-and-short window.

          It stays a fixed square with the picture moving inside it. Growing
          the picture instead would push the table off the screen, and panning
          is only offered once there is something outside the square to pan to.
        */}
        <div
          ref={frame}
          className="relative shrink-0 overflow-hidden rounded bg-black"
          /*
            The wheel reads the body, and that is not a preference — it is the
            gesture every reader of a cross-section already has. Magnifying
            moves to the modifier and to the two buttons beside the picture,
            which is where a viewer that reads sections keeps it.
          */
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) {
              // About the pointer, so the thing being looked at stays under it
              // instead of sliding off the edge with every notch.
              const box = event.currentTarget.getBoundingClientRect();
              magnify(
                event.deltaY < 0 ? 1.15 : 1 / 1.15,
                (event.clientX - box.left - box.width / 2) / (box.width / 2),
                (event.clientY - box.top - box.height / 2) / (box.height / 2),
              );
              return;
            }
            wheelToSteps(event.deltaY);
          }}
          onPointerDown={(event) => {
            if (measuring) {
              const box = event.currentTarget.getBoundingClientRect();
              const at = pointInSection(
                looking(),
                event.clientX - box.left,
                event.clientY - box.top,
                box.width,
              );
              drawing.current = true;
              setMeasure({ ax: at.x, az: at.z, bx: at.x, bz: at.z });
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            if (!shown) return;
            dragging.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drawing.current) {
              const box = event.currentTarget.getBoundingClientRect();
              const at = pointInSection(
                looking(),
                event.clientX - box.left,
                event.clientY - box.top,
                box.width,
              );
              // Only the far end moves. The near one was placed where the
              // reader put it and must not drift under them.
              setMeasure((line) => (line ? { ...line, bx: at.x, bz: at.z } : line));
              return;
            }
            const from = dragging.current;
            if (from) {
              // Deltas, not an offset from where the drag began: the window is
              // the state and it has already absorbed everything so far.
              dragging.current = { x: event.clientX, y: event.clientY };
              if (frameWidth > 0) {
                showWindow(
                  panWindow(
                    looking(),
                    AXIAL_PROBE.base,
                    event.clientX - from.x,
                    event.clientY - from.y,
                    frameWidth,
                  ),
                );
              }
              return;
            }
            // Hover aims, a held button pans. They are different gestures, so
            // neither has to be given up for the other.
            aimTorch(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
          }}
          onPointerUp={() => {
            dragging.current = null;
            if (!drawing.current) return;
            drawing.current = false;
            // A click that never moved is not a measurement; it is somebody
            // finding out what the button does.
            setMeasure((line) => (line && measureCm(line) > 0 ? line : null));
          }}
          onPointerCancel={() => {
            dragging.current = null;
            drawing.current = false;
          }}
          style={{
            width: SECTION_WINDOW,
            height: SECTION_WINDOW,
            cursor: measuring
              ? "crosshair"
              : dragging.current
                ? "grabbing"
                : torch
                  ? "crosshair"
                  : shown
                    ? "grab"
                    : "default",
          }}
        >
          <canvas
            ref={canvas}
            width={SLICE_PIXELS.value}
            height={SLICE_PIXELS.value}
            className="absolute inset-0 h-full w-full"
            aria-label="Cross-section at the height of the scanner"
          />
          {/*
            Drawn over the picture rather than into it. A caliper baked into the
            canvas would be in every copy of the section from then on, including
            the one somebody photographs, and it would have to be repainted by
            the render loop every time the plane moved.
          */}
          {measure && frameWidth > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${frameWidth} ${frameWidth}`}
              aria-hidden
            >
              {(() => {
                const a = pointOnScreen(looking(), measure.ax, measure.az, frameWidth);
                const b = pointOnScreen(looking(), measure.bx, measure.bz, frameWidth);
                const cm = measureCm(measure);
                return (
                  <>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#22d3ee"
                      strokeWidth={1.5}
                    />
                    <circle cx={a.x} cy={a.y} r={3} fill="#22d3ee" />
                    <circle cx={b.x} cy={b.y} r={3} fill="#22d3ee" />
                    {cm > 0 && (
                      <text
                        x={(a.x + b.x) / 2 + 8}
                        y={(a.y + b.y) / 2 - 8}
                        fill="#a5f3fc"
                        fontSize={13}
                        stroke="#020617"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {formatDistance(cm)}
                      </text>
                    )}
                  </>
                );
              })()}
            </svg>
          )}
        </div>

        <div className="flex w-72 flex-col gap-3 self-center">
          <p className="text-[10px] uppercase tracking-wider text-cyan-500/70">
            Axial{level ? ` · ${level}` : ""} ·{" "}
            {stepped ? `${SECTION_STEP_CM} cm steps` : "where you let go"}
          </p>

          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => magnify(1 / 1.4)}
              className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              −
            </button>
            <button
              type="button"
              title="Back to the whole section"
              onClick={() => {
                if (SECTION_VIEW.value === null) return;
                showWindow(null, true);
              }}
              className="w-20 rounded border border-slate-700 px-2 py-0.5 tabular-nums text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              {across > 0 ? `${across.toFixed(across < 10 ? 1 : 0)} cm` : "—"}
            </button>
            <button
              type="button"
              onClick={() => magnify(1.4)}
              className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setFull(false)}
              className="ml-auto rounded border border-slate-700 px-3 py-0.5 text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              Close · Esc
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                const next = !measuring;
                setMeasuring(next);
                if (!next) setMeasure(null);
              }}
              aria-pressed={measuring}
              title="Drag across the section to measure it"
              className={`rounded border px-2 py-0.5 ${
                measuring
                  ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-700 text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
              }`}
            >
              Measure
            </button>
            {measuring && (
              <span className="tabular-nums text-cyan-200">
                {measure ? formatDistance(measureCm(measure)) : "drag across it"}
              </span>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setSaved(null);
                // The window as it is right now, so a magnified section saves
                // what is on screen rather than what it started as.
                sectionImage(looking(), measure)
                  .then((png) =>
                    png
                      ? saveViewImage(png, sectionFileName(level, across, cut))
                      : Promise.reject(new Error("There is no section to save yet.")),
                  )
                  .then((path) => setSaved(path ? `Saved to ${path}` : null))
                  .catch((error: unknown) =>
                    setSaved(error instanceof Error ? error.message : String(error)),
                  )
                  .finally(() => setSaving(false));
              }}
              title="Save this section as a PNG, with its measurement"
              className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-cyan-700 hover:text-cyan-300 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {saved && (
            <button
              type="button"
              onClick={() => setSaved(null)}
              title={saved}
              className="truncate text-left text-[10px] text-slate-500 hover:text-slate-300"
            >
              {saved}
            </button>
          )}

          {measuring && (
            <p className="text-[11px] leading-snug text-slate-500">
              Both ends lie in the plane, so this is the true distance between
              those two points —{" "}
              {cut
                ? "but in Cut you are seeing surfaces below the plane, so the structures under the ends may not be at this level. Slab is the mode to measure a level in."
                : "and in Slab everything shown is within four millimetres of it."}
            </p>
          )}

          <SliceTable compact={false} />

          <p className="text-[11px] leading-snug text-slate-500">
            {caption} The wheel steps {SECTION_STEP_CM} cm through the body;
            Ctrl and the wheel, or −/+, magnify. Magnifying re-renders the
            section at the narrower width rather than enlarging what is there,
            so it adds detail instead of pixels. Drag to move; the button gives
            the whole section back.
            {torch
              ? " The pointer is the light: the middle is overhead, and the" +
                " edges rake it flat across the section."
              : ""}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none select-none rounded border border-cyan-900/60 bg-slate-950/85 p-1.5 shadow-lg">
      <p className="mb-1 text-[9px] uppercase tracking-wider text-cyan-500/70">
        Axial{level ? ` · ${level}` : ""} ·{" "}
        {stepped ? `${SECTION_STEP_CM} cm steps` : "where you let go"}
      </p>
      <button
        type="button"
        onClick={() => setFull(true)}
        onWheel={(event) => wheelToSteps(event.deltaY)}
        title={`See it full size. The wheel steps ${SECTION_STEP_CM} cm through the body.`}
        className="pointer-events-auto block cursor-zoom-in rounded-sm"
      >
        <canvas
          ref={canvas}
          width={SLICE_PIXELS.value}
          height={SLICE_PIXELS.value}
          className="block h-36 w-36 rounded-sm bg-black"
          aria-label="Cross-section at the height of the scanner. Click to enlarge."
        />
      </button>
      {/*
        A thumbnail says there is a section and invites a look at it. The table
        and the explanation are reading material, and reading material belongs
        where there is room to read — five lines of caption under a 144-pixel
        picture is most of a laptop's spare column spent on a sentence somebody
        needs once.
      */}
      <p className="mt-1 max-w-36 text-[9px] leading-snug text-slate-500">
        {across > 0 ? `${across.toFixed(0)} cm · ` : ""}
        {cut ? "cut" : "slab"} · {CURRENT_CROSSING.value.total} structures
        <span className="block text-cyan-500/70">
          wheel to step · click to enlarge
        </span>
      </p>
    </div>
  );
}
