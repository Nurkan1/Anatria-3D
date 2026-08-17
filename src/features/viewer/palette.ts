import * as THREE from "three";

import type { AnatomicalSystem } from "@/lib/schemas";

/**
 * Tissue colour.
 *
 * A body rendered in one flat pink is hard to read: with the muscular and
 * skeletal systems both on, nothing tells you which is which until you click.
 * Colouring by tissue is not decoration — it is how every printed atlas has
 * worked for a century, and it makes a crowded scene legible at a glance.
 *
 * The values are muted rather than saturated on purpose. These meshes are lit
 * and shaded, and a pure red bone reads as plastic; anatomical illustration
 * lives in desaturated earth tones for the same reason.
 */
export const SYSTEM_COLOURS: Record<AnatomicalSystem, string> = {
  //: Bone ivory, slightly warm — cortical bone is not white.
  skeletal: "#e2d8c3",
  //: Cartilage and joint capsule: cool, pale, distinct from the bone it joins.
  articular: "#bfcbd1",
  //: Skeletal muscle. The deep red the fixed specimens are known for.
  muscular: "#9e3f45",
  //: Overridden per structure for arteries and veins — see `tissueHex`.
  cardiovascular: "#b0484a",
  //: Nerve trunks are a pale, almost buttery yellow-white.
  nervous: "#ddd08a",
  //: Lymph is famously the "green" system in atlas convention.
  lymphatic: "#8fb583",
  //: Gut wall, tan through to the pink of well-perfused mucosa.
  digestive: "#c08a63",
  //: Lung tissue: pink-grey, lighter than the vessels running through it.
  respiratory: "#d3a0a3",
  //: Renal cortex, dark and brown-red.
  renal: "#9c5344",
  //: Glands, amber — endocrine tissue is unusually vascular and dense.
  endocrine: "#d3a03f",
  reproductive: "#bd8aa4",
  //: Skin.
  integumentary: "#dfb098",
  //: Surface and regional landmarks: deliberately neutral, so they recede
  //: behind the systems rather than competing with them.
  regional: "#b4aea6",
};

/**
 * What the legend calls each system.
 *
 * The tissue, not the taxonomy: "Bone" and "Muscle" say what the colour is on
 * the model, where "skeletal" and "muscular" only name the checkbox that
 * switched it on.
 */
export const SYSTEM_LABELS: Record<AnatomicalSystem, string> = {
  skeletal: "Bone",
  articular: "Joint",
  muscular: "Muscle",
  cardiovascular: "Heart & vessel",
  nervous: "Nerve",
  lymphatic: "Lymphatic",
  digestive: "Digestive tract",
  respiratory: "Airway",
  renal: "Urinary",
  endocrine: "Endocrine gland",
  reproductive: "Reproductive",
  integumentary: "Skin and breast",
  regional: "Surface & regional",
};

/** One entry in the legend: a colour, and what it means. */
export interface TissueFamily {
  id: string;
  label: string;
  hex: string;
}

/** Venous blood is dark; atlases draw it blue, and so does everyone's memory. */
const VEIN_BLUE = "#4a6ea8";
/** Arterial red, brighter than the myocardium so the two separate. */
const ARTERY_RED = "#c0392f";

/**
 * Venous naming in Terminologia Anatomica.
 *
 * `sinus` is here because the dural venous sinuses are veins in everything but
 * name — leaving them arterial red would put a red stripe across the inside of
 * the skull.
 */
const VENOUS = /\b(vena|venae|venous|vein|veins|sinus)\b/i;

/**
 * Arterial naming.
 *
 * `truncus` catches the pulmonary trunk and the brachiocephalic trunk. The
 * pulmonary artery carries deoxygenated blood and some atlases therefore draw
 * it blue; this does not, because "arteries are red" is the rule a reader
 * already holds, and a single exception costs more than it teaches.
 */
const ARTERIAL = /\b(arteria|arteriae|arterial|artery|arteries|aorta|truncus)\b/i;

/**
 * A structure whose own tissue does not look like the rest of its system.
 *
 * The system colour is a good default and a bad universal rule: a tendon is not
 * the colour of the muscle it belongs to, the liver is not the colour of the
 * gut, and grey matter is not the colour of a peripheral nerve. These are the
 * cases where a reader would notice the difference in a cadaver lab or an
 * atlas plate, so the app should show it.
 *
 * Matched in order against `Latin + English`, so an earlier rule wins. `systems`
 * narrows a rule when a word means different things in different places —
 * without it, `dens` would paint the odontoid process of the axis like a molar.
 */
