/**
 * Terminologia Anatomica 2, and the id slug both manifests are keyed by.
 *
 * Shared by `build-manifest.mjs` (male, Z-Anatomy) and
 * `build-female-manifest.mjs` (female, HRA). The two atlases come from
 * different sources and are built by different scripts, but they must agree on
 * what Latin a term carries and on how a name becomes an id — otherwise the
 * same structure would be spelled one way on one body and another way on the
 * other, which is the sort of difference a reader would read as anatomy.
 */

/**
 * Typographical defects in the vendored `TA2.csv`, and their corrections.
 *
 * These are faults in **the file**, not in Terminologia Anatomica. It arrives
 * with Z-Anatomy and is not ours to edit — editing a vendored standard would
 * make every future update a merge conflict, and would hide the defect from
 * whoever inherits this. So the file stays untouched and the correction is
 * applied on the way in, here, where it is visible and reviewable.
 *
 * Keyed by the English term **as the file spells it**, because that is the join
 * key and it must keep matching. `la` replaces the Latin, `en` the English.
 *
 * The bar for adding a line here is a **typographical** error — a letter
 * transposed or dropped, provable against the file's own neighbouring rows.
 * A term one merely disagrees with does not belong here. All three below were
 * caught by reading a labelled plate, not by a script.
 */
export const TA2_CORRECTIONS = {
  // Row 4211. Two i's where the `li` belongs. Every other coeliac term in the
  // file spells it correctly — `Nodi coeliaci`, `Plexus coeliacus`.
  "coeliac trunk": { la: "Truncus coeliacus" },
  // Row 4252. The neighbouring rows settle it: 4258 is `Arteria mesenterica
  // inferior` and the matching vein is `Vena mesenterica superior`.
  "superior mesenteric artery": { la: "Arteria mesenterica superior" },
  // Row 5119. An L where the I belongs; the Latin on that row is right.
  "lleocolic vein": { en: "Ileocolic vein" },

  // --- A word from the next column left stuck on the end -------------------
  // Each of these ends in a stray word that belongs to the row's synonym or to
  // the term's own head noun. Provable because dropping it leaves the term the
  // file's neighbouring rows already spell the same way.
  "lateral retromalleolar region": { la: "Regio retromalleolaris lateralis" },
  "medial retromalleolar region": { la: "Regio retromalleolaris medialis" },
  "superficial investing cervical fascia": { la: "Fascia investiens superficialis colli" },
  "medial reticulospinal tract": { la: "Tractus reticulospinalis medialis" },
  // Row 2474. A second `caput` wedged into the middle: the genitive of
  // *triceps brachii* is *tricipitis brachii*, and it is already complete.
  "medial head of triceps brachii": { la: "Caput mediale musculi tricipitis brachii" },
  // Row 2486. Rows 2491 and 2683 give the file's own word order for this
  // family — `Flexor profundus digitorum`, `Flexor brevis digitorum` — so the
  // trailing `superficialis` is the duplicate, not the one in the middle.
  "flexor digitorum superficialis": { la: "Flexor superficialis digitorum" },
  "flexor digiti minimi of foot": { la: "Flexor digiti minimi pedis" },

  // --- Main term and synonym concatenated with no separator ----------------
  // The Latin column carries both names run together, so the reader sees one
  // impossible term instead of one real one. The synonym is dropped; this
  // atlas shows a single label per structure.
  "inferior thyroid artery": { la: "Arteria thyreoidea inferior" },
  "transverse cervical artery": { la: "Arteria transversa colli" },
  "middle cardiac vein": { la: "Vena media cordis" },
  "lateral axillary nodes": { la: "Nodi axillares laterales" },
  "posterior axillary nodes": { la: "Nodi axillares posteriores" },
  "anterior axillary nodes": { la: "Nodi axillares anteriores" },
  "infraclavicular nodes": { la: "Nodi infraclaviculares" },
  // Row 4143, and 4147 below it: the main term arrives abbreviated with a
  // fragment of the synonym behind it, and 4147 repeats `sept.` twice.
  "anterior interventricular artery": { la: "Arteria interventricularis anterior" },
  "septal branches of anterior interventricular artery": {
    la: "Rami septales arteriae interventricularis anterioris",
  },

  // --- Letters dropped, doubled or misread ---------------------------------
  "posterior division of internal iliac artery": {
    la: "Divisio posterior arteriae iliacae internae",
  },
  // Row 4420 reads `fontale`. Row 4433 spells the same branch of the middle
  // meningeal artery `Ramus frontalis`, which settles both the missing r and
  // the ending — *ramus* is masculine.
  "frontal branch of superficial temporal artery": {
    la: "Ramus frontalis arteriae temporalis superficialis",
  },
  "frontal branches of callosomarginal artery": {
    la: "Rami frontales arteriae callosomarginalis",
  },
  // Row 4571 reads `paritooccipitale`; row 5437 spells the root correctly in
  // `Sulcus parietooccipitalis`.
  "parieto-occipital artery": { la: "Arteria parietooccipitalis" },
  // `oh` where the `ph` belongs, and `m` where the `rn` belongs — the two
  // classic scan misreads, both provable from the English beside them.
  "musculophrenic artery": { la: "Arteria musculophrenica" },
  "external pudendal veins": { la: "Venae pudendales externae" },
  "portal veins of hypophysis": { la: "Venae portales hypophysiales" },
  // Row 4114. `pulmonalis` is the adjective; the genitive of *pulmo* is
  // *pulmonis*, which is what a vein *of* the right lung needs.
  "medial vein of right lung": { la: "Vena medialis pulmonis dextri" },
  "lateral left branches of hepatic portal vein": {
    la: "Rami sinistri laterales venae portae hepatis",
  },

  // --- Truncated: the Latin lost the word that identified the structure ----
  // Worse than a misspelling, because what is left is a real term for
  // something else. `Arteria pancreaticoduodenalis` without `inferior` names
  // the wrong vessel; `Ramus ascendens arteriae` names no vessel at all.
  "subcutaneous bursa of medial malleolus": { la: "Bursa subcutanea malleoli medialis" },
  "inferior pancreaticoduodenal artery": { la: "Arteria pancreaticoduodenalis inferior" },
  "ascending branch of left colic artery": { la: "Ramus ascendens arteriae colicae sinistrae" },
  "palmar carpal branch of radial artery": { la: "Ramus carpeus palmaris arteriae radialis" },
  "anterior division of retromandibular vein": { la: "Divisio anterior venae retromandibularis" },
  // Rows 4686 and 4692 name the matching arteries `Arteria circumflexa
  // medialis femoris` and `... lateralis femoris`, so `femoris` belongs on the
  // veins too. Without it the term reads as a circumflex vein of nothing.
  "medial circumflex femoral veins": { la: "Venae circumflexae mediales femoris" },
  "lateral circumflex femoral veins": { la: "Venae circumflexae laterales femoris" },
  // Row 6564: without `posterioris` this is the anterior femoral cutaneous
  // nerve, a different nerve on a different surface of the thigh.
  "anterior root of posterior femoral cutaneous nerve": {
    la: "Radix anterior nervi cutanei posterioris femoris",
  },
};

