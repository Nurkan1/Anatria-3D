import type { Material } from "three";

import type { ManifestOrgan } from "@/lib/schemas";

/**
 * Breathing: the body moving as a body does at rest, and what moves it.
 *
 * Not a chest that swells. In a breath the **diaphragm** contracts and its
 * dome flattens downwards — the top of it travels, the rim where it is fixed
 * to the ribs does not — and the **lungs** follow it, lengthening downwards
 * more than they widen, held at the apex. The **ribs** swing up and forwards on
 * their joints at the spine, so the front of the chest moves most and the back
 * hardly at all. The **abdominal organs** are pushed down ahead of the
 * diaphragm — the liver and the kidneys by a centimetre or two at rest — and
 * the **belly wall** moves out to make room for them. The **heart**, sitting
 * on the diaphragm, goes down with it. Breathing out at rest needs no muscle:
 * all of it springs back.
 *
 * Each structure is told its part by what it is, and the shader moves it by
 * where it is. It is an illustration with the right parts moving the right way
 * and by about the right amount — not a simulation of mechanics, which is
 * what the switch says on its face.
 *
 * # Why it is one shared function and shared uniforms
 *
 * The rule `scanBand.ts` lives by. Every material in the atlas carries
 * `breathOnBeforeCompile`, or a hook that calls `injectBreath`, so they share
 * programs; the breath itself is three shared uniforms written once a frame.
 * With breathing off the fill is 0 and a single uniform test skips all of it.
 */

/** What part a structure plays in a breath. The number is what the shader is told. */
export const BREATH_ROLE = {
  none: 0,
  /** Ribs, sternum, the muscles between and over them, the skin of the chest. */
  chestWall: 1,
  lung: 2,
  diaphragm: 3,
  /** The organs under the diaphragm that it pushes down. */
  viscera: 4,
  /** The front of the abdomen, which moves out to make room. */
  belly: 5,
  heart: 6,
} as const;
export type BreathRole = (typeof BREATH_ROLE)[keyof typeof BREATH_ROLE];

const name = (organ: Pick<ManifestOrgan, "name_en">) => organ.name_en.toLowerCase();
const has = (text: string, fragments: readonly string[]) => fragments.some((f) => text.includes(f));

const CHEST_MUSCLES = [
  "intercostal", "pectoralis", "serratus anterior", "subclavius", "transversus thoracis",
  "levatores costarum", "serratus posterior",
];
const BELLY_MUSCLES = [
  "rectus abdominis", "external oblique", "internal oblique", "transversus abdominis",
  "pyramidalis", "rectus sheath", "linea alba",
];
const CHEST_SKIN = [
  "pectoral region", "presternal", "mammary", "infraclavicular", "lateral region of thorax",
];
const BELLY_SKIN = [
  "epigastric", "umbilic", "hypochondriac", "lateral region of abdomen", "hypogastric",
];
const RIBCAGE = ["rib", "costal", "stern", "xiphoid", "manubri", "costo", "chondro"];
const UNDER_DIAPHRAGM = [
  "liver", "hepat", "stomach", "spleen", "splen", "pancrea", "gallbladder", "duoden",
  "kidney", "suprarenal", "porta hepatis",
];

/**
 * A structure's part in a breath, read off what the atlas calls it.
 *
 * Markings of where a muscle attaches are left still: they sit on bone, and a
 * diaphragm's origin moving with its dome would tear it off the ribs.
 *
 * Whether a vessel is a chamber of the heart is the heartbeat's to say, and
 * the caller asks it: this module importing the heartbeat's would make the two
 * import each other, since the heartbeat's shader breathes too.
 */