interface TissueRule {
  /** Stable key, so the legend can group by family without comparing strings. */
  readonly id: string;
  /** What the legend calls this colour. Plural where a plural reads naturally. */
  readonly label: string;
  readonly test: RegExp;
  readonly colour: string;
  readonly systems?: readonly AnatomicalSystem[];
}

const RULES: readonly TissueRule[] = [
  // -- connective tissue. The biggest single win: tendons and fascia run
  // through the whole muscular system and are pearly white, not red.
  {
    id: "connective",
    label: "Tendon & fascia",
    test: /\b(tendo|tendon|tendons|tendinis|aponeurosis|fascia|retinaculum|septum intermusculare)\b/i,
    colour: "#ded3bd",
  },
  {
    id: "ligament",
    label: "Ligament",
    test: /\b(ligamentum|ligament|ligaments|ligamenta)\b/i,
    colour: "#d6cbb4",
  },
  {
    id: "cartilage",
    label: "Cartilage & disc",
    test: /\b(cartilago|cartilage|cartilagines|meniscus|discus|labrum)\b/i,
    colour: "#c6d4d9",
  },
  // Adipose tissue is unmistakably yellow, and there is a lot of it.
  {
    id: "fat",
    label: "Fat",
    test: /\b(adiposum|adipose|fat|panniculus|corpus adiposum)\b/i,
    colour: "#e3c869",
  },
  // Teeth only inside the digestive system: "Dens axis" is a vertebra.
  {
    id: "tooth",
    label: "Tooth",
    test: /\b(dens|dentes|tooth|teeth|molaris|incisivus|caninus|enamel|enamelum)\b/i,
    colour: "#f1ead9",
    systems: ["digestive"],
  },

  // -- nervous tissue
  {
    id: "grey-matter",
    label: "Grey matter",
    test: /\b(substantia grisea|grey matter|gray matter|cortex cerebri)\b/i,
    colour: "#a89098",
  },
  {
    id: "white-matter",
    label: "White matter",
    test: /\b(substantia alba|white matter|corpus callosum)\b/i,
    colour: "#ece3d6",
  },
  { id: "dura", label: "Dura mater", test: /\b(dura mater|dural)\b/i, colour: "#bda893" },
  {
    id: "spinal-cord",
    label: "Spinal cord",
    test: /\b(medulla spinalis|spinal cord)\b/i,
    colour: "#e6dcc4",
  },

  // -- viscera, each a colour anyone who has seen one would recognise
  { id: "liver", label: "Liver", test: /\b(hepar|liver|hepatis)\b/i, colour: "#7d4234" },
  {
    id: "biliary",
    label: "Gallbladder & bile",
    test: /\b(vesica biliaris|vesica fellea|gallbladder|bilis|bile)\b/i,
    colour: "#5f7a3f",
  },
  {
    id: "spleen",
    label: "Spleen",
    test: /\b(splen|lien|spleen|splenic)\b/i,
    colour: "#6f3550",
  },
  { id: "pancreas", label: "Pancreas", test: /\b(pancreas|pancreatic)\b/i, colour: "#d8bf8b" },
  { id: "stomach", label: "Stomach", test: /\b(gaster|stomach|gastric)\b/i, colour: "#c98f7a" },
  { id: "lung", label: "Lung", test: /\b(pulmo|lung|lungs|pulmonis)\b/i, colour: "#cf9ba0" },
  {
    id: "kidney",
    label: "Kidney",
    test: /\b(ren|renis|kidney|kidneys|renal cortex)\b/i,
    colour: "#8f4a3a",
  },
  {
    id: "adrenal",
    label: "Adrenal gland",
    test: /\b(glandula suprarenalis|suprarenal|adrenal)\b/i,
    colour: "#d8b24e",
  },
  {
    id: "thyroid",
    label: "Thyroid",
    test: /\b(glandula thyroidea|thyroid|thyroidea)\b/i,
    colour: "#9c5a4a",
  },
  {
    id: "myocardium",
    label: "Myocardium",
    test: /\b(myocardium|myocardial)\b/i,
    colour: "#a63f42",
  },
  {
    id: "lymphoid",
    label: "Lymphoid tissue",
    test: /\b(thymus|tonsilla|tonsil|nodus lymphoideus|lymph node)\b/i,
    colour: "#96bd8a",
  },

  // -- eye. The sclera is the white of the eye and reads wrong in any other
  // colour; the iris is the part a reader looks *at*, and it can only be seen
  // because everything in front of it is transparent — see `tissueOpacity`.
  { id: "sclera", label: "Sclera", test: /\b(sclera|scleral)\b/i, colour: "#f0ece2" },
  { id: "iris", label: "Iris", test: /\biris\b/i, colour: "#3f6fa8" },
  //: The interior of the eye, seen through the pupil.
  //:
  //: There is no pupil mesh in the atlas, and there should not be: a pupil is
  //: an aperture in the iris, not a structure. What makes it read as black is
  //: that it opens onto a dark interior — so the vitreous is dark, and the hole
  //: looks like a pupil for the reason it does in life.
  {
    id: "ocular-interior",
    label: "Vitreous body",
    test: /\b(corpus vitreum|humor vitreus|vitreous)\b/i,
    colour: "#141a24",
  },
  {
    id: "ocular-clear",
    label: "Cornea & lens",
    test: /\b(cornea|corneal|lens|lentis|camera anterior|anterior chamber|segmentum anterius|anterior segment)\b/i,
    colour: "#cfe2ea",
  },

  // -- keratin
  { id: "nail", label: "Nail", test: /\b(unguis|nail|nails)\b/i, colour: "#e8c9bb" },
  { id: "hair", label: "Hair", test: /\b(pilus|pili|hair|capillus)\b/i, colour: "#5b4636" },
];