/**
 * Corrections to rows that are **not Terminologia Anatomica at all**.
 *
 * The vendored file appends its own structures after the standard's last term,
 * on ids carrying an asterisk or numbered past 7113. Z-Anatomy needed labels
 * for meshes TA2 does not enumerate — a capsule per joint, a disc per level —
 * and composed them. Several of those compositions are broken.
 *
 * They are kept apart from `TA2_CORRECTIONS` deliberately. There, a correction
 * restores what the standard published and can be checked against it. Here
 * there is nothing to check against, so the correction is **our composition,
 * following the pattern the file's own sound rows use**. Merging the two lists
 * would let that borrow the standard's authority.
 *
 * The bar is the same as above — a defect provable without inventing grammar.
 * Declension errors in this block that would need a Latinist to settle are
 * left alone rather than guessed at; see `ADDED_TERM_OPEN_QUESTIONS`.
 */
export const ADDED_TERM_CORRECTIONS = {
  // Row 7139 carried the **glenohumeral** capsule's Latin on the
  // metatarsophalangeal joints — a copy-paste from row 7138, naming a joint in
  // the wrong limb. The worst defect in the file: a reader checking the label
  // against the mesh would be told the foot is a shoulder.
  "articular capsules of metatarsophalangeal joints": {
    la: "Capsulae articulares articulationum metatarsophalangealium",
  },
  // `articularis` written twice. Dropping the duplicate leaves the adjective
  // agreeing with `capsula`, which is how rows 7142 and 1883 read.
  "articular capsule of superior tibiofibular joint": {
    la: "Capsula articularis tibiofibularis superior",
  },
  "articular capsule of acromioclavicular joint": {
    la: "Capsula articularis acromioclavicularis",
  },
  // `articulariae` and `articulareae` are not Latin words; the nominative
  // plural of *articularis* is *articulares*. `metacarpophalnageae` transposes
  // the `ng`.
  "articular capsules of metacarpophalangeal joints": {
    la: "Capsulae articulares articulationes metacarpophalangeae",
  },
  "articular capsules of proximal interphalangeal joints": {
    la: "Capsulae articulares articulationes interphalangeae proximales",
  },
  "articular capsules of distal interphalangeal joints": {
    la: "Capsulae articulares articulationes interphalangeae distales",
  },
  // The nine costal cartilages repeat `costae`, and four of them take a
  // masculine ordinal against a feminine noun — *costa* is feminine, so the
  // file's own `secundae`, `tertiae`, `sextae` are the correct pattern and
  // `quarti`, `quinti`, `septimi` are not.
  "costal cartilage of first rib": { la: "Cartilago costae primae" },
  "costal cartilage of second rib": { la: "Cartilago costae secundae" },
  "costal cartilage of third rib": { la: "Cartilago costae tertiae" },
  "costal cartilage of fourth rib": { la: "Cartilago costae quartae" },
  "costal cartilage of fifth rib": { la: "Cartilago costae quintae" },
  "costal cartilage of sixth rib": { la: "Cartilago costae sextae" },
  "costal cartilage of seventh rib": { la: "Cartilago costae septimae" },
  "costal cartilage of eighth rib": { la: "Cartilago costae octavae" },
  "costal cartilage of tenth rib": { la: "Cartilago costae decimae" },
  // Rows 7202 and 7203 give `Arteria renum dextra` and `... sinistra`. TA2
  // names this vessel once, at row 4269, as `Arteria renalis` and does not
  // side it — unlike the veins, which it does side at 5000 and 5006. Both
  // atlases carry these two organs, and the side is already on `name_en`.
  "left renal artery": { la: "Arteria renalis" },
  "right renal artery": { la: "Arteria renalis" },
};

