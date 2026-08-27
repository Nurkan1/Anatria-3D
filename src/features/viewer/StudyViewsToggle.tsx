import { useSceneStore } from "@/stores/sceneStore";
import { useStudyViewsStore } from "@/stores/studyViewsStore";

/**
 * The switch that splits the viewport into four panels.
 *
 * # Why it floats over the viewport instead of joining the view controls
 *
 * It did join them, briefly. When the strip of view controls moved out of the
 * anatomy tree to sit below all three tabs, this came along on the reasoning
 * that it answers the same question they do — how the model is drawn.
 *
 * That reasoning was wrong for one reason that only shows up on a real screen.
 * The strip wraps, and this was its last button, so it landed on the bottom row
 * of a panel whose container clips without a scrollbar. On a window whose lower
 * edge falls behind the taskbar, that row is the first thing to go, and a
 * control that vanishes leaving no trace is worse than one in an odd place.
 *
 * Here it is anchored well clear of the bottom edge, it is visible from every
 * tab because the viewport is, and it sits beside the model it rearranges.
 *
 * # Why the gate is a rule and not advice
 *
 * Measured on this atlas: the whole body is 3,478 draw calls at 51 fps, so four
 * panels of it is roughly fourteen thousand and holds no frame rate anywhere.
 * One isolated structure is a single draw call, which makes four panels of it
 * cost four. The gate is not part of the performance strategy — it is the whole
 * of it, which is why it is enforced in code rather than written down as a
 * recommendation.
 */
export function StudyViewsToggle() {
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const studyViews = useStudyViewsStore((s) => s.wanted);
  const setStudyViews = useStudyViewsStore((s) => s.setWanted);

  return (
    <button
      type="button"
      onClick={() => setStudyViews(!studyViews)}
      disabled={isolatedOrganIds === null}
      aria-pressed={studyViews}
      title={
        isolatedOrganIds === null
          ? "Isolate a structure first — four views of the whole atlas will not hold a frame rate"
          : "See what is isolated from three fixed angles at once, beside the view you drive"
      }
      className={`pointer-events-auto rounded border px-2 py-1 text-xs disabled:opacity-40 ${
        studyViews
          ? "border-sky-500 bg-sky-500/10 text-sky-300"
          : "border-slate-700 bg-slate-950/70 text-slate-400"
      }`}
    >
      Study views
    </button>
  );
}
