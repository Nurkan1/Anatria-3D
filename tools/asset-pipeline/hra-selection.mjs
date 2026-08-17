/**
 * Which structures of the HRA female body Anatria3D ships, and what to call them.
 *
 * # Why this is a hand-written table
 *
 * The male atlas needs no such table. Z-Anatomy names its objects with the exact
 * English term from Terminologia Anatomica, so `build-manifest.mjs` joins
 * geometry to nomenclature with nothing in between and nothing to maintain.
 *
 * The HRA does not do that, and cannot: it is built for mapping cell types, so
 * it names structures with UBERON and FMA labels. Those labels are correct for
 * their purpose and wrong for teaching, in three specific ways:
 *
 * 1. **They are not unique.** Of 888 structures in the source, only 508 labels
 *    are distinct. The pelvis carries six nodes labelled `compact bone tissue`
 *    and six labelled `trabecular bone tissue` — the tissue, not the bone.
 *    Joining on the label would merge the ilium with the ischium.
 * 2. **They use different wording for the same structure.** `uterine cervix`
 *    is TA2's *Cervix of uterus*; `trigone of urinary bladder` is *Trigone of
 *    bladder*; `hepatic flexure of colon` is *Right colic flexure*. A naive
 *    match resolved 32 of 70; the rest are wording, not absence.
 * 3. **A few are simply wrong.** `VH_F_superior_rectal_vein` carries the label
 *    and UBERON id of the superior rectal *artery*. See `KNOWN_SOURCE_ERRATA`.
 *
 * So the term is declared here, per structure, by hand — and then **verified**:
 * `extract-hra.mjs` fails if any `term` below is absent from TA2.csv. Nothing
 * in this file invents nomenclature; it only says which TA2 term applies to
 * which mesh. A structure TA2 does not list is dropped, with its reason
 * recorded in `NOT_IN_TA2` rather than given a plausible-looking Latin name.
 *
 * The node names are stable and unique (888 of 888 in the source), which is why
 * they, and not the labels, are the key.
 */

/** The HRA digital object these node names come from. */
export const SOURCE = {
  version: "v1.5",
  url: "https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/v1.5/assets/3d-vh-f-united.glb",
  metadata:
    "https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/v1.5/metadata.json",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
};

/**
 * Structures present in the source and deliberately not shipped, because
 * Terminologia Anatomica does not list them. They are real, and two of them are
 * in daily clinical use — but this atlas carries TA2 nomenclature, and the
 * honest way to handle a term the standard omits is to omit the structure, not
 * to coin Latin for it.
 */
export const NOT_IN_TA2 = {
  VH_F_cornua: "The uterine horn. TA2 lists horns of the hyoid, thyroid, sacrum and coccyx, not of the uterus.",
  VH_F_lower_uterine_segment: "An obstetric term, not a TA2 one.",
  VH_F_cervicovaginal_junction: "Carries no label at all in the source, and TA2 has no matching term.",
  VH_F_duodenal_ampulla: "The duodenal cap, a radiological description of the first part of the duodenum. TA2 names the part, not the appearance.",
  VH_F_ileum_terminal: "Labelled 'distal part of ileum'. Terminal ileum is clinical usage; TA2 divides the small intestine into duodenum, jejunum and ileum only.",
};

/**
 * Labels in the source that contradict their own node name. Recorded rather
 * than silently corrected: the geometry is taken from the node, so naming it
 * from the node is what this pipeline already does — but a reader comparing
 * this atlas with the HRA portal should be able to find out why they differ.
 */
export const KNOWN_SOURCE_ERRATA = {
  VH_F_superior_rectal_vein:
    "Labelled 'superior rectal artery' with UBERON:0035040 in HRA v1.5, duplicating the artery node. Named from the node here.",
};

/** `1..n`, inclusive. */
function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * A run of structures the source numbers or letters and TA2 names once.
 *
 * Terminologia Anatomica lists "Thoracic vertebra", not T1 through T12, and
 * "Renal pyramid", not the eleven a kidney happens to have. Writing those out
 * by hand would be seventy near-identical lines in which one transposed digit
 * would be invisible. The mapping is still declared once, by hand — this only
 * expands it.
 */
function series({ node, id, term, path, side = null, keys, label }) {
  return keys.map((key, index) => ({
    node: node(key, index),
    id: id(key, index),
    term,
    qualifier: label(key, index),
    side,
    path,
  }));
}

