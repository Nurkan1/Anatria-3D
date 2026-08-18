import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AnatomyManifestSchema } from "../src/lib/schemas";
import { NERVOUS_PATHS, repairHierarchy } from "../tools/asset-pipeline/hierarchy.mjs";

const REPO = join(__dirname, "..");
const male = AnatomyManifestSchema.parse(
  JSON.parse(readFileSync(join(REPO, "public/anatomy/manifest.json"), "utf8")),
);

const nervous = male.organs.filter((organ) => organ.system === "nervous");
const inGroup = (node: string) => male.organs.filter((organ) => organ.path.includes(node));
const byId = (id: string) => male.organs.find((organ) => organ.organ_id === id);

/**
 * The hierarchy is what "isolate the brain" means.
 *
 * Z-Anatomy's collection nesting filed most of the brain outside `Brain`, and
 * the failure was invisible from the code: every function worked, the manifest
 * validated, and the atlas answered a request for the brain with the right
 * hemisphere and the cerebellum. It was found by a reader looking at a
 * screenshot and noticing that the assistant had named structures it was not
 * showing.
 *
 * These tests are what stop that returning, because nothing else would.
 */
describe("the brain contains the brain", () => {
  it("holds every major subdivision", () => {
    // The one that broke: each of these was a sibling of `Brain` rather than a
    // part of it, so isolating the brain hid all of them.
    for (const [id, where] of [
      ["corpus_callosum", "Telencephalon"],
      ["thalamus_l", "Diencephalon"],
      ["hypothalamus", "Diencephalon"],
      ["midbrain_l", "Mesencephalon"],
      ["pons_l", "Pons"],
      ["medulla_oblongata_l", "Medulla oblongata"],
    ] as const) {
      const organ = byId(id);
      expect(organ, id).toBeDefined();
      expect(organ!.path, id).toContain("Brain");
      expect(organ!.path, id).toContain(where);
    }
  });

  it("holds both hemispheres, not just the right one", () => {
    // The starkest form of the defect: 39 paired structures had the right side
    // inside `Brain` and the left side outside it. A reader isolating the brain
    // was shown one hemisphere and could not tell that the other was missing
    // rather than absent from the atlas.
    for (const base of [
      "precentral_gyrus",
      "postcentral_gyrus",
      "superior_frontal_gyrus",
      "central_sulcus",
      "superior_temporal_sulcus",
    ]) {
      for (const side of ["l", "r"] as const) {
        const organ = byId(`${base}_${side}`);
        expect(organ, `${base}_${side}`).toBeDefined();
        expect(organ!.path, `${base}_${side}`).toContain("Brain");
      }
    }
  });

  it("leaves no nervous structure unplaced", () => {
    // Every structure must be reachable by isolating some group. One with an
    // empty path belongs to nothing and can only ever be found by name.
    const orphans = nervous.filter((organ) => organ.path.length === 0);
    expect(orphans.map((organ) => organ.organ_id)).toEqual([]);

    // And none may sit directly under the root, which is what "loose" looked
    // like before: technically placed, anatomically nowhere.
    const loose = nervous.filter((organ) => organ.path.join(">") === "Central nervous system");
    expect(loose.map((organ) => organ.organ_id)).toEqual([]);
  });

  it("gives both sides of a paired structure the same place", () => {
    const sides = new Map<string, Map<string, string>>();
    for (const organ of nervous) {
      const match = /^(.*)_(l|r)$/.exec(organ.organ_id);
      if (!match) continue;
      const [, base, side] = match;
      if (!sides.has(base!)) sides.set(base!, new Map());
      sides.get(base!)!.set(side!, organ.path.join(" > "));
    }
    const disagreeing = [...sides]
      .filter(([, paths]) => paths.size === 2 && new Set(paths.values()).size > 1)
      .map(([base]) => base);
    expect(disagreeing).toEqual([]);
  });

  it("keeps out what is not brain", () => {
    // The correction has to stop somewhere, and these are the edges of it.
    // Isolating the brain must not drag in the dura that surrounds it — the
    // falx would sit inside the very structure the reader isolated — nor the
    // spinal cord, which is a different organ entirely.
    for (const node of ["Meninges", "Spinal cord"]) {
      for (const organ of inGroup(node)) {
        expect(organ.path, `${organ.organ_id} in ${node}`).not.toContain("Brain");
      }
    }
    expect(inGroup("Meninges").length).toBeGreaterThan(0);
    expect(inGroup("Spinal cord").length).toBeGreaterThan(0);
  });
});

describe("the repair does not reach past the nervous system", () => {
  it("leaves the muscle attachment markers where Z-Anatomy put them", () => {
    // Propagation is scoped for one reason. `Abductor hallucis.l` is the belly
    // and is filed under `Muscles`; `.ol` and `.el` beside it are its origin
    // and insertion markers, filed under nothing on purpose. An unscoped rule
    // pulled 432 structures — including every one of those — into `Muscles`,
    // which would make isolating the muscles hand back a cloud of markers.
    const belly = byId("abductor_hallucis_l");
    const origin = byId("abductor_hallucis_ol");
    expect(belly?.path).toContain("Muscles");
    expect(origin?.path).toEqual([]);
  });

  it("changes no path outside the nervous system", () => {
    const outside = male.organs.filter(
      (organ) => organ.system !== "nervous" && organ.path.includes("Brain"),
    );
    expect(outside).toEqual([]);
  });
});

describe("the correction table", () => {
  it("names a real subdivision for every entry", () => {
    for (const [term, path] of Object.entries(NERVOUS_PATHS)) {
      expect(path.length, term).toBeGreaterThan(0);
      // Everything here is either inside the CNS, out in the periphery, or a
      // sense organ. A path starting anywhere else is a typo.
      expect(
        ["Central nervous system", "Peripheral nervous system", "Sense organs"],
        term,
      ).toContain(path[0]);
    }
  });

  it("refuses an entry that matches nothing", () => {
    // A stale correction is worse than none: it reads as a considered decision
    // about a structure that is no longer there. The build fails on it rather
    // than carrying it.
    expect(() =>
      repairHierarchy([
        {
          organ_id: "x",
          ta2_latin: "Not a structure",
          system: "nervous",
          path: [],
        },
      ]),
    ).toThrow(/matching no structure/);
  });
});
