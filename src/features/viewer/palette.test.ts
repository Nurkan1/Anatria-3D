import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { AnatomicalSystem } from "@/lib/schemas";

import {
  SYSTEM_COLOURS,
  SYSTEM_LABELS,
  tissueColour,
  tissueDepthBias,
  tissueFamily,
  tissueHex,
  tissueOpacity,
  tissueRoughness,
} from "./palette";

const vessel = (ta2_latin: string, name_en: string) => ({
  organ_id: ta2_latin.toLowerCase().replace(/\s+/g, "_"),
  ta2_latin,
  name_en,
  system: "cardiovascular" as AnatomicalSystem,
});

const structure = (organ_id: string, system: AnatomicalSystem) => ({
  organ_id,
  ta2_latin: organ_id,
  name_en: organ_id,
  system,
});

describe("tissueHex", () => {
  it("gives each system its own colour", () => {
    const distinct = new Set(Object.values(SYSTEM_COLOURS));
    // Two systems sharing a colour would make the legend a lie.
    expect(distinct.size).toBe(Object.keys(SYSTEM_COLOURS).length);
  });

  it("draws arteries red and veins blue", () => {
    // Telling the two apart is most of what reading a vascular tree *is*.
    const artery = tissueHex(vessel("Arteria carotis communis", "Common carotid artery"));
    const vein = tissueHex(vessel("Vena cava superior", "Superior vena cava"));

    expect(artery).not.toBe(vein);
    expect(artery).not.toBe(SYSTEM_COLOURS.cardiovascular);
    expect(vein).not.toBe(SYSTEM_COLOURS.cardiovascular);
  });

  it("reads the aorta and the great trunks as arterial", () => {
    const aorta = tissueHex(vessel("Aorta ascendens", "Ascending aorta"));
    const trunk = tissueHex(vessel("Truncus pulmonalis", "Pulmonary trunk"));
    const named = tissueHex(vessel("Arteria femoralis", "Femoral artery"));

    expect(aorta).toBe(named);
    expect(trunk).toBe(named);
  });

  it("treats the dural sinuses as venous", () => {
    // They are veins in everything but name; arterial red would put a red
    // stripe across the inside of the skull.
    const sinus = tissueHex(vessel("Sinus sagittalis superior", "Superior sagittal sinus"));
    expect(sinus).toBe(tissueHex(vessel("Vena jugularis interna", "Internal jugular vein")));
  });

  it("resolves a compound name to the vessel it actually is", () => {
    // "Vein accompanying the artery" contains both words. It is a vein.
    const both = tissueHex(vessel("Vena comitans arteriae", "Vein accompanying the artery"));
    expect(both).toBe(tissueHex(vessel("Vena cava inferior", "Inferior vena cava")));
  });

  it("does not classify vessels outside the cardiovascular system", () => {
    // Lymphatic vessels are named like veins and are not veins; the lymphatic
    // colour is the one that carries the information here.
    expect(
      tissueHex({
        organ_id: "vas_lymphaticum",
        ta2_latin: "Vas lymphaticum",
        name_en: "Lymphatic vessel",
        system: "lymphatic",
      }),
    ).toBe(SYSTEM_COLOURS.lymphatic);
  });

  it("falls back to the system colour for a chamber or a valve", () => {
    expect(tissueHex(vessel("Ventriculus sinister", "Left ventricle"))).toBe(
      SYSTEM_COLOURS.cardiovascular,
    );
  });
});

describe("per-structure tissue rules", () => {
  it("draws tendons and fascia as connective tissue, not as muscle", () => {
    // The single biggest departure from reality in a system palette: tendons
    // run through the whole muscular system and are pearly white.
    for (const name of ["Tendo calcaneus", "Fascia lata", "Aponeurosis palmaris"]) {
      const colour = tissueHex({ ...structure(name, "muscular"), ta2_latin: name });
      expect(colour).not.toBe(SYSTEM_COLOURS.muscular);
    }
  });

  it("gives the abdominal viscera colours you could tell apart", () => {
    const organs = ["Hepar", "Splen", "Pancreas", "Vesica biliaris", "Gaster"].map((name) =>
      tissueHex({ ...structure(name, "digestive"), ta2_latin: name }),
    );
    expect(new Set(organs).size).toBe(organs.length);
  });

  it("separates grey matter from white matter", () => {
    const grey = tissueHex({
      ...structure("substantia_grisea", "nervous"),
      ta2_latin: "Substantia grisea",
    });
    const white = tissueHex({
      ...structure("substantia_alba", "nervous"),
      ta2_latin: "Substantia alba",
    });
    expect(grey).not.toBe(white);
  });

  it("does not paint the odontoid process like a tooth", () => {
    // "Dens axis" is the peg of the second cervical vertebra. The tooth rule is
    // scoped to the digestive system precisely so this stays bone.
    expect(
      tissueHex({ ...structure("dens_axis", "skeletal"), ta2_latin: "Dens axis" }),
    ).toBe(SYSTEM_COLOURS.skeletal);
  });

  it("keeps a named vein blue even when its name matches an organ rule", () => {
    // "Vena hepatica" must not be repainted liver-brown; the vessel test runs
    // first for exactly this reason.
    const hepaticVein = tissueHex(vessel("Vena hepatica", "Hepatic vein"));
    expect(hepaticVein).toBe(tissueHex(vessel("Vena cava inferior", "Inferior vena cava")));
  });

  it("keeps the sclera the white of the eye", () => {
    const sclera = tissueHex({ ...structure("sclera", "regional"), ta2_latin: "Sclera" });
    expect(sclera).not.toBe(SYSTEM_COLOURS.regional);
  });
});