export interface Tissue {
  organ_id: string;
  ta2_latin: string;
  name_en: string;
  system: AnatomicalSystem;
}

/**
 * The colour family a structure belongs to, as a CSS hex string.
 *
 * Three tiers, narrowest first. The vessel test leads because it is the one
 * that must not be overridden: telling arteries from veins is most of what a
 * student is doing when they look at a vascular tree, and letting a rule like
 * "hepatic" repaint the hepatic vein would undo it. Vein is checked before
 * artery because "vena" and "arteria" both appear in some compound names, and
 * the vein is the one such a structure is.
 */
export function tissueFamily(organ: Tissue): TissueFamily {
  const name = `${organ.ta2_latin} ${organ.name_en}`;

  if (organ.system === "cardiovascular") {
    if (VENOUS.test(name)) return { id: "vein", label: "Vein", hex: VEIN_BLUE };
    if (ARTERIAL.test(name)) return { id: "artery", label: "Artery", hex: ARTERY_RED };
  }

  for (const rule of RULES) {
    if (rule.systems && !rule.systems.includes(organ.system)) continue;
    if (rule.test.test(name)) {
      return { id: rule.id, label: rule.label, hex: rule.colour };
    }
  }

  return {
    id: organ.system,
    label: SYSTEM_LABELS[organ.system],
    hex: SYSTEM_COLOURS[organ.system],
  };
}

export function tissueHex(organ: Tissue): string {
  return tissueFamily(organ).hex;
}

/**
 * Systems whose structures tile one continuous surface rather than sitting side
 * by side as separate objects.
 *
 * The skin is a single sheet cut into 256 named regions. Shading each region
 * differently would turn a body into a patchwork quilt — the exact opposite of
 * what the variation below is for.
 */
const CONTINUOUS: ReadonlySet<AnatomicalSystem> = new Set(["regional", "integumentary"]);

/** FNV-1a. Any stable hash would do; this one is short and has no dependencies. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Signed fraction in [-1, 1) from one slice of a hash. */
function spread(seed: number, shift: number): number {
  return (((seed >>> shift) & 0xff) / 128) - 1;
}

/**
 * The colour one specific structure is drawn in.
 *
 * The system colour alone is not enough at full scale. With 1,110 muscles in
 * exactly the same red, adjacent bellies merge into one mass and the borders —
 * which is the thing being studied — disappear. Giving each structure a small
 * deterministic shift in lightness and hue puts an edge back between
 * neighbours without any of them stopping looking like muscle.
 *
 * Derived from `organ_id`, so a structure keeps its shade across sessions,
 * across reloads, and between two people comparing screens.
 */
const cache = new Map<string, THREE.Color>();

