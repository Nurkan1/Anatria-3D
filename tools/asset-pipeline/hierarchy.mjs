/**
 * The anatomical hierarchy, and the places the vendored one gets it wrong.
 *
 * # What broke, and how it looked
 *
 * The male atlas takes its hierarchy from Z-Anatomy's Blender collection
 * nesting. That nesting is right almost everywhere and badly wrong in the
 * nervous system: asking the atlas to isolate `Brain` returned 68 structures —
 * the **right** hemisphere's gyri and sulci, plus the cerebellum. The left
 * hemisphere, the whole brainstem, the whole diencephalon and the corpus
 * callosum were filed as *siblings* of `Brain` rather than inside it, so a
 * reader who asked to see the brain was shown half a brain, and an assistant
 * that then lit the thalamus lit something the isolation had hidden.
 *
 * That is not a rendering fault. For the application, the left precentral gyrus
 * was not part of the brain.
 *
 * # Two mechanisms, and only one of them needs an anatomist
 *
 * **Propagation** fixes 39 terms with no judgement at all. Where one side of a
 * paired structure carries a full path and the other carries a short one, the
 * short one is a defect provable from its own twin — `Gyrus precentralis` on
 * the right sat under `Brain > Cerebrum > Telencephalon` while the left sat
 * under `Central nervous system`. The deeper path wins, and nothing is invented.
 *
 * **`NERVOUS_PATHS`** covers the rest, where no side was placed correctly and a
 * decision has to be made. Those are written out below with the subdivision
 * each structure belongs to, which is the one part of this file that is a claim
 * about anatomy rather than about data.
 *
 * # Why here rather than in the export
 *
 * Same reason the TA2 corrections live in `ta2.mjs`: the vendored material is
 * not ours to edit. Re-nesting Z-Anatomy's collections would make every future
 * update a merge conflict and would hide the defect from whoever inherits this.
 * The correction is applied on the way in, where it is visible and reviewable,
 * and the build fails if one of these entries stops matching anything.
 */

const CNS = ["Central nervous system"];
const BRAIN = [...CNS, "Brain"];
/** Matches the nesting Z-Anatomy already uses for the structures it placed. */
const TELENCEPHALON = [...BRAIN, "Cerebrum", "Telencephalon"];
const DIENCEPHALON = [...BRAIN, "Diencephalon"];
const BRAINSTEM = [...BRAIN, "Brainstem"];
const MIDBRAIN = [...BRAINSTEM, "Mesencephalon"];
const PONS = [...BRAINSTEM, "Pons"];
const MEDULLA = [...BRAINSTEM, "Medulla oblongata"];
const VENTRICLES = [...BRAIN, "Ventricular system"];
const SPINAL_CORD = [...CNS, "Spinal cord"];
const MENINGES = [...CNS, "Meninges"];
const PNS = ["Peripheral nervous system"];
const SENSE_ORGANS = ["Sense organs"];
const EYEBALL = [...SENSE_ORGANS, "Eyeball"];

/**
 * Where each misfiled nervous structure belongs, by its TA2 Latin term.
 *
 * Keyed by Latin because the defect is per-structure, not per-side: both the
 * left and right thalamus were filed loose, and naming the term once fixes the
 * pair. Applied only to structures whose system is `nervous`.
 */