describe("tissueColour", () => {
  it("gives two neighbouring structures different shades", () => {
    // 1,110 muscles in one identical red merge into a mass, and the borders —
    // the thing being studied — disappear.
    const first = tissueColour(structure("biceps_brachii", "muscular"));
    const second = tissueColour(structure("brachialis", "muscular"));
    expect(first.getHexString()).not.toBe(second.getHexString());
  });

  it("keeps a structure's shade stable across sessions", () => {
    // Derived from the id, not from load order or a counter: two people
    // comparing screens must be looking at the same colours.
    const once = tissueColour(structure("deltoideus", "muscular")).getHexString();
    const twice = tissueColour(structure("deltoideus", "muscular")).getHexString();
    expect(once).toBe(twice);
  });

  it("keeps the variation small enough to stay recognisable", () => {
    // The point is an edge between neighbours, not a fruit salad. Every muscle
    // must still be visibly the muscle colour.
    const base = new THREE.Color(SYSTEM_COLOURS.muscular);
    for (const id of ["a", "b", "psoas_major", "rectus_femoris", "soleus"]) {
      const shade = tissueColour(structure(id, "muscular"));
      const distance = Math.hypot(
        shade.r - base.r,
        shade.g - base.g,
        shade.b - base.b,
      );
      expect(distance).toBeLessThan(0.12);
    }
  });

  it("leaves a continuous surface unshaded", () => {
    // The skin is one sheet cut into 256 named regions. Shading each one would
    // turn the body into a patchwork quilt.
    for (const id of ["skin_thorax", "skin_forearm", "skin_thigh"]) {
      expect(`#${tissueColour(structure(id, "regional")).getHexString()}`).toBe(
        SYSTEM_COLOURS.regional.toLowerCase(),
      );
    }
  });

  it("caches per structure rather than rebuilding on every material", () => {
    // Five thousand meshes ask for this on every material rebuild.
    const first = tissueColour(structure("os_femoris", "skeletal"));
    const second = tissueColour(structure("os_femoris", "skeletal"));
    expect(first).toBe(second);
  });
});

