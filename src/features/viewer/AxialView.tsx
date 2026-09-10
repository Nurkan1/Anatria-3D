import { useEffect, useRef } from "react";

import { useScanStore } from "@/stores/scanStore";

import { SLICE_SIZE } from "./AxialProbe";
import { AXIAL_CANVAS } from "./axialSlice";

/**
 * The cross-section, once it has left the GPU.
 *
 * # Why this is a plain canvas and not part of the scene
 *
 * Because a section only has to be right while the plane is still. Rendered
 * into the 3D view it would be redrawn sixty times a second for a picture that
 * changes when the reader lets go of a slider — measured on this atlas, a
 * second pass of the body costs about ten milliseconds even after the slab is
 * culled, which as a per-frame cost would take the viewport from fifty frames
 * to thirty.
 *
 * Read back into an ordinary canvas element, it costs that ten milliseconds
 * *once* and then nothing at all. The render loop does not know this exists.
 *
 * # Why it says the height
 *
 * A section with no level is a picture of something. The number is what makes
 * it a reading, and it is the same number the slider is showing.
 */
export function AxialView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const enabled = useScanStore((s) => s.enabled);
  const axial = useScanStore((s) => s.axial);

  useEffect(() => {
    // Published while mounted, and taken back on the way out: the producer
    // runs inside the canvas and would otherwise paint into an element React
    // has already removed.
    AXIAL_CANVAS.value = canvas.current;
    return () => {
      AXIAL_CANVAS.value = null;
    };
  }, [enabled, axial]);

  if (!enabled || !axial) return null;

  return (
    <div className="pointer-events-none select-none rounded border border-cyan-900/60 bg-slate-950/85 p-1.5 shadow-lg">
      <p className="mb-1 text-[9px] uppercase tracking-wider text-cyan-500/70">
        Axial · where you let go
      </p>
      {/*
        Fixed at the size it is rendered, and shown smaller. Scaling a canvas
        down in CSS is the browser's own filtering and costs nothing; scaling a
        readback up would be inventing detail the slice does not have.
      */}
      <canvas
        ref={canvas}
        width={SLICE_SIZE}
        height={SLICE_SIZE}
        className="block h-36 w-36 rounded-sm bg-black"
        aria-label="Cross-section at the height of the scanner"
      />
      <p className="mt-1 text-[9px] leading-snug text-slate-500">
        Anterior at the top. Cut surfaces are open — this is an outline, not a
        radiograph.
      </p>
    </div>
  );
}
