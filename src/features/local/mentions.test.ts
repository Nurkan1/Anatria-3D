import { describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";

import { latinIndex, MAX_MENTIONS, mentionedStructures, normalise } from "./mentions";

function organ(organ_id: string, ta2_latin: string): ManifestOrgan {
  return { organ_id, ta2_latin, name_en: organ_id, system: "cardiovascular" } as ManifestOrgan;
}

const index = latinIndex([
  organ("left_ventricle", "Ventriculus sinister"),
  organ("right_ventricle", "Ventriculus dexter"),
  organ("liver", "Hepar"),
  organ("kidney_l", "Ren"),
  organ("kidney_r", "Ren"),
  organ("aorta", "Aorta"),
]);

describe("which structures an answer names", () => {
  it("finds a Latin name in parentheses, in an answer in Spanish", () => {
    const found = mentionedStructures("El ventrículo izquierdo (Ventriculus sinister) bombea la sangre.", index);
    expect(found.map((m) => m.organIds)).toEqual([["left_ventricle"]]);
  });

  it("takes one-word names only from parentheses, where the model was asked to put them", () => {
    expect(mentionedStructures("El hígado (Hepar) filtra.", index).map((m) => m.latin)).toEqual(["Hepar"]);
    // "aorta" is also an ordinary word in Spanish prose; outside parentheses it is not a button.
    expect(mentionedStructures("La aorta sale del ventrículo.", index)).toEqual([]);
  });

  it("finds a Latin name of two words anywhere, but only on word boundaries", () => {
    expect(mentionedStructures("Compare ventriculus dexter with the left.", index)).toHaveLength(1);
    expect(mentionedStructures("xventriculus dextery", index)).toEqual([]);
  });

  it("offers one button for a name the atlas gives to both sides", () => {
    const [kidneys] = mentionedStructures("Los riñones (Ren) filtran.", index);
    expect(kidneys?.organIds).toEqual(["kidney_l", "kidney_r"]);
  });

  it("offers nothing for an invented or misspelt name — it cannot point at the wrong thing", () => {
    expect(mentionedStructures("(Ventriculus sinistrus) (Cor magnum)", index)).toEqual([]);
  });

  it("reads several names in one pair of parentheses, in the order they appear", () => {
    const found = mentionedStructures("Ambos (Ventriculus dexter, Ventriculus sinister).", index);
    expect(found.map((m) => m.latin)).toEqual(["Ventriculus dexter", "Ventriculus sinister"]);
  });

  it("ignores case and accents", () => {
    expect(normalise("  VENTRÍCULUS   Sinister ")).toBe("ventriculus sinister");
    expect(mentionedStructures("(VENTRICULUS SINISTER)", index)).toHaveLength(1);
  });

  it("never offers more than a handful", () => {
    const many = latinIndex(Array.from({ length: 20 }, (_, i) => organ(`o${i}`, `Structura numero${i}`)));
    const answer = Array.from({ length: 20 }, (_, i) => `(Structura numero${i})`).join(" ");
    expect(mentionedStructures(answer, many)).toHaveLength(MAX_MENTIONS);
  });
});
