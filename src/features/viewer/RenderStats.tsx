import { useFrame, useThree } from "@react-three/fiber";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";

import { fps, heapMb, noteFrame, sample } from "./renderSample";
import { viewportKey } from "./viewportKeys";
import { AXIAL_PROBE } from "./AxialProbe";
import { FRONTAL_PROBE, wantFrontalProbe } from "./FrontalProbe";
import { SLICE_PIXELS } from "./axialSlice";
import { readLocal, writeLocal } from "@/lib/localStore";
import { OVERLAY_CHIP } from "./overlayChrome";

/**
 * The frame counter, and the panel that shows it.
 *
 * # Why it ships
 *
 * It was built as an instrument, to decide whether the multi-viewport mode was
 * affordable, and it was going to be stripped from the release once that
 * question was answered. It stays because the question it answers did not go
 * away with the decision: the README claims a minimum machine, and this is the
 * only way anyone — the reader, or whoever they are reporting to — can check
 * that claim on the machine actually in front of them. "It feels slow" and
 * "34 fps, p95 41 ms, 3,478 draw calls" are not the same report.
 *
 * # What it costs to leave on
 *
 * Per frame: reading six integers off `renderer.info`, which the renderer is
 * already maintaining. The one measurement that costs anything walks the scene
 * graph, and that runs twice a second rather than sixty times — see `sweep`.
 * The readout itself writes through `textContent` on an animation frame and
 * only while it is open, so a closed panel is one collapsed chip and nothing
 * else.
 */

/** How often the expensive samples are taken, in milliseconds. */
const SWEEP_MS = 500;

/**
 * Counts the scene rather than the frame, on a slow interval.
 *
 * Walking the graph is the one measurement that costs something — three and a
 * half thousand nodes — so it runs twice a second instead of sixty times. It
 * would be self-defeating to have the instrument show up in its own readings.
 */
function sweep(scene: THREE.Scene): void {
  let visible = 0;
  let objects = 0;
  scene.traverse((object) => {
    objects += 1;
    // `visible` on the object itself, not the inherited flag: a mesh under a
    // hidden group is not drawn either, but the atlas keeps its structures as
    // siblings, so the two answers coincide here and the cheap one is honest.
    if ((object as THREE.Mesh).isMesh && object.visible) visible += 1;
  });
  sample.visible = visible;
  sample.objects = objects;
  sample.canvases = document.querySelectorAll("canvas").length;
  sample.heapMb = heapMb();
}

/**
 * Reads the renderer once a frame. Belongs inside the `Canvas`.
 *
 * Sampled *before* the render rather than after, which is not an accident:
 * `WebGLRenderer.info` resets itself at the top of every `render()` call, so a
 * reading taken here describes the frame that has just finished. Reading after
 * the render would report a frame that had not drawn anything yet.
 */
export function RenderProbe() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const last = useRef(performance.now());
  const swept = useRef(0);

  useFrame(() => {
    const now = performance.now();
    noteFrame(now - last.current);
    last.current = now;

    const info = gl.info;
    sample.calls = info.render.calls;
    sample.triangles = info.render.triangles;
    sample.geometries = info.memory.geometries;
    sample.textures = info.memory.textures;
    sample.programs = info.programs?.length ?? 0;

    if (now - swept.current > SWEEP_MS) {
      swept.current = now;
      sweep(scene);
    }
  });

  return null;
}

interface Row {
  label: string;
  read: () => string;
  /** Emphasised rows are the ones the multi-view decision turns on. */
  key?: boolean;
}