export function breathRole(
  organ: Pick<ManifestOrgan, "system" | "name_en" | "path">,
  heartChamber = false,
): BreathRole {
  const text = name(organ);
  const marking = organ.path?.[organ.path.length - 1] === "Muscular insertions";
  switch (organ.system) {
    case "respiratory":
      return has(text, ["lung", "bronch", "pleura"]) ? BREATH_ROLE.lung : BREATH_ROLE.none;
    case "muscular":
      if (marking) return BREATH_ROLE.none;
      if (text === "diaphragm" || text.startsWith("diaphragmatic fascia")) return BREATH_ROLE.diaphragm;
      if (has(text, CHEST_MUSCLES)) return BREATH_ROLE.chestWall;
      if (has(text, BELLY_MUSCLES)) return BREATH_ROLE.belly;
      return BREATH_ROLE.none;
    case "skeletal":
    case "articular":
      return has(text, RIBCAGE) ? BREATH_ROLE.chestWall : BREATH_ROLE.none;
    case "regional":
      if (has(text, CHEST_SKIN)) return BREATH_ROLE.chestWall;
      if (has(text, BELLY_SKIN)) return BREATH_ROLE.belly;
      return BREATH_ROLE.none;
    case "digestive":
    case "renal":
    case "endocrine":
    case "lymphatic":
      return has(text, UNDER_DIAPHRAGM) && !text.includes("node") ? BREATH_ROLE.viscera : BREATH_ROLE.none;
    case "cardiovascular":
      return heartChamber ? BREATH_ROLE.heart : BREATH_ROLE.none;
    default:
      return BREATH_ROLE.none;
  }
}

/** The breaths the reader can choose between. */
export type BreathPatternId = "quiet" | "deep";

export interface BreathPattern {
  label: string;
  /** Breaths a minute, as said on the panel. */
  rate: string;
  /** Seconds for one breath. */
  period: number;
  /** The part of it spent breathing in. */
  inhale: number;
  /** How much bigger than a quiet breath. */
  depth: number;
  /**
   * How far the heart rate swings with this breath, as a fraction of the rate,
   * up and down: respiratory sinus arrhythmia. See `sinusArrhythmia.ts`.
   */
  sinusSwing: number;
  /** What happens, in a sentence a student can keep. */
  what: string;
}

export const BREATH_PATTERNS: Record<BreathPatternId, BreathPattern> = {
  quiet: {
    label: "Quiet breathing",
    rate: "12 / min",
    period: 5,
    inhale: 0.4,
    depth: 1,
    sinusSwing: 0.05,
    what:
      "At rest, about half a litre a breath. Breathing in is the diaphragm's work; breathing out needs no muscle — the lungs and the chest wall spring back.",
  },
  deep: {
    label: "Deep breathing",
    rate: "6 / min",
    period: 10,
    inhale: 0.45,
    depth: 3,
    sinusSwing: 0.11,
    what:
      "The diaphragm descends several times further, and the muscles of the chest wall lift the ribs higher. Out is still mostly recoil.",
  },
};

/**
 * How full the lungs are `seconds` in, 0 empty to 1 full.
 *
 * In faster than out, as at rest, and smooth at both turns: a breath has no
 * corner in it.
 */
export function breathFill(seconds: number, pattern: BreathPattern): number {
  const period = pattern.period;
  const phase = (((seconds % period) + period) % period) / period;
  if (phase < pattern.inhale) return 0.5 - 0.5 * Math.cos((Math.PI * phase) / pattern.inhale);
  return 0.5 + 0.5 * Math.cos((Math.PI * (phase - pattern.inhale)) / (1 - pattern.inhale));
}

/** Whether `seconds` in is breathing in. */
export function breathingIn(seconds: number, pattern: BreathPattern): boolean {
  const phase = (((seconds % pattern.period) + pattern.period) % pattern.period) / pattern.period;
  return phase < pattern.inhale;
}