/**
 * Defects in the added-terms block left uncorrected, on purpose.
 *
 * Every one is a case ending that looks wrong — `Capsula articularis
 * articulatio radiocarpea` puts the joint in the nominative where the genitive
 * belongs — but choosing the right form is a judgement about Latin grammar,
 * not a typo anyone can prove from the file. A label invented here would read
 * to a student exactly as authoritative as one TA2 published, which is the
 * reason not to invent it. Listed so the next person finds them already found.
 */
export const ADDED_TERM_OPEN_QUESTIONS = {
  "articular capsule of elbow joint": "`articulation cubiti` — a raw fragment where a genitive belongs",
  "articular capsule of radiocarpal joint": "joint named in the nominative, not the genitive",
  "articular capsule of glenohumeral joint": "joint named in the nominative, not the genitive",
  "articular capsules of distal interphalangeal joints of foot":
    "`distali art. interphalangelorum` — abbreviated, and `interphalangelorum` is malformed",
  "articular capsules of proximal interphalangeal joints of foot":
    "`art. interphalangelorum prox.` — abbreviated, and `interphalangelorum` is malformed",
};

/**
 * Terminologia Anatomica's Latin carries no diacritics.
 *
 * The vendored file sits the Latin column next to the French one and has let
 * the accents bleed across: 50 rows spell `laterales` as `latérales`, and one
 * reaches for `â`. This is categorical rather than a judgement about any
 * single word — a Latin anatomical term with an acute accent on it is wrong on
 * its face — so it is fixed by rule instead of by fifty hand-written entries,
 * which also covers the rows nobody has looked at yet.
 *
 * It does not fix a word that is misspelled *underneath* the accent: row 4881
 * reads `portâtes` for *portales*, and needs its own correction above.
 */
function stripLatinDiacritics(latin) {
  return latin.normalize("NFD").replace(/\p{Diacritic}/gu, "").normalize("NFC");
}

/**
 * TA2.csv is not conventional CSV: a UTF-8 BOM, then every row wrapped in one
 * pair of double quotes with `;`-separated fields inside. Splitting on `,` or
 * feeding it to a standard parser yields one giant column.
 */
export function parseTa2(text) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const header = lines[0].replace(/^"|"$/g, "").split(";");
  const column = { en: header.indexOf("English"), la: header.indexOf("Latin") };
  for (const [name, position] of Object.entries(column)) {
    if (position < 0) {
      throw new Error(`TA2.csv is missing the ${name} column. Header: ${header.join(";")}`);
    }
  }

  const corrections = { ...TA2_CORRECTIONS, ...ADDED_TERM_CORRECTIONS };

  const byEnglish = new Map();
  for (const line of lines.slice(1)) {
    const fields = line.replace(/^"|"$/g, "").split(";");
    if (fields.length !== header.length) continue;
    const english = fields[column.en].trim();
    if (!english) continue;
    // First occurrence wins: TA2 repeats some terms across regional sections.
    const key = english.toLowerCase();
    if (!byEnglish.has(key)) {
      const fix = corrections[key];
      byEnglish.set(key, {
        en: fix?.en ?? english,
        // The rule runs first and the hand-written correction overrides it, so
        // an entry above is always the whole final term rather than something
        // the stripper then has to be reasoned about on top of.
        la: fix?.la ?? stripLatinDiacritics(fields[column.la].trim()),
      });
    }
  }

  // A correction that matches nothing is a correction for a row that has been
  // fixed upstream, or one whose key was mistyped here. Either way it is stale
  // and should be removed rather than left to rot.
  for (const key of [...Object.keys(corrections), ...Object.keys(ADDED_TERM_OPEN_QUESTIONS)]) {
    if (!byEnglish.has(key)) {
      throw new Error(
        `A correction is recorded for "${key}", which is not in TA2.csv. ` +
          "If the vendored file was updated, delete the correction.",
      );
    }
  }

  return byEnglish;
}

export function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