describe("tissueFamily", () => {
  it("names the colour so a legend can explain it", () => {
    expect(tissueFamily(vessel("Arteria femoralis", "Femoral artery")).label).toBe("Artery");
    expect(tissueFamily(vessel("Vena femoralis", "Femoral vein")).label).toBe("Vein");
  });

  it("gives every family a distinct id, so a legend can group by it", () => {
    const samples = [
      vessel("Arteria femoralis", "Femoral artery"),
      vessel("Vena femoralis", "Femoral vein"),
      { ...structure("hepar", "digestive"), ta2_latin: "Hepar" },
      { ...structure("tendo_calcaneus", "muscular"), ta2_latin: "Tendo calcaneus" },
      structure("os_femoris", "skeletal"),
    ];
    const ids = samples.map((organ) => tissueFamily(organ).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels a system by its tissue, not by its checkbox", () => {
    // "Bone" says what the colour is on the model; "skeletal" only names the
    // control that switched it on.
    expect(tissueFamily(structure("os_femoris", "skeletal")).label).toBe(
      SYSTEM_LABELS.skeletal,
    );
    expect(SYSTEM_LABELS.skeletal).toBe("Bone");
  });

  it("has a label for every system", () => {
    for (const system of Object.keys(SYSTEM_COLOURS) as AnatomicalSystem[]) {
      expect(SYSTEM_LABELS[system]).toBeTruthy();
    }
  });

  it("agrees with the colour actually painted", () => {
    const organ = { ...structure("hepar", "digestive"), ta2_latin: "Hepar" };
    expect(tissueFamily(organ).hex).toBe(tissueHex(organ));
  });
});

describe("the eye", () => {
  const eye = (name: string) => ({
    ...structure(name.toLowerCase(), "nervous"),
    ta2_latin: name,
  });

  it("makes the optical path see-through, which is why an iris is visible", () => {
    // Drawn opaque, as they were, the cornea and the aqueous humour cover the
    // iris completely and an eye becomes a blank white ball.
    expect(tissueOpacity(eye("Cornea"))).toBeLessThan(1);
    expect(tissueOpacity(eye("Camera anterior bulbi oculi"))).toBeLessThan(1);
    expect(tissueOpacity(eye("Lens"))).toBeLessThan(1);
  });

  it("leaves the iris and the sclera solid", () => {
    expect(tissueOpacity(eye("Iris"))).toBe(1);
    expect(tissueOpacity(eye("Sclera"))).toBe(1);
  });

  it("gives the iris a colour of its own", () => {
    const iris = tissueHex(eye("Iris"));
    expect(iris).not.toBe(tissueHex(eye("Sclera")));
    expect(iris).not.toBe(SYSTEM_COLOURS.nervous);
  });

  it("keeps the eye's interior dark, so the pupil reads as a pupil", () => {
    // There is no pupil mesh in the atlas and there should not be: a pupil is
    // an aperture in the iris. It looks black because it opens onto a dark
    // interior, so that is where the darkness has to come from.
    const vitreous = new THREE.Color(tissueHex(eye("Corpus vitreum")));
    const hsl = { h: 0, s: 0, l: 0 };
    vitreous.getHSL(hsl);
    expect(hsl.l).toBeLessThan(0.15);
  });

  it("does not make every nervous structure transparent", () => {
    expect(tissueOpacity(structure("nervus_medianus", "nervous"))).toBe(1);
  });
});

describe("sheets that lie on other tissue", () => {
  const sheet = (name: string, system: AnatomicalSystem = "muscular") => ({
    ...structure(name.toLowerCase().replace(/\s+/g, "_"), system),
    ta2_latin: name,
  });

  it("biases fascia and ligament so they stop fighting for depth", () => {
    // The atlas lays 116 fascial sheets directly on the muscles they wrap.
    // Two coincident opaque surfaces make the depth buffer choose per pixel on
    // floating-point noise, and the musculature comes out mottled.
    expect(tissueDepthBias(sheet("Fascia lata"))).toBeLessThan(0);
    expect(tissueDepthBias(sheet("Ligamentum patellae", "articular"))).toBeLessThan(0);
  });

  it("biases the body surface, which has nothing between it and the muscles", () => {
    // The atlas ships no skin: what covers the body is 256 surface regions
    // lying straight on the superficial muscles. Untouched, the chest and neck
    // came out streaked with pectoralis and platysma.
    expect(tissueDepthBias(sheet("Regio pectoralis", "regional"))).toBeLessThan(0);
  });

  it("orders the layers the way the body does", () => {
    // Muscle, then fascia, then surface. The surface has to win against the
    // fascia as well, so one step out is not enough for it.
    const surface = tissueDepthBias(sheet("Regio pectoralis", "regional"));
    const fascia = tissueDepthBias(sheet("Fascia lata"));
    expect(surface).toBeLessThan(fascia);
  });

  it("leaves everything else alone", () => {
    // A bias applied broadly would trade one class of artefact for another.
    expect(tissueDepthBias(sheet("Musculus biceps brachii"))).toBe(0);
    expect(tissueDepthBias(sheet("Os femoris", "skeletal"))).toBe(0);
    expect(tissueDepthBias(vessel("Aorta ascendens", "Ascending aorta"))).toBe(0);
  });

  it("lets the muscles read through the fascia that wraps them", () => {
    // Solid, the sheets hide almost the whole musculature — which is what a
    // dissection looks like before anyone has started, and not what someone
    // switching the muscular system on is asking to see.
    expect(tissueOpacity(sheet("Fascia brachii"))).toBeLessThan(1);
    expect(tissueOpacity(sheet("Musculus deltoideus"))).toBe(1);
  });
});

describe("tissueRoughness", () => {
  it("makes dry bone matter than a wet muscle belly", () => {
    // Form is read from specular highlights as much as from colour; one
    // roughness for everything makes a body look like painted plastic.
    expect(tissueRoughness("skeletal")).toBeGreaterThan(tissueRoughness("muscular"));
  });

  it("has a value for every system", () => {
    for (const system of Object.keys(SYSTEM_COLOURS) as AnatomicalSystem[]) {
      expect(tissueRoughness(system)).toBeGreaterThan(0);
      expect(tissueRoughness(system)).toBeLessThanOrEqual(1);
    }
  });
});