/**
 * How far each part moves in a quiet breath, in metres.
 *
 * At rest the diaphragm's dome descends one to two centimetres and the liver
 * and kidneys with it; the front of the chest moves a few millimetres. A deep
 * breath is `depth` times these.
 *
 * The lungs have no sideways travel of their own. They lie against the ribs,
 * and when they were given one — four millimetres out, twelve in a deep
 * breath — their bases came out through the rib cage. They now move sideways
 * exactly as the chest wall beside them does, and only lengthen downwards —
 * and only in the middle of their base, over the dome of the diaphragm. Their
 * outer edge slid down the inside of the cage with the rest, and where the
 * cage narrows that took it out through the ribs.
 */
export const BREATH_TRAVEL = {
  diaphragm: 0.015,
  lungDown: 0.011,
  viscera: 0.012,
  chestForward: 0.005,
  chestOut: 0.0035,
  chestUp: 0.003,
  bellyForward: 0.007,
  heart: 0.005,
} as const;

/** How full, times how deep. One write a frame, from the driver. 0 with breathing off. */
export const BREATH_FILL = { value: 0 };
/**
 * The chest, as the breath measures it: x is the midline, y the middle of the
 * sternum, z the axis the ribs swing about — a hand's depth behind the sternum.
 */
export const BREATH_AXIS: { value: number[] } = { value: [0, 1.32, 0.0] };

type Shader = Parameters<Material["onBeforeCompile"]>[0];

const ANCHOR = "#include <project_vertex>";
const m = (value: number) => value.toFixed(4);

/**
 * Add the breath to a vertex shader.
 *
 * After three has projected the vertex, by projecting it again from where the
 * breath puts it — so it composes with whatever else moved the vertex first
 * (the heartbeat squeezes the chambers before projection) and everything
 * downstream that reads `mvPosition` and `gl_Position`, clipping included,
 * follows it. The geometry the pointer is tested against does not move; at a
 * centimetre or two that is under what a pointer can tell.
 *
 * `owner` is the material, as three calls the hook: its `userData` carries the
 * structure's role and, for the lungs and the diaphragm, its height.
 */
