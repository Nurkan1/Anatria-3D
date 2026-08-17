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
 * the trunk: spine, abdominal organs and pelvis. No open whole-body female
 * atlas exists to build one from — the NIH Human Reference Atlas models organs
 * for cell mapping rather than a body for teaching, and the raw Visible Human
 * Female is 40 GB of photographs with no meshes in it.
 *
 * A plain Male/Female toggle would therefore promise a body and deliver a
 * trunk, and a reader would reasonably conclude the download had failed. So the
 * button says what it holds, and the lines under it say what is missing.
 * Under-promising here costs three lines of text; the alternative costs trust
 * in everything else on screen.
 *
 * # Why this body's variants are listed here
 *
 * Because the reader will otherwise measure them and be wrong in an exam.
 *
 * The male atlas is an idealised composite; this one is a 59-year-old woman,
 * frozen and sectioned supine, and she differs from the textbook in at least
 * two measurable ways. Both were verified against this model's own geometry
 * rather than taken from the source's word for it: the kidneys span L1 to L5
 * against the vertebrae shipped beside them, where the classical description is
 * T12 to L3, and the left is 2.7 cm longer than the right. Cadaveric position
 * and the loss of muscle tone account for much of the descent, and renal ptosis
 * is commoner in older women.
 *
 * Neither is an error to correct — the geometry is the published NIH data,
 * unaltered. But a student who counts six lumbar vertebrae, or measures the
 * renal level here and writes it in an exam, has been failed by this interface
 * and not by the atlas. They will not go looking in the guide for an
 * explanation of a number they do not yet know is unusual, so it has to be at
 * the point where they choose the body.
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
          detail="Trunk only"
        />
      </div>

      {genderModel === "female" && (
        <div className="mt-1.5 space-y-1.5 text-[10px] leading-relaxed text-slate-500">
          <p>
            Spine, abdominal organs, pelvis and breast
            {count > 0 ? ` — ${count} structures` : ""}, from the NIH Human Reference
            Atlas. Not a whole female body: no open dataset provides one. For the head,
            thorax or limbs, switch back to the male atlas.
          </p>
          <p>
            There is <strong className="text-slate-400">no skull, ribcage or
            musculature</strong> here — the source models organs, not a skeleton. What
            is present is complete; what is absent is absent from the data.
          </p>
          <p className="border-t border-slate-800 pt-1.5">
            <strong className="text-slate-400">This is one woman, not the average.</strong>{" "}
            The male atlas draws you the diagram; this one shows you a person, and she
            differs from the textbook in two ways worth knowing before an exam:
          </p>
          <ul className="ml-3 list-disc space-y-1 marker:text-slate-600">
            <li>
              <strong className="text-slate-400">Six lumbar vertebrae</strong>, not
              five — a real variant, in roughly one person in twenty.
            </li>
            <li>
              <strong className="text-slate-400">The kidneys sit low</strong>, spanning
              L1–L5 where the classical description is T12–L3, and the left is 2.7 cm
              longer than the right. Learn <em>T12–L3</em> for the exam.
            </li>
          </ul>
        </div>
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
