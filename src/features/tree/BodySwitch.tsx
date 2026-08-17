import { useSceneStore } from "@/stores/sceneStore";
import type { GenderModel } from "@/lib/schemas";

/**
 * Which body the atlas is showing.
 *
 * # Why this control explains itself
 *
 * Because the two sides are not equivalent, and pretending otherwise is the
 * one thing that would make this feature read as broken. The male atlas is a
 * whole body — every system, several thousand structures. The female atlas is
 * the pelvis and the reproductive organs and nothing else, because no open
 * whole-body female atlas exists to build one from: the NIH Human Reference
 * Atlas models organs for cell mapping, not a body for teaching, and the raw
 * Visible Human Female is 40 GB of photographs with no meshes in it.
 *
 * A plain Male/Female toggle would therefore promise a body and deliver a
 * pelvis, and a reader would reasonably conclude the download had failed. So
 * the button says what it holds, and the line under it says what is missing.
 * Under-promising here costs a line of text; the alternative costs trust in
 * everything else on screen.
 */
export function BodySwitch() {
  const genderModel = useSceneStore((s) => s.genderModel);
  const setGenderModel = useSceneStore((s) => s.setGenderModel);
  const manifest = useSceneStore((s) => s.manifest);

  const count = manifest?.organs.length ?? 0;

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Body
      </h2>
      <div
        role="radiogroup"
        aria-label="Anatomical model"
        className="flex gap-1 rounded border border-slate-800 bg-slate-950/60 p-1"
      >
        <BodyButton
          value="male"
          active={genderModel === "male"}
          onPick={setGenderModel}
          label="Male"
          detail="Whole body"
        />
        <BodyButton
          value="female"
          active={genderModel === "female"}
          onPick={setGenderModel}
          label="Female"
          detail="Pelvis only"
        />
      </div>

      {genderModel === "female" && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          Pelvic and reproductive anatomy
          {count > 0 ? ` — ${count} structures` : ""}, from the NIH Human Reference
          Atlas. This is not a whole female body: no open dataset provides one. For
          every other region, switch back to the male atlas.
        </p>
      )}
    </section>
  );
}

function BodyButton({
  value,
  active,
  onPick,
  label,
  detail,
}: {
  value: GenderModel;
  active: boolean;
  onPick: (value: GenderModel) => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onPick(value)}
      // Switching atlases drops the selection, because the organ ids of one
      // name nothing in the other. Saying so before the click beats leaving the
      // reader to notice their selection has gone.
      title={
        active
          ? `Showing the ${label.toLowerCase()} atlas`
          : `Switch to the ${label.toLowerCase()} atlas — this clears the current selection`
      }
      className={`flex flex-1 flex-col items-center rounded px-2 py-1 transition ${
        active
          ? "bg-sky-600/20 text-sky-200 ring-1 ring-inset ring-sky-700/60"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
      }`}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] uppercase tracking-wide opacity-70">{detail}</span>
    </button>
  );
}
