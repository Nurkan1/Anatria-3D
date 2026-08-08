/**
 * The opening screen.
 *
 * Restrained on purpose. This is a teaching tool that a student may open twenty
 * times a day, and an animation that is charming once is an obstruction by the
 * fifth time — so it is quiet, it is short, and it never asks to be watched.
 *
 * The trace is a cardiac rhythm because it is the one motif that is both alive
 * and unmistakably anatomical: a bright segment sweeping a dim line, the way a
 * monitor draws it. Pure SVG and CSS — no image to load, which matters for a
 * screen whose entire job is to be there before anything has loaded.
 */
export function SplashScreen({ leaving }: { leaving: boolean }) {
  return (
    <div
      // `fixed`, not absolute: it covers the whole window including the panels,
      // which are laid out before the atlas exists and would otherwise show
      // through as empty furniture.
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0b1220] transition-opacity duration-[420ms] ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
      aria-label="Anatria3D is starting"
    >
      <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
        Anatria<span className="text-sky-400">3D</span>
      </h1>

      <svg
        viewBox="0 0 240 60"
        className="mt-4 h-12 w-60"
        fill="none"
        aria-hidden
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* The rhythm, laid down twice so the sweep never runs out of line. */}
        <path d={TRACE} className="text-sky-500/20" />
        <path d={TRACE} className="animate-ecg text-sky-300" />
      </svg>

      <p className="mt-3 text-[11px] text-slate-500">Loading the anatomy…</p>

      {/* The boundary belongs on the first screen, not only on the fifth. */}
      <p className="absolute bottom-6 text-[10px] text-slate-700">
        Educational use only — not a medical device.
      </p>
    </div>
  );
}

/**
 * Two PQRST complexes across the viewBox: baseline, P bump, the QRS spike, T
 * bump, baseline. Drawn in straight segments rather than curves because that is
 * how a monitor renders it, and the sharp R spike is what makes it legible at
 * this size.
 */
const TRACE =
  "M0,30 L18,30 L22,24 L26,30 L40,30 L44,33 L48,9 L52,49 L56,30 L70,30 " +
  "L78,30 L84,21 L90,30 L118,30 " +
  "L138,30 L142,24 L146,30 L160,30 L164,33 L168,9 L172,49 L176,30 L190,30 " +
  "L198,30 L204,21 L210,30 L240,30";