const ROWS: Row[] = [
  { label: "fps", read: () => fps(sample).toFixed(0), key: true },
  { label: "p95", read: () => `${sample.p95Ms.toFixed(1)} ms`, key: true },
  { label: "draw calls", read: () => sample.calls.toLocaleString(), key: true },
  { label: "triangles", read: () => sample.triangles.toLocaleString() },
  { label: "meshes drawn", read: () => sample.visible.toLocaleString(), key: true },
  { label: "objects", read: () => sample.objects.toLocaleString() },
  { label: "geometries", read: () => sample.geometries.toLocaleString() },
  { label: "textures", read: () => sample.textures.toLocaleString() },
  { label: "programs", read: () => sample.programs.toLocaleString() },
  { label: "canvases", read: () => String(sample.canvases) },
  {
    label: "heap",
    read: () => (sample.heapMb === null ? "—" : `${sample.heapMb.toFixed(0)} MB`),
  },
  /*
   * Phase 0 for the axial slice, and temporary with it.
   *
   * A dash until the probe has run once, so an empty reading is visibly "not
   * measured yet" rather than "measured as zero" — the two look identical in a
   * screenshot and mean opposite things.
   */
  {
    label: "axial render",
    read: () => (AXIAL_PROBE.renderMs < 0 ? "—" : `${AXIAL_PROBE.renderMs.toFixed(1)} ms`),
  },
  {
    label: "axial readback",
    read: () => (AXIAL_PROBE.readbackMs < 0 ? "—" : `${AXIAL_PROBE.readbackMs.toFixed(1)} ms`),
  },
  {
    label: "axial calls",
    read: () => (AXIAL_PROBE.drawCalls < 0 ? "—" : AXIAL_PROBE.drawCalls.toLocaleString()),
  },
  {
    label: "axial drawn",
    read: () => (AXIAL_PROBE.drawn < 0 ? "—" : AXIAL_PROBE.drawn.toLocaleString()),
  },
  { label: "axial runs", read: () => String(AXIAL_PROBE.runs) },
  // What it actually read at, which is not always what was asked for: the card
  // has the last word on the size of a render target.
  { label: "axial pixels", read: () => `${SLICE_PIXELS.value}²` },
  /*
   * Phase 0 for a frontal section. Front, middle and back of the body, each as
   * render + readback and the draw calls the pass cost — the number that
   * decides whether a frontal section is affordable at all.
   */
  {
    label: "frontal cut",
    read: () => (FRONTAL_PROBE.passes.length === 0 ? "—" : FRONTAL_PROBE.cut ? "cut" : "slab"),
  },
  ...["front", "middle", "back"].map(
    (name, index): Row => ({
      label: `frontal ${name}`,
      read: () => {
        const pass = FRONTAL_PROBE.passes[index];
        return pass
          ? `${pass.renderMs.toFixed(1)}+${pass.readbackMs.toFixed(1)} ms · ${pass.drawCalls.toLocaleString()}`
          : "—";
      },
    }),
  ),
];

/**
 * The readout. Lives outside the canvas, in the DOM, like the label overlay.
 *
 * Written to with `textContent` on an animation frame rather than through
 * state, for the reason in `renderSample`: a panel that re-rendered React sixty
 * times a second would be measuring itself.
 *
 * Positioned by whatever holds it — until somebody moves it.
 *
 * It sat in the stacked column with the rest of the overlay, which is right
 * until the panel grows: five rows of axial instrumentation made it tall
 * enough to run off the top of the viewport, where the first readings could
 * not be read at all. Rather than shorten it or find it a better corner —
 * there isn't one, the corners are taken — the header is a handle.
 *
 * It only leaves the column once it has been dragged, and it starts from
 * exactly where it was sitting, so nothing moves for a reader who never
 * touches it and nothing jumps for one who does. The place is remembered, and
 * clamped back inside on the way in: a position saved on a large monitor must
 * not hide the panel on a laptop.
 */
const PLACE_KEY = "anatria3d.stats.place.v1";

/** Kept on screen by this much, whatever was saved or dragged. */
const KEEP_VISIBLE = 120;

export function clampToWindow(place: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(place.x, 0), Math.max(0, window.innerWidth - KEEP_VISIBLE)),
    y: Math.min(Math.max(place.y, 0), Math.max(0, window.innerHeight - KEEP_VISIBLE)),
  };
}