export const NERVOUS_PATHS = {
  // --- Telencephalon: cortex is handled by propagation; these are the deep
  // grey masses, the commissures and the limbic structures, none of which had
  // a correctly-placed side to copy.
  "Corpus callosum": TELENCEPHALON,
  "Commissura anterior": TELENCEPHALON,
  "Commissura hippocampi": TELENCEPHALON,
  Fornix: TELENCEPHALON,
  "Septum pellucidum": TELENCEPHALON,
  "Nuclei septales": TELENCEPHALON,
  Hippocampus: TELENCEPHALON,
  "Corpus amygdaloideum": TELENCEPHALON,
  "Nucleus caudatus": TELENCEPHALON,
  Putamen: TELENCEPHALON,
  "Globus pallidus": TELENCEPHALON,
  "Nucleus lentiformis": TELENCEPHALON,
  "Stria terminalis": TELENCEPHALON,

  // --- Diencephalon. Thalamus and hypothalamus proper, the epithalamus
  // (habenula, stria medullaris, posterior commissure), the metathalamus (the
  // geniculate bodies), and the optic chiasm and tract, which TA2 places here
  // rather than with the cranial nerves.
  Thalamus: DIENCEPHALON,
  Hypothalamus: DIENCEPHALON,
  "Corpus mammillare": DIENCEPHALON,
  Habenula: DIENCEPHALON,
  "Stria medullaris thalami": DIENCEPHALON,
  "Commissura posterior": DIENCEPHALON,
  "Corpus geniculatum laterale": DIENCEPHALON,
  "Corpus geniculatum mediale": DIENCEPHALON,
  "Chiasma opticum": DIENCEPHALON,
  "Tractus opticus": DIENCEPHALON,

  // --- Midbrain, including the nuclei of the third and fourth cranial nerves.
  Mesencephalon: MIDBRAIN,
  "Aquaeductus mesencephali": MIDBRAIN,
  "Colliculus superior": MIDBRAIN,
  "Colliculus inferior": MIDBRAIN,
  "Nucleus ruber": MIDBRAIN,
  "Basis pedunculi": MIDBRAIN,
  "Fossa interpeduncularis": MIDBRAIN,
  "Nucleus nervi oculomotorius": MIDBRAIN,
  "Nucleus accessorius nervi oculomotorii": MIDBRAIN,
  "Nucleus nervi trochlearis": MIDBRAIN,

  // --- Pons, with the sixth and seventh nerve nuclei and the superior
  // salivatory nucleus.
  Pons: PONS,
  "Nucleus nervi abducentis": PONS,
  "Nucleus nervi facialis": PONS,
  "Nucleus salivatorius superior": PONS,

  // --- Medulla oblongata, with the nuclei of the ninth, tenth and twelfth.
  "Medulla oblongata": MEDULLA,
  Oliva: MEDULLA,
  "Pyramis medullae oblongatae": MEDULLA,
  "Nucleus ambiguus": MEDULLA,
  "Nucleus nervi hypoglossi": MEDULLA,
  "Nucleus posterior nervi vagi": MEDULLA,
  "Nucleus tractus solitarii": MEDULLA,
  "Nucleus salivatorius inferior": MEDULLA,

  // --- Brainstem without a subdivision, on purpose. These straddle a boundary
  // and filing them under one side of it would be asserting something the
  // textbooks do not: the vestibular and cochlear nuclei sit across the
  // pontomedullary junction, and the accessory nucleus is described in the
  // medulla and the upper cervical cord depending on which root is meant.
  "Nuclei vestibulares": BRAINSTEM,
  "Nucleus cochlearis anterior": BRAINSTEM,
  "Nucleus cochlearis posterior": BRAINSTEM,
  "Nucleus nervi accessorii": BRAINSTEM,

  // --- The ventricles and their choroid plexus. Inside the brain, but not
  // tissue of any one subdivision — the lateral ventricles alone span all four
  // lobes.
  "Ventriculus lateralis": VENTRICLES,
  "Ventriculus tertius": VENTRICLES,
  "Ventriculus quartus": VENTRICLES,
  "Plexus chorioideus": VENTRICLES,

  // --- Meninges. Dura, not nervous tissue, and the reason `Brain` should not
  // swallow them: isolating the brain and getting the falx with it would hide
  // the very structure the reader isolated.
  "Falx cerebri": MENINGES,
  "Tentorium cerebelli": MENINGES,
  "Dura spinalis": MENINGES,

  // --- Spinal cord: grey matter, white matter, and the long tracts. These
  // ascend into the brainstem but are described with the cord, which is also
  // where a reader looks for them.
  "Canalis centralis": SPINAL_CORD,
  "Cornu anterius medullae spinalis": SPINAL_CORD,
  "Cornu posterius medullae spinalis": SPINAL_CORD,
  "Substantia alba medullae spinalis": SPINAL_CORD,
  "Substantia intermedia lateralis": SPINAL_CORD,
  "Nucleus intermediolateralis": SPINAL_CORD,
  "Nucleus intermediomedialis": SPINAL_CORD,
  "Nucleus proprius": SPINAL_CORD,
  "Processus reticularis spinalis": SPINAL_CORD,
  "Fasciculus gracilis": SPINAL_CORD,
  "Fasciculus cuneatus": SPINAL_CORD,
  "Fasciculus posterolateralis": SPINAL_CORD,
  "Fasciculus proprius anterior": SPINAL_CORD,
  "Fasciculus proprius lateralis": SPINAL_CORD,
  "Fasciculus proprius posterior": SPINAL_CORD,
  "Tractus corticospinalis anterior": SPINAL_CORD,
  "Tractus corticospinalis lateralis": SPINAL_CORD,
  "Tractus reticulospinalis lateralis": SPINAL_CORD,
  "Tractus reticulospinalis medialis": SPINAL_CORD,
  "Tractus rubrospinalis": SPINAL_CORD,
  "Tractus spinocerebellaris anterior": SPINAL_CORD,
  "Tractus spinocerebellaris posterior": SPINAL_CORD,
  "Tractus spinotectalis": SPINAL_CORD,
  "Tractus spinothalamicus anterior": SPINAL_CORD,
  "Tractus spinothalamicus lateralis": SPINAL_CORD,
  "Tractus tectospinalis": SPINAL_CORD,
  "Tractus vestibulospinalis lateralis": SPINAL_CORD,
  "Tractus vestibulospinalis medialis": SPINAL_CORD,
  "Cauda equina": SPINAL_CORD,
  "Radix anterior nervi spinalis": SPINAL_CORD,
  "Radix posterior nervi spinalis": SPINAL_CORD,

  // --- Peripheral. The spinal ganglion is the first cell body outside the
  // cord, and `Nervus musculi quadrati femoris` is a branch of the sacral
  // plexus that was filed inside the central nervous system outright.
  "Ganglion spinale": PNS,
  "Nervus musculi quadrati femoris": [...PNS, "Nerves"],

  // --- The eyeball. Filed with the nervous system by Z-Anatomy, which is
  // defensible for the retina and indefensible for the sclera; `Sense organs`
  // already holds the cochlea, the tympanic membrane and the lacrimal
  // apparatus, so the eye joins them.
  "Camera anterior bulbi oculi": EYEBALL,
  Cornea: EYEBALL,
  "Corpus vitreum": EYEBALL,
  "Fibrae zonulares": EYEBALL,
  Iris: EYEBALL,
  Lens: EYEBALL,
  Retina: EYEBALL,
  Sclera: EYEBALL,
  "Segmentum anterius bulbi oculi": EYEBALL,
  "Segmentum posterius bulbi oculi": EYEBALL,
  "Tuba auditiva": SENSE_ORGANS,
};