/**
 * One entry per shipped structure.
 *
 * - `node`   the glTF node name in the source, and the key for everything
 * - `id`     the organ_id. Unique across this file; never collides with the
 *            male atlas because the female manifest is a separate document
 * - `term`   a Terminologia Anatomica 2 **English** term, verified at build time
 * - `qualifier` distinguishes structures the HRA splits and TA2 does not — the
 *            pelvis bones into compact and spongy, the bladder fundus into dome
 *            and base. Without it those pairs would claim one id between them
 * - `side`   `left` | `right` | null
 * - `path`   anatomical ancestry, outermost first, as the tree view reads it
 */
export const STRUCTURES = [
  // -- reproductive: uterus ------------------------------------------------
  { node: "VH_F_body_of_uterus", id: "body_of_uterus", term: "Body of uterus", side: null, path: ["Uterus"] },
  { node: "VH_F_fundus_of_uterus", id: "fundus_of_uterus", term: "Fundus of uterus", side: null, path: ["Uterus"] },
  { node: "VH_F_anterior_wall_of_uterus", id: "anterior_surface_of_uterus", term: "Anterior surface of uterus", side: null, path: ["Uterus"] },
  { node: "VH_F_posterior_wall_of_uterus", id: "posterior_surface_of_uterus", term: "Posterior surface of uterus", side: null, path: ["Uterus"] },
  { node: "VH_F_cervix", id: "cervix_of_uterus", term: "Cervix of uterus", side: null, path: ["Uterus"] },
  { node: "VH_F_internal_cervical_os", id: "internal_os_of_uterus", term: "Internal os of uterus", side: null, path: ["Uterus", "Cervix of uterus"] },
  { node: "VH_F_external_cervical_os", id: "external_os_of_uterus", term: "External os of uterus", side: null, path: ["Uterus", "Cervix of uterus"] },
  { node: "VH_F_abdominal_ostium_of_uterine_tube", id: "abdominal_ostium_of_uterine_tube", term: "Abdominal ostium of uterine tube", side: null, path: ["Uterine tube"] },

  // -- reproductive: uterine tubes ------------------------------------------
  { node: "VH_F_ampulla_of_uterine_tube_L", id: "ampulla_of_uterine_tube_l", term: "Ampulla of uterine tube", side: "left", path: ["Uterine tube"] },
  { node: "VH_F_ampulla_of_uterine_tube_R", id: "ampulla_of_uterine_tube_r", term: "Ampulla of uterine tube", side: "right", path: ["Uterine tube"] },
  { node: "VH_F_isthmus_of_fallopian_tube_L", id: "isthmus_of_uterine_tube_l", term: "Isthmus of uterine tube", side: "left", path: ["Uterine tube"] },
  { node: "VH_F_isthmus_of_fallopian_tube_R", id: "isthmus_of_uterine_tube_r", term: "Isthmus of uterine tube", side: "right", path: ["Uterine tube"] },
  { node: "VH_F_uterine_tube_infundibulum_L", id: "infundibulum_of_uterine_tube_l", term: "Infundibulum of uterine tube", side: "left", path: ["Uterine tube"] },
  { node: "VH_F_uterine_tube_infundibulum_R", id: "infundibulum_of_uterine_tube_r", term: "Infundibulum of uterine tube", side: "right", path: ["Uterine tube"] },
  // "fibria" is a misspelling in the source; the structure is the fimbriae.
  { node: "VH_F_fibria_of_uterine_tube_L", id: "fimbriae_of_uterine_tube_l", term: "Fimbriae of uterine tube", side: "left", path: ["Uterine tube"] },
  { node: "VH_F_fibria_of_uterine_tube_R", id: "fimbriae_of_uterine_tube_r", term: "Fimbriae of uterine tube", side: "right", path: ["Uterine tube"] },

  // -- reproductive: ovaries -------------------------------------------------
  { node: "VH_F_left_ovary", id: "ovary_l", term: "Ovary", side: "left", path: ["Ovary"] },
  { node: "VH_F_right_ovary", id: "ovary_r", term: "Ovary", side: "right", path: ["Ovary"] },

  // -- reproductive: vagina --------------------------------------------------
  { node: "VH_F_vagina", id: "vagina", term: "Vagina", side: null, path: ["Vagina"] },

  // -- reproductive: peritoneal folds and ligaments --------------------------
  { node: "VH_F_broad_ligament", id: "broad_ligament_of_uterus", term: "Broad ligament of uterus", side: null, path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_mesosalpinx_L", id: "mesosalpinx_l", term: "Mesosalpinx", side: "left", path: ["Ligaments of uterus and ovary", "Broad ligament of uterus"] },
  { node: "VH_F_mesosalpinx_R", id: "mesosalpinx_r", term: "Mesosalpinx", side: "right", path: ["Ligaments of uterus and ovary", "Broad ligament of uterus"] },
  { node: "VH_F_mesovarium_L", id: "mesovarium_l", term: "Mesovarium", side: "left", path: ["Ligaments of uterus and ovary", "Broad ligament of uterus"] },
  { node: "VH_F_mesovarium_R", id: "mesovarium_r", term: "Mesovarium", side: "right", path: ["Ligaments of uterus and ovary", "Broad ligament of uterus"] },
  { node: "VH_F_left_round_ligament_of_uterus", id: "round_ligament_of_uterus_l", term: "Round ligament of uterus", side: "left", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_right_round_ligament_of_uterus", id: "round_ligament_of_uterus_r", term: "Round ligament of uterus", side: "right", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_left_uterosacral_ligament", id: "uterosacral_ligament_l", term: "Uterosacral ligament", side: "left", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_right_uterosacral_ligament", id: "uterosacral_ligament_r", term: "Uterosacral ligament", side: "right", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_left_cardinal_ligament_of_uterus", id: "cardinal_ligament_l", term: "Cardinal ligament", side: "left", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_right_cardinal_ligament_of_uterus", id: "cardinal_ligament_r", term: "Cardinal ligament", side: "right", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_suspensory_ligament_of_ovary_L", id: "suspensory_ligament_of_ovary_l", term: "Suspensory ligament of ovary", side: "left", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_suspensory_ligament_of_ovary_R", id: "suspensory_ligament_of_ovary_r", term: "Suspensory ligament of ovary", side: "right", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_ovarian_ligament_L", id: "proper_ovarian_ligament_l", term: "Proper ovarian ligament", side: "left", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_ovarian_ligament_R", id: "proper_ovarian_ligament_r", term: "Proper ovarian ligament", side: "right", path: ["Ligaments of uterus and ovary"] },
  { node: "VH_F_uterovesical_pouch", id: "vesico_uterine_pouch", term: "Vesico-uterine pouch", side: null, path: ["Ligaments of uterus and ovary"] },

  // -- renal: bladder and ureters --------------------------------------------
  // TA2 has one "Fundus of bladder"; the HRA splits it into dome and base, so
  // the qualifier is what keeps them from claiming a single organ_id.
  { node: "VH_F_fundus_of_urinary_bladder_dome", id: "fundus_of_bladder_dome", term: "Fundus of bladder", qualifier: "dome", side: null, path: ["Urinary bladder"] },
  { node: "VH_F_fundus_of_urinary_bladder_base", id: "fundus_of_bladder_base", term: "Fundus of bladder", qualifier: "base", side: null, path: ["Urinary bladder"] },
  { node: "VH_F_trigone_of_urinary_bladder", id: "trigone_of_bladder", term: "Trigone of bladder", side: null, path: ["Urinary bladder"] },
  { node: "VH_F_urinary_bladder_neck_smooth_muscle", id: "neck_of_bladder", term: "Neck of bladder", side: null, path: ["Urinary bladder"] },
  { node: "VH_F_ureteral_orifice_L", id: "ureteric_orifice_l", term: "Ureteric orifice", side: "left", path: ["Urinary bladder", "Trigone of bladder"] },
  { node: "VH_F_ureteral_orifice_R", id: "ureteric_orifice_r", term: "Ureteric orifice", side: "right", path: ["Urinary bladder", "Trigone of bladder"] },
  { node: "VH_F_left_ureter", id: "ureter_l", term: "Ureter", side: "left", path: ["Ureter"] },
  { node: "VH_F_right_ureter", id: "ureter_r", term: "Ureter", side: "right", path: ["Ureter"] },

  // -- skeletal: the pelvic girdle -------------------------------------------
  // The HRA models each hip bone as compact and spongy tissue rather than as a
  // named bone. Both halves are kept, qualified, and filed under the bone —
  // which is what a reader is looking for when they open the pelvis.
  { node: "VH_F_sacrum", id: "sacrum", term: "Sacrum", side: null, path: ["Pelvic girdle"] },
  { node: "VH_F_coccyx", id: "coccyx", term: "Coccyx", side: null, path: ["Pelvic girdle"] },
  { node: "VH_F_ilium_compact_bone_L", id: "ilium_compact_bone_l", term: "Ilium", qualifier: "compact bone", side: "left", path: ["Pelvic girdle", "Hip bone", "Ilium"] },
  { node: "VH_F_ilium_compact_bone_R", id: "ilium_compact_bone_r", term: "Ilium", qualifier: "compact bone", side: "right", path: ["Pelvic girdle", "Hip bone", "Ilium"] },
  { node: "VH_F_ilium_spongy_bone_L", id: "ilium_spongy_bone_l", term: "Ilium", qualifier: "spongy bone", side: "left", path: ["Pelvic girdle", "Hip bone", "Ilium"] },
  { node: "VH_F_ilium_spongy_bone_R", id: "ilium_spongy_bone_r", term: "Ilium", qualifier: "spongy bone", side: "right", path: ["Pelvic girdle", "Hip bone", "Ilium"] },
  { node: "VH_F_ischium_compact_bone_L", id: "ischium_compact_bone_l", term: "Ischium", qualifier: "compact bone", side: "left", path: ["Pelvic girdle", "Hip bone", "Ischium"] },
  { node: "VH_F_ischium_compact_bone_R", id: "ischium_compact_bone_r", term: "Ischium", qualifier: "compact bone", side: "right", path: ["Pelvic girdle", "Hip bone", "Ischium"] },
  { node: "VH_F_ischium_spongy_bone_L", id: "ischium_spongy_bone_l", term: "Ischium", qualifier: "spongy bone", side: "left", path: ["Pelvic girdle", "Hip bone", "Ischium"] },
  { node: "VH_F_ischium_spongy_bone_R", id: "ischium_spongy_bone_r", term: "Ischium", qualifier: "spongy bone", side: "right", path: ["Pelvic girdle", "Hip bone", "Ischium"] },
  { node: "VH_F_pubis_compact_bone_L", id: "pubis_compact_bone_l", term: "Pubis", qualifier: "compact bone", side: "left", path: ["Pelvic girdle", "Hip bone", "Pubis"] },
  { node: "VH_F_pubis_compact_bone_R", id: "pubis_compact_bone_r", term: "Pubis", qualifier: "compact bone", side: "right", path: ["Pelvic girdle", "Hip bone", "Pubis"] },
  { node: "VH_F_pubis_spongy_bone_L", id: "pubis_spongy_bone_l", term: "Pubis", qualifier: "spongy bone", side: "left", path: ["Pelvic girdle", "Hip bone", "Pubis"] },
  { node: "VH_F_pubis_spongy_bone_R", id: "pubis_spongy_bone_r", term: "Pubis", qualifier: "spongy bone", side: "right", path: ["Pelvic girdle", "Hip bone", "Pubis"] },

  // -- digestive: the pelvic continuation of the large intestine -------------
  { node: "VH_F_rectum", id: "rectum", term: "Rectum", side: null, path: ["Large intestine"] },
  { node: "VH_F_sigmoid_colon", id: "sigmoid_colon", term: "Sigmoid colon", side: null, path: ["Large intestine"] },

  // -- cardiovascular: the pelvic vessels ------------------------------------
  // TA2 names these vessels **anorectal**, not rectal — it lists "Middle
  // anorectal artery" with "arteria rectalis media" only as a synonym. The HRA
  // uses the rectal form throughout, so every one of them is renamed here. And
  // several are listed by TA2 in the plural, because the structure genuinely is
  // a set of veins; the side suffix then reads "(left)" on that set, which is
  // what the geometry actually is.
  { node: "VH_F_left_uterine_artery", id: "uterine_artery_l", term: "Uterine artery", side: "left", path: ["Pelvic vessels", "Arteries"] },
  { node: "VH_F_right_uterine_artery", id: "uterine_artery_r", term: "Uterine artery", side: "right", path: ["Pelvic vessels", "Arteries"] },
  { node: "VH_F_superior_rectal_artery", id: "superior_anorectal_artery", term: "Superior anorectal artery", side: null, path: ["Pelvic vessels", "Arteries"] },
  { node: "VH_F_left_uterine_vein", id: "uterine_veins_l", term: "Uterine veins", side: "left", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_right_uterine_vein", id: "uterine_veins_r", term: "Uterine veins", side: "right", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_left_common_iliac_vein", id: "common_iliac_vein_l", term: "Common iliac vein", side: "left", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_right_common_iliac_vein", id: "common_iliac_vein_r", term: "Common iliac vein", side: "right", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_internal_iliac_vein_L", id: "internal_iliac_vein_l", term: "Internal iliac vein", side: "left", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_internal_iliac_vein_R", id: "internal_iliac_vein_r", term: "Internal iliac vein", side: "right", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_internal_pudendal_vein_L", id: "internal_pudendal_vein_l", term: "Internal pudendal vein", side: "left", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_internal_pudendal_vein_R", id: "internal_pudendal_vein_r", term: "Internal pudendal vein", side: "right", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_superior_rectal_vein", id: "superior_anorectal_vein", term: "Superior anorectal vein", side: null, path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_middle_rectal_vein_L", id: "middle_anorectal_veins_l", term: "Middle anorectal veins", side: "left", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_middle_rectal_vein_R", id: "middle_anorectal_veins_r", term: "Middle anorectal veins", side: "right", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_inferior_rectal_vein_L", id: "inferior_anorectal_veins_l", term: "Inferior anorectal veins", side: "left", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_inferior_rectal_vein_R", id: "inferior_anorectal_veins_r", term: "Inferior anorectal veins", side: "right", path: ["Pelvic vessels", "Veins"] },
  { node: "VH_F_median_sacral_vein", id: "median_sacral_vein", term: "Median sacral vein", side: null, path: ["Pelvic vessels", "Veins"] },

  // -- skeletal: the vertebral column ----------------------------------------
  // Continuous with the pelvic girdle above, which is why this block comes
  // before the viscera: it turns the female atlas from a pelvis into an axial
  // skeleton the abdominal organs can hang from.
  //
  // TA2 names the classes, not the bones — "Thoracic vertebra", never T7 — so
  // the level is the qualifier. C1 and C2 are the exceptions it does name.
  { node: "VH_F_cervical_vertebra_1", id: "atlas_c1", term: "Atlas (C1)", side: null, path: ["Vertebral column", "Cervical vertebrae"] },
  { node: "VH_F_cervical_vertebra_2", id: "axis_c2", term: "Axis (C2)", side: null, path: ["Vertebral column", "Cervical vertebrae"] },
  ...series({
    keys: range(3, 7),
    node: (n) => `VH_F_cervical_vertebra_${n}`,
    id: (n) => `cervical_vertebra_c${n}`,
    term: "Cervical vertebra",
    label: (n) => `C${n}`,
    path: ["Vertebral column", "Cervical vertebrae"],
  }),
  ...series({
    keys: range(1, 12),
    node: (n) => `VH_F_thoracic_vertebra_${n}`,
    id: (n) => `thoracic_vertebra_t${n}`,
    term: "Thoracic vertebra",
    label: (n) => `T${n}`,
    path: ["Vertebral column", "Thoracic vertebrae"],
  }),
  // Six, not five. This subject has a sixth lumbar vertebra — a real variant in
  // roughly one person in twenty, not a fault in the data. It is called out in
  // the interface, because a student who counts six and is not told why learns
  // something elementary wrong.
  ...series({
    keys: range(1, 6),
    node: (n) => `VH_F_lumbar_vertebra_${n}`,
    id: (n) => `lumbar_vertebra_l${n}`,
    term: "Lumbar vertebra",
    label: (n) => `L${n}`,
    path: ["Vertebral column", "Lumbar vertebrae"],
  }),

  // -- digestive: liver -------------------------------------------------------
  { node: "VH_F_capsule_of_the_liver", id: "fibrous_capsule_of_liver", term: "Fibrous capsule of liver", side: null, path: ["Liver"] },
  { node: "VH_F_diaphragmatic_surface_of_liver", id: "diaphragmatic_surface_of_liver", term: "Diaphragmatic surface of liver", side: null, path: ["Liver"] },
  { node: "VH_F_bare_area_of_liver", id: "bare_area_of_liver", term: "Bare area of liver", side: null, path: ["Liver"] },
  { node: "VH_F_porta_hepatis", id: "porta_hepatis", term: "Porta hepatis", side: null, path: ["Liver"] },
  { node: "VH_F_quadrate_lobe", id: "quadrate_lobe_of_liver", term: "Quadrate lobe", side: null, path: ["Liver", "Lobes"] },
  { node: "VH_F_caudate_lobe", id: "caudate_lobe_of_liver", term: "Caudate lobe", side: null, path: ["Liver", "Lobes"] },
  // The impressions neighbouring organs leave on the visceral surface. TA2
  // spells the oesophageal one the British way, which is why a naive match
  // missed it.
  { node: "VH_F_gastric_impression_of_liver", id: "gastric_impression_of_liver", term: "Gastric impression of liver", side: null, path: ["Liver", "Impressions"] },
  { node: "VH_F_duodenal_impression_of_liver", id: "duodenal_impression_of_liver", term: "Duodenal impression of liver", side: null, path: ["Liver", "Impressions"] },
  { node: "VH_F_colic_impression_of_liver", id: "colic_impression_of_liver", term: "Colic impression of liver", side: null, path: ["Liver", "Impressions"] },
  { node: "VH_F_renal_impression_of_liver", id: "renal_impression_of_liver", term: "Renal impression of liver", side: null, path: ["Liver", "Impressions"] },
  { node: "VH_F_suprarenal_impression_of_liver", id: "suprarenal_impression_of_liver", term: "Suprarenal impression of liver", side: null, path: ["Liver", "Impressions"] },
  { node: "VH_F_esophageal_impression_of_liver", id: "oesophageal_impression_of_liver", term: "Oesophageal impression of liver", side: null, path: ["Liver", "Impressions"] },
  { node: "VH_F_falciform_ligament", id: "falciform_ligament", term: "Falciform ligament", side: null, path: ["Liver", "Ligaments"] },
  { node: "VH_F_coronary_ligament_of_liver", id: "coronary_ligament", term: "Coronary ligament", side: null, path: ["Liver", "Ligaments"] },
  // TA2 has a right and a left triangular ligament and no generic term, while
  // the source ships one unlateralised mesh. Its side was read off the
  // geometry rather than guessed: it sits entirely at positive x, and the
  // paired structures in this body put the left side at positive x (left ovary
  // +0.044, right −0.071). Anatomy agrees — the right triangular ligament is
  // often barely a fold.
  { node: "VH_F_triangular_ligament_of_liver", id: "left_triangular_ligament", term: "Left triangular ligament", side: null, path: ["Liver", "Ligaments"] },
  { node: "VH_F_round_ligament_of_liver", id: "round_ligament_of_liver", term: "Round ligament of liver", side: null, path: ["Liver", "Ligaments"] },
  { node: "VH_F_ligamentum_venosum", id: "ligamentum_venosum", term: "Ligamentum venosum", side: null, path: ["Liver", "Ligaments"] },
  { node: "VH_F_hepataduodenal_ligament", id: "hepatoduodenal_ligament", term: "Hepatoduodenal ligament", side: null, path: ["Liver", "Ligaments"] },

  // -- digestive: the biliary tree -------------------------------------------
  { node: "VH_F_right_hepatic_duct", id: "right_hepatic_duct", term: "Right hepatic duct", side: null, path: ["Biliary tract"] },
  { node: "VH_F_left_hepatic_duct", id: "left_hepatic_duct", term: "Left hepatic duct", side: null, path: ["Biliary tract"] },
  { node: "VH_F_common_hepatic_duct", id: "common_hepatic_duct", term: "Common hepatic duct", side: null, path: ["Biliary tract"] },
  { node: "VH_F_cystic_duct", id: "cystic_duct", term: "Cystic duct", side: null, path: ["Biliary tract"] },
  { node: "VH_F_common_bile_duct", id: "bile_duct", term: "Bile duct", side: null, path: ["Biliary tract"] },
  { node: "VH_F_gallbladder", id: "gallbladder", term: "Gallbladder", side: null, path: ["Biliary tract"] },
  { node: "VH_F_hepatopancreatic_ampulla", id: "hepatopancreatic_ampulla", term: "Hepatopancreatic ampulla", side: null, path: ["Biliary tract"] },
  { node: "VH_F_sphincter_of_heptopancreatic_ampulla", id: "sphincter_of_ampulla", term: "Sphincter of ampulla", side: null, path: ["Biliary tract"] },

  // -- digestive: pancreas ----------------------------------------------------
  { node: "VH_F_head_of_pancreas", id: "head_of_pancreas", term: "Head of pancreas", side: null, path: ["Pancreas"] },
  { node: "VH_F_neck_of_pancreas", id: "neck_of_pancreas", term: "Neck of pancreas", side: null, path: ["Pancreas"] },
  { node: "VH_F_body_of_pancreas", id: "body_of_pancreas", term: "Body of pancreas", side: null, path: ["Pancreas"] },
  { node: "VH_F_tail_of_pancreas", id: "tail_of_pancreas", term: "Tail of pancreas", side: null, path: ["Pancreas"] },
  { node: "VH_F_ucinate_process1", id: "uncinate_process_of_pancreas", term: "Uncinate process of pancreas", side: null, path: ["Pancreas"] },
  // The source names these embryologically. In the adult the ventral duct
  // becomes the main pancreatic duct and the proximal dorsal duct the
  // accessory one, which is the correspondence TA2 describes; those are the
  // terms used here, and the source's own names are kept in the report beside
  // them so the mapping can be checked rather than taken on trust.
  { node: "VH_F_ventral_pancreatic_duct", id: "pancreatic_duct", term: "Pancreatic duct", side: null, path: ["Pancreas"] },
  { node: "VH_F_dorsal_pancreatic_duct", id: "accessory_pancreatic_duct", term: "Accessory pancreatic duct", side: null, path: ["Pancreas"] },

  // -- digestive: small intestine --------------------------------------------
  { node: "VH_F_duodenum_superior", id: "superior_part_of_duodenum", term: "Superior part of duodenum", side: null, path: ["Small intestine", "Duodenum"] },
  { node: "VH_F_duodenum_descending", id: "descending_part_of_duodenum", term: "Descending part of duodenum", side: null, path: ["Small intestine", "Duodenum"] },
  { node: "VH_F_duodenum_horizontal", id: "horizontal_part_of_duodenum", term: "Horizontal part of duodenum", side: null, path: ["Small intestine", "Duodenum"] },
  { node: "VH_F_duodenum_ascending", id: "ascending_part_of_duodenum", term: "Ascending part of duodenum", side: null, path: ["Small intestine", "Duodenum"] },
  { node: "VH_F_jejenum", id: "jejunum", term: "Jejunum", side: null, path: ["Small intestine"] },
  { node: "VH_F_ileum", id: "ileum", term: "Ileum", side: null, path: ["Small intestine"] },

  // -- digestive: the rest of the large intestine ----------------------------
  { node: "VH_F_caecum", id: "caecum", term: "Caecum", side: null, path: ["Large intestine"] },
  { node: "VH_F_vermiform_appendix", id: "vermiform_appendix", term: "Vermiform appendix", side: null, path: ["Large intestine"] },
  // TA2 retired "ileocaecal valve": the projecting structure is the ileal
  // papilla and the opening through it is the ileal orifice. The mesh is the
  // projection, so it takes the papilla.
  { node: "VH_F_ileocecal_valve", id: "ileal_papilla", term: "Ileal papilla", side: null, path: ["Large intestine"] },
  { node: "VH_F_ascending_colon", id: "ascending_colon", term: "Ascending colon", side: null, path: ["Large intestine", "Colon"] },
  // The flexures are named by side in TA2, not by the organ they lie against.
  { node: "VH_F_hepatic_flexure_of_colon", id: "right_colic_flexure", term: "Right colic flexure", side: null, path: ["Large intestine", "Colon"] },
  { node: "VH_F_transverse_colon", id: "transverse_colon", term: "Transverse colon", side: null, path: ["Large intestine", "Colon"] },
  { node: "VH_F_splenic_flexure_of_colon", id: "left_colic_flexure", term: "Left colic flexure", side: null, path: ["Large intestine", "Colon"] },
  { node: "VH_F_descending_colon", id: "descending_colon", term: "Descending colon", side: null, path: ["Large intestine", "Colon"] },

  // -- lymphatic: spleen ------------------------------------------------------
  // Filed under lymphatic to match the male atlas, which does the same.
  // TA2 calls the neighbouring contacts impressions where the source calls them
  // surfaces; the diaphragmatic one is a surface in both.
  { node: "VH_F_diaphragmatic_surface_of_spleen", id: "diaphragmatic_surface_of_spleen", term: "Diaphragmatic surface of spleen", side: null, path: ["Spleen"] },
  { node: "VH_F_gastric_surface_of_spleen", id: "gastric_impression_of_spleen", term: "Gastric impression of spleen", side: null, path: ["Spleen"] },
  { node: "VH_F_colic_surface_of_spleen", id: "colic_impression_of_spleen", term: "Colic impression of spleen", side: null, path: ["Spleen"] },
  { node: "VH_F_renal_surface_of_spleen", id: "renal_impression_of_spleen", term: "Renal impression of spleen", side: null, path: ["Spleen"] },
  { node: "VH_F_hilum_of_spleen", id: "hilum_of_spleen", term: "Hilum of spleen", side: null, path: ["Spleen"] },

  // -- renal: the kidneys, in the detail the male atlas has never had ---------
  // The male atlas models each kidney as a single mesh. This one opens: the
  // capsule, the hilum, the cortex, the columns, and every pyramid with its
  // papilla — eleven on the left and ten on the right, which is ordinary
  // variation rather than an omission.
  //
  // The numbering is arbitrary. The source labels them a…k in no anatomical
  // order, and digits merely read better than letters; nothing about pyramid 3
  // places it above pyramid 4.
  ...["left", "right"].flatMap((side) => {
    const tag = side === "left" ? "L" : "R";
    const keys = range(1, side === "left" ? 11 : 10);
    const letter = (n) => "abcdefghijk"[n - 1];
    return [
      { node: `VH_F_kidney_capsule_${tag}`, id: `fibrous_capsule_of_kidney_${tag.toLowerCase()}`, term: "Fibrous capsule of kidney", side, path: ["Kidney"] },
      { node: `VH_F_hilum_of_kidney_${tag}`, id: `hilum_of_kidney_${tag.toLowerCase()}`, term: "Hilum of kidney", side, path: ["Kidney"] },
      { node: `VH_F_outer_cortex_of_kidney_${tag}`, id: `renal_cortex_${tag.toLowerCase()}`, term: "Renal cortex", side, path: ["Kidney"] },
      { node: `VH_F_renal_column_${tag}`, id: `renal_columns_${tag.toLowerCase()}`, term: "Renal columns", side, path: ["Kidney"] },
      ...series({
        keys,
        side,
        node: (n) => `VH_F_renal_pyramid_${tag}_${letter(n)}`,
        id: (n) => `renal_pyramid_${n}_${tag.toLowerCase()}`,
        term: "Renal pyramid",
        label: (n) => String(n),
        path: ["Kidney", "Medulla"],
      }),
      ...series({
        keys,
        side,
        node: (n) => `VH_F_renal_papilla_${tag}_${letter(n)}`,
        id: (n) => `renal_papilla_${n}_${tag.toLowerCase()}`,
        term: "Renal papilla",
        label: (n) => String(n),
        path: ["Kidney", "Medulla"],
      }),
    ];
  }),
];

/**
 * Which system each structure is filed under, and therefore which .glb it lands
 * in. Keyed by organ_id prefix group rather than declared per row, because the
 * grouping is the same information the comment headings above already carry and
 * two copies of it would drift.
 */
export const SYSTEM_OF = new Map(
  STRUCTURES.map((entry) => {
    const top = entry.path[0];
    switch (top) {
      case "Uterus":
      case "Uterine tube":
      case "Ovary":
      case "Vagina":
      case "Ligaments of uterus and ovary":
        return [entry.node, "reproductive"];
      case "Urinary bladder":
      case "Ureter":
        return [entry.node, "renal"];
      case "Pelvic girdle":
      case "Vertebral column":
        return [entry.node, "skeletal"];
      case "Large intestine":
      case "Small intestine":
      case "Liver":
      case "Biliary tract":
      case "Pancreas":
        return [entry.node, "digestive"];
      case "Kidney":
        return [entry.node, "renal"];
      // Where the male atlas files it too.
      case "Spleen":
        return [entry.node, "lymphatic"];
      case "Pelvic vessels":
        return [entry.node, "cardiovascular"];
      default:
        throw new Error(`No system for path root "${top}"`);
    }
  }),
);
