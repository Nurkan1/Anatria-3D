import { useFrame, useThree } from "@react-three/fiber";
import { Fragment, useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { fps, heapMb, noteFrame, sample } from "./renderSample";
import { viewportKey } from "./viewportKeys";

/**
 * The frame counter, and the panel that shows it. Development builds only.
 *
 * Mounted behind `import.meta.env.DEV` at the call site, so neither piece is in
 * the shipped bundle at all — this is an instrument for deciding whether the
 * multi-viewport mode is affordable, not a feature.
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
];

/**
 * The readout. Lives outside the canvas, in the DOM, like the label overlay.
 *
 * Written to with `textContent` on an animation frame rather than through
 * state, for the reason in `renderStats`: a panel that re-rendered React sixty
 * times a second would be measuring itself.
 */
export function RenderStatsPanel() {
  const [open, setOpen] = useState(false);
  const cells = useRef<(HTMLSpanElement | null)[]>([]);

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
      <div className="pointer-events-none absolute bottom-2 left-2 z-20 select-none rounded border border-slate-800/60 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">
        M · render stats
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-20 select-none rounded border border-slate-700/70 bg-slate-950/90 px-2.5 py-2 font-mono text-[10px] text-slate-300 shadow-lg">
      <p className="mb-1.5 text-[9px] uppercase tracking-wider text-slate-500">
        Renderer · dev only · M to hide
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
    </div>
  );
}
