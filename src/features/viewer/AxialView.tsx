import { useEffect, useRef, useState } from "react";

import { useScanStore } from "@/stores/scanStore";

import { SLICE_SIZE } from "./AxialProbe";
import { AXIAL_CANVAS, restoreSlice } from "./axialSlice";

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
 * The pass is rendered at 512 because its cost is draw calls rather than
 * pixels, so the resolution is nearly free — but a panel that size would cover
 * the body it is a section of. It sits small until somebody asks to see it,
 * and the enlarged view is the *same* canvas element moved, not a copy: two
 * canvases would mean painting twice, and the producer knows about one.
 */
export function AxialView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const enabled = useScanStore((s) => s.enabled);
  const axial = useScanStore((s) => s.axial);
  const [full, setFull] = useState(false);

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
  }, [enabled, axial, full]);

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

  if (!enabled || !axial) return null;

  const caption =
    "Anterior at the top. Drawn solid whatever the viewport shows, and the cut " +
    "surfaces are open — an outline, not a radiograph.";

  if (full) {
    return (
      <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-slate-950/95 p-6">
        <p className="text-[10px] uppercase tracking-wider text-cyan-500/70">
          Axial · where you let go
        </p>
        <canvas
          ref={canvas}
          width={SLICE_SIZE}
          height={SLICE_SIZE}
          className="max-h-[70vh] max-w-[70vh] rounded bg-black"
          aria-label="Cross-section at the height of the scanner"
        />
        <p className="max-w-md text-center text-[11px] leading-snug text-slate-500">{caption}</p>
        <button
          type="button"
          onClick={() => setFull(false)}
          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-cyan-700 hover:text-cyan-300"
        >
          Close · Esc
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none select-none rounded border border-cyan-900/60 bg-slate-950/85 p-1.5 shadow-lg">
      <p className="mb-1 text-[9px] uppercase tracking-wider text-cyan-500/70">
        Axial · where you let go
      </p>
      <button
        type="button"
        onClick={() => setFull(true)}
        title="See it full size"
        className="pointer-events-auto block cursor-zoom-in rounded-sm"
      >
        <canvas
          ref={canvas}
          width={SLICE_SIZE}
          height={SLICE_SIZE}
          className="block h-36 w-36 rounded-sm bg-black"
          aria-label="Cross-section at the height of the scanner. Click to enlarge."
        />
      </button>
      <p className="mt-1 max-w-36 text-[9px] leading-snug text-slate-500">{caption}</p>
    </div>
  );
}