/**
 * Repair the hierarchy of a built organ list, in place-free fashion.
 *
 * Returns the organs with corrected paths and a count of what each mechanism
 * touched, so the build can print it and a reviewer can see the correction
 * doing something rather than take it on trust.
 *
 * Throws when an entry in `NERVOUS_PATHS` matches no structure. That means the
 * upstream nesting was fixed, or the term was mistyped here — either way the
 * entry is stale and should go, rather than sit in the file looking authoritative.
 */
export function repairHierarchy(organs) {
  const unused = new Set(Object.keys(NERVOUS_PATHS));
  let corrected = 0;

  const withCorrections = organs.map((organ) => {
    if (organ.system !== "nervous") return organ;
    const path = NERVOUS_PATHS[organ.ta2_latin];
    if (!path) return organ;
    unused.delete(organ.ta2_latin);
    corrected += 1;
    return { ...organ, path: [...path] };
  });

  if (unused.size > 0) {
    throw new Error(
      `NERVOUS_PATHS has entries matching no structure: ${[...unused].join(", ")}. ` +
        "If the vendored hierarchy was fixed upstream, delete them.",
    );
  }

  // Propagation, and only inside the nervous system.
  //
  // A term whose sides disagree takes the deepest path any of them carries: the
  // shallow one is a defect its own twin disproves. That reasoning holds where
  // a short path is an oversight, and it does **not** hold elsewhere in this
  // atlas, which is why the rule is scoped rather than global.
  //
  // The muscles are the reason. `Abductor hallucis.l` is the belly, 1,688
  // polygons, filed under `Muscles`; `.ol` and `.el` beside it are its origin
  // and insertion markers, 312 and 126 polygons, filed under nothing. That is
  // Z-Anatomy being deliberate, not careless — pulling those into `Muscles`
  // would make "isolate the muscles" hand back a cloud of attachment markers.
  // Running this globally moved 432 structures; scoped, it moves the ones that
  // were actually wrong.
  const deepest = new Map();
  for (const organ of withCorrections) {
    if (organ.system !== "nervous") continue;
    const current = deepest.get(organ.ta2_latin);
    if (!current || organ.path.length > current.length) {
      deepest.set(organ.ta2_latin, organ.path);
    }
  }

  let propagated = 0;
  const repaired = withCorrections.map((organ) => {
    if (organ.system !== "nervous") return organ;
    const best = deepest.get(organ.ta2_latin);
    if (!best || best.length <= organ.path.length) return organ;
    propagated += 1;
    return { ...organ, path: [...best] };
  });

  return { organs: repaired, corrected, propagated };
}
