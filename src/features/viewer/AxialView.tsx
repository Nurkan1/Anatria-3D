import { useEffect, useRef, useState } from "react";

import { organLabel, useSceneStore } from "@/stores/sceneStore";
import { useScanStore } from "@/stores/scanStore";

import {
  AXIAL_CANVAS,
  MIN_SECTION_HALF_M,
  pastNativeSize,
  residualTransform,
  restoreSlice,
  SECTION_VIEW,
  SECTION_WINDOW,
  SLICE_PIXELS,
  TORCH,
  torchDirection,
  TORCH_INTERVAL_MS,
  wantSection,
  wheelSteps,
  WHEEL_SETTLE_MS,
  windowFromTransform,
} from "./axialSlice";
import { SECTION_STEP_CM, stepFraction } from "./scanBand";
import { AXIAL_PROBE } from "./AxialProbe";
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
   * How much of the picture to fill the screen with, and where.
   *
   * Reported from a laptop: at the abdomen the slab reaches the arms, so the
   * frame is well over a metre wide and the trunk inside it is a third of the
   * picture. Framing on the contents did not help, because the contents *are*
   * spread across the whole span — a wider frame is the honest answer to what
   * the plane actually cut, and the reader wanting a closer look is a separate
   * need with a separate control.
   */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
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
  /**
   * The magnification already rendered into the picture, and the one that is
   * not yet.
   *
   * `zoom` and `pan` are a CSS transform, which is what makes a gesture feel
   * immediate — nothing waits on a render. But CSS cannot add detail, so once
   * the hand stops the same window is rendered *as a camera*, at the full
   * resolution, and the transform is taken back out. This holds the gesture
   * that was sent to be rendered until the picture that answers it arrives.
   */
  const takenBy = useRef<{ zoom: number; panX: number; panY: number } | null>(null);
  /** The pending commit of a magnification. See `WHEEL_SETTLE_MS`. */
  const settleView = useRef<number | null>(null);
  /** When the torch last cost a section. See `TORCH_INTERVAL_MS`. */
  const lastTorch = useRef(0);
  /** The retake owed to a pointer that stopped between two intervals. */
  const torchTrail = useRef<number | null>(null);

  /**
   * Retake for the torch, at most so often, and always once at the end.
   *
   * Leading and trailing both matter and for different reasons. Without the
   * leading one the light lags the hand by an interval and feels detached from
   * it; without the trailing one the picture keeps whichever position the
   * pointer happened to be in when the last interval elapsed, which is not
   * where the reader left it.
   */
  const retakeForTorch = () => {
    const now = performance.now();
    const since = now - lastTorch.current;
    if (since >= TORCH_INTERVAL_MS) {
      lastTorch.current = now;
      wantSection();
      return;
    }
    if (torchTrail.current !== null) window.clearTimeout(torchTrail.current);
    torchTrail.current = window.setTimeout(() => {
      torchTrail.current = null;
      lastTorch.current = performance.now();
      wantSection();
    }, TORCH_INTERVAL_MS - since);
  };

  /** Where the pointer is over the picture becomes where the light stands. */
  const aimTorch = (box: DOMRect, x: number, y: number) => {
    if (!torch || box.width <= 0 || box.height <= 0) return;
    const u = (x - box.left - box.width / 2) / (box.width / 2);
    const v = (y - box.top - box.height / 2) / (box.height / 2);
    TORCH.value = torchDirection(u, v);
    retakeForTorch();
  };

  /**
   * Send the window the reader is looking at to be rendered properly.
   *
   * Nothing is asked for when the gesture came to rest where it started, which
   * is most pointer-ups: a section costs fifteen milliseconds and re-taking an
   * identical one is fifteen milliseconds of nothing.
   */
  const commitMagnification = () => {
    if (frameWidth <= 0 || AXIAL_PROBE.base.half <= 0) return;
    const settled = pan.x === 0 && pan.y === 0 && zoom === 1;
    if (settled) return;
    const next = windowFromTransform(
      AXIAL_PROBE.shown,
      AXIAL_PROBE.base,
      zoom,
      pan.x,
      pan.y,
      frameWidth,
    );
    takenBy.current = { zoom, panX: pan.x, panY: pan.y };
    SECTION_VIEW.value = next;
    wantSection();
  };

  const commitWhenStill = () => {
    if (settleView.current !== null) window.clearTimeout(settleView.current);
    settleView.current = window.setTimeout(() => {
      settleView.current = null;
      commitMagnification();
    }, WHEEL_SETTLE_MS);
  };

  /**
   * The rendered picture has caught up with the gesture; take the CSS back out.
   *
   * Whatever the hand did while the section was being made stays applied, so
   * the swap is invisible: the picture on screen is the same picture, made of
   * pixels that were measured rather than stretched.
   */
  useEffect(() => {
    const taken = takenBy.current;
    if (!taken) return;
    takenBy.current = null;
    const left = residualTransform(taken, { zoom, panX: pan.x, panY: pan.y });
    setZoom(left.zoom);
    setPan({ x: left.panX, y: left.panY });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

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
      if (settleView.current !== null) window.clearTimeout(settleView.current);
      if (torchTrail.current !== null) window.clearTimeout(torchTrail.current);
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
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  useEffect(() => {
    // A section nobody can see should not be left open across a switch-off.
    if (!enabled || !axial) setFull(false);
  }, [enabled, axial]);

  useEffect(() => {
    // Opening always starts from the whole picture, and closing puts it back:
    // a thumbnail showing a nine-centimetre crop of somebody's last look is
    // not a thumbnail of the section, and a view that reopened at the
    // magnification left an hour ago is a view that looks broken.
    setZoom(1);
    setPan({ x: 0, y: 0 });
    takenBy.current = null;
    if (SECTION_VIEW.value !== null) {
      SECTION_VIEW.value = null;
      wantSection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const across = AXIAL_PROBE.frameCm / zoom;
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
    /**
     * Magnify, as far as there is anything left to magnify.
     *
     * The limit is a width of body rather than a factor: past six centimetres
     * across a reader is magnifying the atlas's own triangles, and the ceiling
     * has to hold whatever the frame at this level happens to be. Zooming out
     * stops at the whole section, which `windowFromTransform` reads as a
     * return to automatic framing.
     */
    const magnify = (by: number) =>
      setZoom((z) => {
        const wanted = z * by;
        const half = AXIAL_PROBE.shown.half / wanted;
        if (half < MIN_SECTION_HALF_M) return AXIAL_PROBE.shown.half / MIN_SECTION_HALF_M;
        const widest = AXIAL_PROBE.base.half;
        if (widest > 0 && half > widest) return AXIAL_PROBE.shown.half / widest;
        return wanted;
      });
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
              magnify(event.deltaY < 0 ? 1.15 : 1 / 1.15);
              // Rendered properly once the hand stops, not once per notch.
              commitWhenStill();
              return;
            }
            wheelToSteps(event.deltaY);
          }}
          onPointerDown={(event) => {
            if (zoom === 1) return;
            dragging.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const from = dragging.current;
            if (from) {
              setPan({ x: event.clientX - from.x, y: event.clientY - from.y });
              return;
            }
            // Hover aims, a held button pans. They are different gestures, so
            // neither has to be given up for the other.
            aimTorch(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
          }}
          onPointerUp={() => {
            if (!dragging.current) return;
            dragging.current = null;
            commitMagnification();
          }}
          onPointerCancel={() => {
            dragging.current = null;
          }}
          style={{
            width: SECTION_WINDOW,
            height: SECTION_WINDOW,
            cursor: dragging.current
              ? "grabbing"
              : torch
                ? "crosshair"
                : zoom === 1
                  ? "default"
                  : "grab",
          }}
        >
          <canvas
            ref={canvas}
            width={SLICE_PIXELS.value}
            height={SLICE_PIXELS.value}
            className="absolute inset-0 h-full w-full"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              // Smooth while there is still source to smooth, and honest
              // blocks once there is not. See `pastNativeSize`.
              imageRendering: pastNativeSize(zoom, frameWidth, SLICE_PIXELS.value)
                ? "pixelated"
                : "auto",
            }}
            aria-label="Cross-section at the height of the scanner"
          />
        </div>

        <div className="flex w-72 flex-col gap-3 self-center">
          <p className="text-[10px] uppercase tracking-wider text-cyan-500/70">
            Axial{level ? ` · ${level}` : ""} ·{" "}
            {stepped ? `${SECTION_STEP_CM} cm steps` : "where you let go"}
          </p>

          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => {
              magnify(1 / 1.4);
              commitWhenStill();
            }}
              className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              −
            </button>
            <button
              type="button"
              title="Back to the whole section"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
                takenBy.current = null;
                if (SECTION_VIEW.value === null) return;
                SECTION_VIEW.value = null;
                wantSection();
              }}
              className="w-20 rounded border border-slate-700 px-2 py-0.5 tabular-nums text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              {across > 0 ? `${across.toFixed(across < 10 ? 1 : 0)} cm` : "—"}
            </button>
            <button
              type="button"
              onClick={() => {
              magnify(1.4);
              commitWhenStill();
            }}
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