export function injectBreath(shader: Shader, owner: unknown): void {
  if (!shader.vertexShader.includes(ANCHOR)) {
    throw new Error("Breathing: the expected three.js vertex chunk is missing.");
  }
  const data = (owner as { userData?: { breathRole?: number; breathSpan?: readonly [number, number] } } | undefined)
    ?.userData;
  const span = data?.breathSpan ?? [0, 1];
  shader.uniforms.uBreathFill = BREATH_FILL;
  shader.uniforms.uBreathAxis = BREATH_AXIS;
  shader.uniforms.uBreathRole = { value: data?.breathRole ?? BREATH_ROLE.none };
  shader.uniforms.uBreathSpan = { value: [span[0], span[1]] };

  shader.vertexShader =
    "uniform float uBreathFill;\nuniform vec3 uBreathAxis;\nuniform float uBreathRole;\nuniform vec2 uBreathSpan;\n" +
    shader.vertexShader.replace(
      ANCHOR,
      `${ANCHOR}
if (uBreathFill > 0.0 && uBreathRole > 0.5) {
  vec4 breathWorld = modelMatrix * vec4(transformed, 1.0);
  vec2 breathFromAxis = vec2(breathWorld.x - uBreathAxis.x, breathWorld.z - uBreathAxis.z);
  vec2 breathOut = breathFromAxis / max(length(breathFromAxis), 1e-4);
  // How far up its own height this vertex is: 0 at the bottom, 1 at the top.
  float breathUp = clamp((breathWorld.y - uBreathSpan.x) / max(uBreathSpan.y - uBreathSpan.x, 1e-4), 0.0, 1.0);
  // The front of the trunk moves; the back, hinged on the spine, hardly does.
  float breathFront = 0.15 + 0.85 * clamp(0.5 + 0.5 * breathOut.y, 0.0, 1.0);
  // The chest wall's own movement at this point: up and out, most at the
  // front, nothing at the arms — a chest is not as wide as the shoulders.
  float breathTall = (breathWorld.y - uBreathAxis.y) / 0.17;
  float breathTrunk = 1.0 - smoothstep(0.17, 0.24, abs(breathFromAxis.x));
  vec3 breathChest = vec3(breathOut.x * ${m(BREATH_TRAVEL.chestOut)}, ${m(BREATH_TRAVEL.chestUp)}, breathOut.y * ${m(BREATH_TRAVEL.chestForward)})
    * exp(-breathTall * breathTall) * breathFront * breathTrunk;
  vec3 breathMove = vec3(0.0);
  if (abs(uBreathRole - ${BREATH_ROLE.chestWall}.0) < 0.5) {
    breathMove = breathChest;
  } else if (abs(uBreathRole - ${BREATH_ROLE.lung}.0) < 0.5) {
    // Carried by the ribs beside it, and lengthened downwards: held at the
    // apex, longest at the base — and only where the base rests on the dome.
    // Its outer edge lies against the ribs, and sliding that down the inside of
    // a cage that narrows took it out through them.
    float base = 1.0 - breathUp;
    float onDome = 1.0 - smoothstep(0.07, 0.12, abs(breathFromAxis.x));
    breathMove = breathChest + vec3(0.0, -${m(BREATH_TRAVEL.lungDown)} * base * base * onDome, 0.0);
  } else if (abs(uBreathRole - ${BREATH_ROLE.diaphragm}.0) < 0.5) {
    // The dome flattens: its top travels, its rim on the ribs stays.
    breathMove = vec3(0.0, -${m(BREATH_TRAVEL.diaphragm)} * breathUp * breathUp, 0.0);
  } else if (abs(uBreathRole - ${BREATH_ROLE.viscera}.0) < 0.5) {
    breathMove = vec3(0.0, -${m(BREATH_TRAVEL.viscera)}, ${m(BREATH_TRAVEL.viscera * 0.15)});
  } else if (abs(uBreathRole - ${BREATH_ROLE.belly}.0) < 0.5) {
    float tall = (breathWorld.y - (uBreathAxis.y - 0.27)) / 0.14;
    breathMove = vec3(breathOut.x * ${m(BREATH_TRAVEL.bellyForward * 0.3)}, 0.0, breathOut.y * ${m(BREATH_TRAVEL.bellyForward)})
      * exp(-tall * tall) * breathFront;
  } else if (abs(uBreathRole - ${BREATH_ROLE.heart}.0) < 0.5) {
    breathMove = vec3(0.0, -${m(BREATH_TRAVEL.heart)}, 0.0);
  }
  breathWorld.xyz += breathMove * uBreathFill;
  mvPosition = viewMatrix * breathWorld;
  gl_Position = projectionMatrix * mvPosition;
}`,
    );
}

/** The atlas's own materials: the breath and nothing else. */
export function breathOnBeforeCompile(this: unknown, shader: Shader): void {
  injectBreath(shader, this);
}

export interface BreathData {
  breathRole: BreathRole;
  breathSpan?: readonly [number, number];
}

const STILL: BreathData = Object.freeze({ breathRole: BREATH_ROLE.none });

/**
 * What a structure's material carries for the breath.
 *
 * The lungs and the diaphragm need their own height — a lung is held at its
 * apex, a dome moves at its top — so they get it from the box the scene has
 * already measured. Everything that does not breathe shares one frozen object.
 */
export function breathData(
  organ: Pick<ManifestOrgan, "system" | "name_en" | "path">,
  worldBox?: { min: { y: number }; max: { y: number } },
  heartChamber = false,
): BreathData {
  const role = breathRole(organ, heartChamber);
  if (role === BREATH_ROLE.none) return STILL;
  const span: readonly [number, number] | undefined =
    worldBox && (role === BREATH_ROLE.lung || role === BREATH_ROLE.diaphragm)
      ? [worldBox.min.y, worldBox.max.y]
      : undefined;
  return Object.freeze(span ? { breathRole: role, breathSpan: span } : { breathRole: role });
}