export function storedPlace(): { x: number; y: number } | null {
  const raw = readLocal(PLACE_KEY);
  if (!raw) return null;
  const [x, y] = raw.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return clampToWindow({ x: x as number, y: y as number });
}

export function RenderStatsPanel() {
  const [open, setOpen] = useState(false);
  const cells = useRef<(HTMLSpanElement | null)[]>([]);
  const [place, setPlace] = useState<{ x: number; y: number } | null>(storedPlace);
  const grab = useRef<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A window that shrank while the panel was elsewhere must not strand it.
    const onResize = () => setPlace((at) => (at ? clampToWindow(at) : at));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /**
   * If it opened off the screen, it rescues itself.
   *
   * The handle is the header, and when the panel is too tall for the column
   * the header is exactly the part that has gone: there is nothing left to
   * grab, and dragging it back is impossible by the only means provided.
   * Reported from a laptop, and it is the kind of bug that makes a feature
   * look like it does not work rather than like it is out of reach.
   *
   * Measured after layout rather than guessed from a row count, so it holds
   * however many rows the panel grows to next.
   */
  useLayoutEffect(() => {
    if (!open || place) return;
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    const escaped = box.top < 0 || box.left < 0 || box.bottom > window.innerHeight;
    if (escaped) setPlace(clampToWindow({ x: Math.max(box.left, 8), y: 8 }));
  }, [open, place]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Through the same guard every other viewport key uses, so pressing "m"
      // inside the chat box types an m.
      if (viewportKey(event) !== "m") return;
      setOpen((value) => !value);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const tick = () => {
      for (const [index, row] of ROWS.entries()) {
        const cell = cells.current[index];
        if (cell) cell.textContent = row.read();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) {
    return (
      <div className={`pointer-events-none select-none ${OVERLAY_CHIP}`}>
        M · render stats
      </div>
    );
  }

  return (
    <div
      ref={panel}
      className={`pointer-events-none select-none rounded border border-slate-700/70 bg-slate-950/90 px-2.5 py-2 font-mono text-[10px] text-slate-300 shadow-lg ${
        place ? "fixed z-30" : ""
      }`}
      style={place ? { left: place.x, top: place.y } : undefined}
    >
      {/*
        The header is the handle. Dragging lifts the panel out of the stacked
        column and into place at exactly the spot it already occupied, so the
        first movement is the reader's and not a jump.
      */}
      <p
        className="pointer-events-auto mb-1.5 cursor-grab text-[9px] uppercase tracking-wider text-slate-500 active:cursor-grabbing"
        onPointerDown={(event) => {
          const box = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!box) return;
          grab.current = { x: event.clientX - box.left, y: event.clientY - box.top };
          setPlace(clampToWindow({ x: box.left, y: box.top }));
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = grab.current;
          if (!from) return;
          setPlace(clampToWindow({ x: event.clientX - from.x, y: event.clientY - from.y }));
        }}
        onPointerUp={(event) => {
          grab.current = null;
          const box = event.currentTarget.parentElement?.getBoundingClientRect();
          if (box) writeLocal(PLACE_KEY, `${Math.round(box.left)},${Math.round(box.top)}`);
        }}
        onPointerCancel={() => {
          grab.current = null;
        }}
        title="Drag to move · M to hide"
      >
        Renderer · drag me · M to hide
      </p>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        {ROWS.map((row, index) => (
          <Fragment key={row.label}>
            <span className={row.key ? "text-slate-400" : "text-slate-600"}>
              {row.label}
            </span>
            <span
              ref={(node) => {
                cells.current[index] = node;
              }}
              className={`text-right ${row.key ? "text-sky-300" : "text-slate-400"}`}
            >
              —
            </span>
          </Fragment>
        ))}
      </div>
      {/*
        Phase 0: asks the frontal probe for one measurement. The panel is
        instrumentation already, which is why the question lives here and not
        among the scanner's own controls.
      */}
      <button
        type="button"
        onClick={wantFrontalProbe}
        className="pointer-events-auto mt-2 w-full rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
      >
        Measure frontal
      </button>
    </div>
  );
}