export function tissueColour(organ: Tissue): THREE.Color {
  const cached = cache.get(organ.organ_id);
  if (cached) return cached;

  const colour = new THREE.Color(tissueHex(organ));
  if (!CONTINUOUS.has(organ.system)) {
    const seed = hash(organ.organ_id);
    const hsl = { h: 0, s: 0, l: 0 };
    colour.getHSL(hsl);
    colour.setHSL(
      // Kept tiny. Enough hue drift to separate two touching structures,
      // not enough to make a muscle read as anything but muscle.
      (hsl.h + spread(seed, 0) * 0.014 + 1) % 1,
      Math.min(Math.max(hsl.s + spread(seed, 8) * 0.06, 0), 1),
      // Lightness carries most of the separation: it survives the shading,
      // which hue does not once a surface turns away from the light.
      Math.min(Math.max(hsl.l + spread(seed, 16) * 0.062, 0.04), 0.96),
    );
  }

  cache.set(organ.organ_id, colour);
  return colour;
}

/**
 * How the surface takes light.
 *
 * Form is read from specular highlights as much as from colour, and these
 * tissues do not reflect alike: dry cortical bone is matte, a fresh muscle
 * belly is wet. Giving each its own roughness is what stops a full-body view
 * looking like one plastic material painted several colours.
 */
const ROUGHNESS: Partial<Record<AnatomicalSystem, number>> = {
  skeletal: 0.78,
  articular: 0.5,
  muscular: 0.44,
  cardiovascular: 0.38,
  nervous: 0.6,
  respiratory: 0.52,
  digestive: 0.42,
  integumentary: 0.66,
  regional: 0.7,
};

export function tissueRoughness(system: AnatomicalSystem): number {
  return ROUGHNESS[system] ?? 0.55;
}

/**
 * Tissue that is transparent in life, and therefore on the model.
 *
 * Not a stylistic choice and not the same thing as ghosting a layer. The
 * cornea, the aqueous humour and the lens form the eye's optical path — light
 * goes through them, which is the entire reason a person can see an iris at
 * all. Drawn opaque, as they were, they cover the iris completely and an eye
 * becomes a blank white ball.
 *
 * Multiplied with whatever ghosting the reader has applied, so switching a
 * system to translucent still works on top of it.
 */
const TRANSPARENCY: Record<string, number> = {
  "ocular-clear": 0.18,
  // Dark *and* thin: the pupil is a hole onto this, so it needs depth rather
  // than a flat black disc sitting at the front of the eye.
  "ocular-interior": 0.55,
  /*
   * Deep fascia, and the reason it is not opaque.
   *
   * The atlas models 116 sheets — fascia lata, fascia brachii, the rectus
   * sheath — lying directly on the muscles they wrap. Drawn solid they hide
   * almost the entire musculature behind a cream skin, which is what a
   * dissection looks like *before* anyone has started, and not what someone
   * switching on the muscular system is asking to see.
   *
   * Translucent is also what it is: deep fascia is a thin white sheet you can
   * read muscle fibre direction straight through.
   */
  connective: 0.42,
};

export function tissueOpacity(organ: Tissue): number {
  return TRANSPARENCY[tissueFamily(organ).id] ?? 1;
}

/**
 * Tissue that lies flat against other tissue, and needs help winning the depth
 * test against it.
 *
 * Fascia wraps muscle and ligament wraps bone — not near them, *on* them, with
 * surfaces the exporter placed at effectively the same depth. Two coincident
 * opaque surfaces make the depth buffer choose per pixel on floating-point
 * noise, and the result is the blotchy cream-on-red mottling that made the
 * musculature unreadable.
 *
 * A polygon offset nudges these sheets towards the camera by a fraction of a
 * depth unit. It does not move them in the scene — nothing is measured
 * differently, and no other tissue is affected — it just makes the tie
 * resolve the same way every frame instead of at random.
 *
 * The body surface is the same problem one layer further out, and worse.
 *
 * The atlas has no skin as an organ — what covers the body is 256 named surface
 * regions, tiling one continuous sheet with nothing between them and the
 * superficial muscles. Platysma and pectoralis major sit directly against it, so
 * with every system switched on the surface came out streaked with muscle: not
 * muscle showing *through* anything, just the depth test losing the same tie,
 * pixel by pixel.
 *
 * It gets a step further out than fascia because it has to win against fascia
 * as well — the order on a real body is muscle, then fascia, then surface, and
 * the offsets have to say so.
 */
const DEPTH_BIAS: Readonly<Record<string, number>> = {
  regional: -2,
  // The breast, on the female atlas. It sits in the superficial fascia, so it
  // is one layer out from everything beneath it in exactly the way a region is.
  integumentary: -2,
  connective: -1,
  ligament: -1,
};

export function tissueDepthBias(organ: Tissue): number {
  return DEPTH_BIAS[tissueFamily(organ).id] ?? 0;
}
