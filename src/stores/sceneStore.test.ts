import { beforeEach, describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";

import {
  applySceneCommand,
  GHOST_CLICK_THROUGH,
  GHOST_STOPS,
  initialViewState,
  organOpacity,
  regionMembers,
  XRAY_OPACITY,
  regionMembersByNode,
  useSceneStore,
  isOrganVisible,
  organLabel,
  organSubtitle,
  type SceneViewState,
} from "./sceneStore";

const organ = (overrides: Partial<ManifestOrgan> = {}): ManifestOrgan => ({
  organ_id: "left_ventricle",
  ta2_latin: "Ventriculus sinister",
  name_en: "Left ventricle",
  system: "cardiovascular",
  mesh_file: "cardiovascular_male.glb",
  node: "Left ventricle",
  path: ["Heart"],
  ...overrides,
});

/** Apply a sequence of commands, as the engine would emit them. */
const run = (
  ...commands: Parameters<typeof applySceneCommand>[1][]
): SceneViewState => commands.reduce(applySceneCommand, initialViewState);

describe("applySceneCommand", () => {
  it("focuses an organ and selects it", () => {
    const state = run({ action: "focus_organ", organ_id: "heart_apex" });
    expect(state.selectedOrganIds).toEqual(["heart_apex"]);
    expect(state.focusRequest).toEqual({ organId: "heart_apex", seq: 1 });
  });

  it("re-focusing the same organ still moves the camera", () => {
    // The camera reacts to the sequence number, not the id. Without this,
    // asking twice for the same organ after orbiting away would do nothing.
    const state = run(
      { action: "focus_organ", organ_id: "heart_apex" },
      { action: "focus_organ", organ_id: "heart_apex" },
    );
    expect(state.focusRequest).toEqual({ organId: "heart_apex", seq: 2 });
  });

  it("hides and re-shows a system", () => {
    const hidden = run({
      action: "set_layer_visibility",
      system: "cardiovascular",
      visible: false,
    });
    expect(hidden.hiddenSystems).toEqual(["cardiovascular"]);

    const shown = applySceneCommand(hidden, {
      action: "set_layer_visibility",
      system: "cardiovascular",
      visible: true,
    });
    expect(shown.hiddenSystems).toEqual([]);
  });

  it("does not duplicate a system hidden twice", () => {
    const state = run(
      { action: "set_layer_visibility", system: "renal", visible: false },
      { action: "set_layer_visibility", system: "renal", visible: false },
    );
    expect(state.hiddenSystems).toEqual(["renal"]);
  });

  it("replaces the isolation set rather than accumulating", () => {
    const state = run(
      { action: "isolate_structures", organ_ids: ["a", "b"] },
      { action: "isolate_structures", organ_ids: ["c"] },
    );
    expect(state.isolatedOrganIds).toEqual(["c"]);
  });

  it("accumulates pathology overlays across organs and overwrites per organ", () => {
    const state = run(
      {
        action: "apply_pathology_overlay",
        organ_id: "heart_ventricle_left",
        pathology: "Hypertrophy",
        severity: 0.4,
      },
      {
        action: "apply_pathology_overlay",
        organ_id: "aorta_arch",
        pathology: "Aneurysm",
        severity: 0.9,
      },
      {
        action: "apply_pathology_overlay",
        organ_id: "heart_ventricle_left",
        pathology: "Hypertrophy",
        severity: 0.8,
      },
    );
    expect(state.pathologyOverlays).toEqual({
      heart_ventricle_left: { pathology: "Hypertrophy", severity: 0.8 },
      aorta_arch: { pathology: "Aneurysm", severity: 0.9 },
    });
  });

  it("clears every overlay at once", () => {
    const state = run(
      {
        action: "apply_pathology_overlay",
        organ_id: "a",
        pathology: "x",
        severity: 1,
      },
      { action: "clear_pathology_overlays" },
    );
    expect(state.pathologyOverlays).toEqual({});
  });

  it("stores the cross-section plane and position", () => {
    const state = run({ action: "set_cross_section", plane: "axial", position: -0.3 });
    expect(state.crossSection).toEqual({ plane: "axial", position: -0.3 });
  });

  it("reset_view clears visual state but keeps the user's selection", () => {
    const state = run(
      { action: "focus_organ", organ_id: "heart_apex" },
      { action: "set_layer_visibility", system: "renal", visible: false },
      { action: "isolate_structures", organ_ids: ["heart"] },
      { action: "set_cross_section", plane: "sagittal", position: 0.5 },
      { action: "reset_view" },
    );
    expect(state.hiddenSystems).toEqual([]);
    expect(state.isolatedOrganIds).toBeNull();
    expect(state.crossSection).toBeNull();
    // Where the user is in the anatomy is theirs, not part of what the AI is
    // rearranging.
    expect(state.selectedOrganIds).toEqual(["heart_apex"]);
  });

  it("never mutates the state it is given", () => {
    const before = run({
      action: "apply_pathology_overlay",
      organ_id: "a",
      pathology: "x",
      severity: 0.5,
    });
    const snapshot = structuredClone(before);
    applySceneCommand(before, { action: "clear_pathology_overlays" });
    applySceneCommand(before, { action: "isolate_structures", organ_ids: ["z"] });
    expect(before).toEqual(snapshot);
  });

  it("passes through organ ids it does not recognise", () => {
    // Validation belongs to the engine, which checks against the loaded
    // manifest before emitting. Silently dropping here would turn a protocol
    // bug into an unexplained no-op in the viewport.
    const state = run({ action: "focus_organ", organ_id: "not_a_real_organ" });
    expect(state.selectedOrganIds).toEqual(["not_a_real_organ"]);
  });

  it("stores the pathway with the route, pace and loop flag", () => {
    const state = run({
      action: "highlight_pathway",
      label: "Blood through the heart",
      organ_ids: ["right_atrium", "left_atrium", "left_ventricle"],
      step_seconds: 1.5,
      loop: true,
    });
    expect(state.pathway).toEqual({
      label: "Blood through the heart",
      organIds: ["right_atrium", "left_atrium", "left_ventricle"],
      stepSeconds: 1.5,
      loop: true,
      seq: 1,
    });
  });

  it("increments seq when the same route is re-issued so the viewer replays it", () => {
    // Without a counter, re-issuing the same route would look like "still" to
    // the viewer, which would not restart the animation.
    const state = run(
      {
        action: "highlight_pathway",
        label: "Blood through the heart",
        organ_ids: ["right_atrium", "left_ventricle"],
        step_seconds: 2,
        loop: true,
      },
      {
        action: "highlight_pathway",
        label: "Blood through the heart",
        organ_ids: ["right_atrium", "left_ventricle"],
        step_seconds: 2,
        loop: true,
      },
    );
    expect(state.pathway?.seq).toBe(2);
  });

  it("clear_pathway removes the route", () => {
    const state = run(
      {
        action: "highlight_pathway",
        label: "Swallowing",
        organ_ids: ["mouth", "stomach"],
        step_seconds: 1,
        loop: false,
      },
      { action: "clear_pathway" },
    );
    expect(state.pathway).toBeNull();
  });

  it("illuminate_structures lights exactly the list it was given", () => {
    const state = run({
      action: "illuminate_structures",
      organ_ids: ["mouth", "stomach"],
    });
    expect(state.illuminated).toEqual(["mouth", "stomach"]);
  });

  it("a second illumination replaces the first rather than adding to it", () => {
    // An explanation that has moved on to another structure must not leave the
    // previous one still glowing behind it.
    const state = run(
      { action: "illuminate_structures", organ_ids: ["mouth"] },
      { action: "illuminate_structures", organ_ids: ["stomach"] },
    );
    expect(state.illuminated).toEqual(["stomach"]);
  });

  it("an empty illumination is how the light goes out", () => {
    // There is no separate clear command; the light is always exactly the last
    // list given, so nothing is the whole of "stop pointing".
    const state = run(
      { action: "illuminate_structures", organ_ids: ["mouth"] },
      { action: "illuminate_structures", organ_ids: [] },
    );
    expect(state.illuminated).toEqual([]);
  });

  it("reset_view puts the light out too", () => {
    const state = run(
      { action: "illuminate_structures", organ_ids: ["mouth"] },
      { action: "reset_view" },
    );
    expect(state.illuminated).toEqual([]);
  });

  it("reset_view clears the pathway along with other visual state", () => {
    const state = run(
      {
        action: "highlight_pathway",
        label: "Swallowing",
        organ_ids: ["mouth", "stomach"],
        step_seconds: 1,
        loop: false,
      },
      { action: "reset_view" },
    );
    expect(state.pathway).toBeNull();
  });
});

describe("isOrganVisible", () => {
  const heart = organ();

  it("is visible by default", () => {
    expect(isOrganVisible(initialViewState, heart)).toBe(true);
  });

  it("is hidden when its system is off", () => {
    expect(
      isOrganVisible({ hiddenSystems: ["cardiovascular"], isolatedOrganIds: null, hiddenOrganIds: [] }, heart),
    ).toBe(false);
  });

  it("is hidden when isolation excludes it", () => {
    expect(
      isOrganVisible({ hiddenSystems: [], isolatedOrganIds: ["aorta_arch"], hiddenOrganIds: [] }, heart),
    ).toBe(false);
  });

  it("is visible when isolation includes it", () => {
    expect(
      isOrganVisible(
        { hiddenSystems: [], isolatedOrganIds: ["left_ventricle"], hiddenOrganIds: [] },
        heart,
      ),
    ).toBe(true);
  });

  it("stays hidden when isolated but its system is off", () => {
    // The two mechanisms are independent; isolation must not override a system
    // the user switched off.
    expect(
      isOrganVisible(
        { hiddenSystems: ["cardiovascular"], isolatedOrganIds: ["left_ventricle"], hiddenOrganIds: [] },
        heart,
      ),
    ).toBe(false);
  });
});

describe("organLabel", () => {
  it("shows Terminologia Anatomica Latin regardless of locale", () => {
    // The atlas labels structures in the profession's nomenclature; rendering
    // them for a given reader is the assistant's job, not the manifest's.
    const heart = organ();
    expect(organLabel(heart)).toBe("Ventriculus sinister");
    expect(organSubtitle(heart)).toBe("Left ventricle");
  });
});

describe("ghosting", () => {
  const manifest = {
    version: 1,
    gender_model: "male" as const,
    attribution: "",
    license: "",
    systems: [
      { system: "skeletal" as const, organ_count: 1, load_on_start: true },
      { system: "muscular" as const, organ_count: 1, load_on_start: true },
      { system: "nervous" as const, organ_count: 1, load_on_start: true },
    ],
    organs: [organ()],
  };

  beforeEach(() => {
    useSceneStore.setState({
      ...initialViewState,
      organs: {},
      manifest: null,
      hoveredOrganId: null,
    });
  });

  it("steps a layer from solid, through translucent, and back", () => {
    const { cycleSystemOpacity } = useSceneStore.getState();
    // Solid is the absence of an entry, not a stored 1 — so a system added to
    // the manifest later is solid without being registered anywhere.
    expect(useSceneStore.getState().systemOpacity.muscular).toBeUndefined();

    cycleSystemOpacity("muscular");
    const ghosted = useSceneStore.getState().systemOpacity.muscular!;
    expect(ghosted).toBeGreaterThan(0);
    expect(ghosted).toBeLessThan(1);

    cycleSystemOpacity("muscular");
    expect(useSceneStore.getState().systemOpacity.muscular!).toBeLessThan(ghosted);

    cycleSystemOpacity("muscular");
    expect(useSceneStore.getState().systemOpacity.muscular).toBeUndefined();
  });

  it("ghosts every other layer for an x-ray, keeping the chosen one solid", () => {
    useSceneStore.setState({ manifest });
    useSceneStore.getState().xraySystem("nervous");

    const opacity = useSceneStore.getState().systemOpacity;
    expect(opacity.nervous).toBeUndefined();
    expect(opacity.skeletal).toBeLessThan(1);
    expect(opacity.muscular).toBeLessThan(1);
  });

  it("leaves the x-ray on a second press rather than stranding the reader", () => {
    useSceneStore.setState({ manifest });
    useSceneStore.getState().xraySystem("nervous");
    useSceneStore.getState().xraySystem("nervous");

    expect(useSceneStore.getState().systemOpacity).toEqual({});
  });

  it("switches the x-ray to another layer rather than clearing", () => {
    useSceneStore.setState({ manifest });
    useSceneStore.getState().xraySystem("nervous");
    useSceneStore.getState().xraySystem("skeletal");

    const opacity = useSceneStore.getState().systemOpacity;
    expect(opacity.skeletal).toBeUndefined();
    expect(opacity.nervous).toBeLessThan(1);
  });

  it("reads a solid layer as fully opaque without an entry", () => {
    expect(organOpacity({ systemOpacity: {} }, organ())).toBe(1);
    expect(organOpacity({ systemOpacity: { cardiovascular: 0.3 } }, organ())).toBe(0.3);
  });

  it("clears ghosting when the whole view is reset", () => {
    // Ghosting is visual state the AI rearranges, so `reset_view` owns it —
    // otherwise "show me everything again" leaves the body see-through.
    useSceneStore.setState({ systemOpacity: { muscular: 0.2 } });
    useSceneStore.getState().resetView();
    expect(useSceneStore.getState().systemOpacity).toEqual({});
  });

  it("makes layers solid again when everything is shown", () => {
    useSceneStore.setState({ systemOpacity: { muscular: 0.2 }, hiddenSystems: ["renal"] });
    useSceneStore.getState().showAllSystems();

    const state = useSceneStore.getState();
    expect(state.systemOpacity).toEqual({});
    expect(state.hiddenSystems).toEqual([]);
  });

  it("lets the assistant ghost a layer, landing in the same state a click would", () => {
    // One render path: the AI's command writes the state the reader's own
    // controls write, so there is no separate "AI view" to drift.
    const state = run({
      action: "set_layer_opacity",
      system: "integumentary",
      opacity: 0.22,
    });
    expect(state.systemOpacity.integumentary).toBe(0.22);
  });

  it("treats an assistant's opacity of 1 as solid, not as a stored value", () => {
    // Solid is the absence of an entry. A stored 1 would make "is anything
    // ghosted?" answer yes for a scene that is entirely solid, and leave the
    // reset button showing with nothing to reset.
    const state = applySceneCommand(
      { ...initialViewState, systemOpacity: { muscular: 0.2 } },
      { action: "set_layer_opacity", system: "muscular", opacity: 1 },
    );
    expect(state.systemOpacity).toEqual({});
  });

  it("keeps a ghosted structure clickable only while it is still readable", () => {
    // If you can see through it you should be able to click through it.
    expect(GHOST_STOPS[0]).toBeGreaterThanOrEqual(GHOST_CLICK_THROUGH);
    expect(GHOST_STOPS[1]).toBeLessThan(GHOST_CLICK_THROUGH);
    expect(XRAY_OPACITY).toBeLessThan(GHOST_CLICK_THROUGH);
  });
});

describe("restoreView", () => {
  beforeEach(() => {
    useSceneStore.setState({
      ...initialViewState,
      organs: {},
      manifest: null,
      hoveredOrganId: null,
      eyeTracking: true,
    });
  });

  it("brings back the view the reader left", () => {
    useSceneStore.getState().restoreView({
      hiddenSystems: ["muscular"],
      systemOpacity: { skeletal: 0.3 },
      eyeTracking: false,
    });

    const state = useSceneStore.getState();
    expect(state.hiddenSystems).toEqual(["muscular"]);
    expect(state.systemOpacity).toEqual({ skeletal: 0.3 });
    expect(state.eyeTracking).toBe(false);
  });

  it("leaves untouched anything the stored view does not mention", () => {
    // A preferences file from an older build must not blank this build's
    // defaults for settings it never knew about.
    useSceneStore.setState({ hiddenSystems: ["renal"], eyeTracking: false });
    useSceneStore.getState().restoreView({ systemOpacity: { nervous: 0.2 } });

    const state = useSceneStore.getState();
    expect(state.hiddenSystems).toEqual(["renal"]);
    expect(state.eyeTracking).toBe(false);
  });

  it("does not restore the working state of the last session", () => {
    // Opening onto someone's isolation from three days ago looks exactly like
    // an app that has broken. Selection, isolation and overlays are a
    // session's business, not a preference.
    useSceneStore.getState().restoreView({ hiddenSystems: [] });

    const state = useSceneStore.getState();
    expect(state.isolatedOrganIds).toBeNull();
    // The one that had to be taken back out: a body opening already sliced
    // through the neck looks like a broken render, not a restored setting.
    expect(state.crossSection).toBeNull();
    expect(state.selectedOrganIds).toEqual([]);
    expect(state.hiddenOrganIds).toEqual([]);
    expect(state.pathologyOverlays).toEqual({});
    expect(state.pathway).toBeNull();
  });
});

describe("dropFromIsolation", () => {
  beforeEach(() => {
    useSceneStore.setState({ ...initialViewState, organs: {}, manifest: null, hoveredOrganId: null });
  });

  it("removes one member and keeps the rest isolated", () => {
    useSceneStore.setState({ isolatedOrganIds: ["a", "b", "c"] });
    useSceneStore.getState().dropFromIsolation("b");
    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["a", "c"]);
  });

  it("ends the isolation rather than leaving an empty one", () => {
    // An empty study set renders as a blank viewport, which reads as a broken
    // app instead of as "nothing is being studied".
    useSceneStore.setState({ isolatedOrganIds: ["a"] });
    useSceneStore.getState().dropFromIsolation("a");
    expect(useSceneStore.getState().isolatedOrganIds).toBeNull();
  });

  it("ignores a structure that is not in the set", () => {
    useSceneStore.setState({ isolatedOrganIds: ["a"] });
    useSceneStore.getState().dropFromIsolation("z");
    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["a"]);
  });

  it("does nothing when nothing is isolated", () => {
    useSceneStore.getState().dropFromIsolation("a");
    expect(useSceneStore.getState().isolatedOrganIds).toBeNull();
  });
});

describe("studyOrgan", () => {
  beforeEach(() => {
    useSceneStore.setState({ ...initialViewState, organs: {}, manifest: null, hoveredOrganId: null });
  });

  it("isolates a single structure and focuses it", () => {
    useSceneStore.getState().studyOrgan("left_ventricle");
    const state = useSceneStore.getState();
    expect(state.isolatedOrganIds).toEqual(["left_ventricle"]);
    expect(state.selectedOrganIds).toEqual(["left_ventricle"]);
    expect(state.focusRequest?.organId).toBe("left_ventricle");
  });

  it("replaces the set on a plain double-click", () => {
    useSceneStore.getState().studyOrgan("a");
    useSceneStore.getState().studyOrgan("b");
    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["b"]);
  });

  it("extends the set when additive", () => {
    useSceneStore.getState().studyOrgan("a");
    useSceneStore.getState().studyOrgan("b", true);
    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["a", "b"]);
  });

  it("toggles a structure back out of an additive set", () => {
    useSceneStore.getState().studyOrgan("a");
    useSceneStore.getState().studyOrgan("b", true);
    useSceneStore.getState().studyOrgan("b", true);
    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["a"]);
  });

  it("leaves isolation entirely when the last member is removed", () => {
    // An empty study set renders as an empty viewport, which reads as a bug
    // rather than as "nothing is isolated".
    useSceneStore.getState().studyOrgan("a");
    useSceneStore.getState().studyOrgan("a", true);
    expect(useSceneStore.getState().isolatedOrganIds).toBeNull();
  });

  it("re-centres on the newcomer when adding", () => {
    useSceneStore.getState().studyOrgan("a");
    useSceneStore.getState().studyOrgan("b", true);
    expect(useSceneStore.getState().focusRequest?.organId).toBe("b");
  });
});

describe("soloSystem", () => {
  const manifest = {
    version: 1,
    gender_model: "male" as const,
    attribution: "",
    license: "",
    systems: [
      { system: "skeletal" as const, organ_count: 3, load_on_start: true },
      { system: "muscular" as const, organ_count: 2, load_on_start: false },
      { system: "nervous" as const, organ_count: 1, load_on_start: false },
    ],
    organs: [],
  };

  beforeEach(() => {
    useSceneStore.setState({ ...initialViewState, organs: {}, manifest, hoveredOrganId: null });
  });

  it("hides every other system", () => {
    useSceneStore.getState().soloSystem("skeletal");
    expect(useSceneStore.getState().hiddenSystems).toEqual(["muscular", "nervous"]);
  });

  it("restores everything when pressed again on the same system", () => {
    // The same control has to leave the view it entered, or the user is
    // stranded in a filtered scene with nothing obvious to undo it.
    useSceneStore.getState().soloSystem("skeletal");
    useSceneStore.getState().soloSystem("skeletal");
    expect(useSceneStore.getState().hiddenSystems).toEqual([]);
  });

  it("switches solo to a different system", () => {
    useSceneStore.getState().soloSystem("skeletal");
    useSceneStore.getState().soloSystem("muscular");
    expect(useSceneStore.getState().hiddenSystems).toEqual(["nervous", "skeletal"]);
  });

  it("drops structure-level isolation", () => {
    // Both filters at once usually intersect to nothing, and an empty viewport
    // reads as a bug rather than as a filter.
    useSceneStore.getState().studyOrgan("femur");
    useSceneStore.getState().soloSystem("skeletal");
    expect(useSceneStore.getState().isolatedOrganIds).toBeNull();
  });
});

describe("regionMembers", () => {
  const table = (list: ManifestOrgan[]) =>
    Object.fromEntries(list.map((entry) => [entry.organ_id, entry]));

  const heart = organ({ organ_id: "heart", node: "Heart", path: [] });
  const leftVentricle = organ({
    organ_id: "left_ventricle",
    node: "Left ventricle",
    path: ["Heart"],
  });
  const trabeculae = organ({
    organ_id: "trabeculae",
    node: "Trabeculae carnae",
    path: ["Heart", "Left ventricle"],
  });
  const femur = organ({
    organ_id: "femur",
    node: "Femur",
    path: [],
    system: "skeletal",
  });

  const organs = table([heart, leftVentricle, trabeculae, femur]);

  it("gathers everything nested under a structure", () => {
    // Studying the heart has to bring its chambers with it, or the reader gets
    // an opaque shell instead of an organ they can look inside.
    expect(regionMembers(organs, "heart").sort()).toEqual(
      ["heart", "left_ventricle", "trabeculae"].sort(),
    );
  });

  it("gathers a sub-region without its parent's siblings", () => {
    expect(regionMembers(organs, "left_ventricle").sort()).toEqual(
      ["left_ventricle", "trabeculae"].sort(),
    );
  });

  it("returns a leaf structure on its own", () => {
    expect(regionMembers(organs, "femur")).toEqual(["femur"]);
  });

  it("is total for an unknown id", () => {
    // Total rather than throwing: an id the manifest has not heard of should
    // isolate nothing rather than break the viewport.
    expect(regionMembers(organs, "nonexistent")).toEqual(["nonexistent"]);
  });
});

describe("studyRegion", () => {
  beforeEach(() => {
    useSceneStore.setState({
      ...initialViewState,
      organs: {
        heart: organ({ organ_id: "heart", node: "Heart", path: [] }),
        lv: organ({ organ_id: "lv", node: "Left ventricle", path: ["Heart"] }),
        femur: organ({ organ_id: "femur", node: "Femur", path: [], system: "skeletal" }),
      },
      manifest: null,
      hoveredOrganId: null,
    });
  });

  it("isolates the organ with its parts and focuses it", () => {
    useSceneStore.getState().studyRegion("heart");
    const state = useSceneStore.getState();
    expect(state.isolatedOrganIds?.sort()).toEqual(["heart", "lv"]);
    expect(state.focusRequest?.organId).toBe("heart");
  });

  it("does not drag in unrelated structures", () => {
    useSceneStore.getState().studyRegion("heart");
    expect(useSceneStore.getState().isolatedOrganIds).not.toContain("femur");
  });
});

describe("studyGroup", () => {
  beforeEach(() => {
    useSceneStore.setState({
      ...initialViewState,
      organs: {
        ra: organ({ organ_id: "ra", node: "Right atrium", path: ["Heart"] }),
        lv: organ({ organ_id: "lv", node: "Left ventricle", path: ["Heart"] }),
        aorta: organ({
          organ_id: "aorta",
          node: "Ascending aorta",
          path: ["Systemic arteries"],
        }),
      },
      manifest: null,
      hoveredOrganId: null,
    });
  });

  it("isolates every structure inside a named group", () => {
    // The atlas has no mesh called "Heart" — it is a collection. Groups have to
    // be addressable by name or the whole organ can never be isolated.
    useSceneStore.getState().studyGroup("Heart");
    expect(useSceneStore.getState().isolatedOrganIds?.sort()).toEqual(["lv", "ra"]);
  });

  it("leaves other groups alone", () => {
    useSceneStore.getState().studyGroup("Heart");
    expect(useSceneStore.getState().isolatedOrganIds).not.toContain("aorta");
  });

  it("focuses something inside the group", () => {
    useSceneStore.getState().studyGroup("Heart");
    expect(useSceneStore.getState().focusRequest).not.toBeNull();
  });

  it("does nothing for a group with no members", () => {
    const before = useSceneStore.getState().isolatedOrganIds;
    useSceneStore.getState().studyGroup("Nonexistent group");
    expect(useSceneStore.getState().isolatedOrganIds).toBe(before);
  });
});

describe("regionMembersByNode", () => {
  it("finds members of a group that is not itself a structure", () => {
    const organs = {
      ra: organ({ organ_id: "ra", node: "Right atrium", path: ["Heart"] }),
      lv: organ({ organ_id: "lv", node: "Left ventricle", path: ["Heart"] }),
      femur: organ({ organ_id: "femur", node: "Femur", path: [], system: "skeletal" }),
    };
    expect(regionMembersByNode(organs, "Heart").sort()).toEqual(["lv", "ra"]);
  });

  it("includes a structure addressed by its own name", () => {
    const organs = { femur: organ({ organ_id: "femur", node: "Femur", path: [] }) };
    expect(regionMembersByNode(organs, "Femur")).toEqual(["femur"]);
  });
});

describe("multi-selection", () => {
  beforeEach(() => {
    useSceneStore.setState({
      ...initialViewState,
      organs: {
        a: organ({ organ_id: "a", node: "A" }),
        b: organ({ organ_id: "b", node: "B" }),
        c: organ({ organ_id: "c", node: "C" }),
      },
      manifest: null,
      hoveredOrganId: null,
    });
  });

  it("a plain click replaces the selection", () => {
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().selectOrgan("b");
    expect(useSceneStore.getState().selectedOrganIds).toEqual(["b"]);
  });

  it("ctrl-click builds a set in pick order", () => {
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().selectOrgan("b", true);
    useSceneStore.getState().selectOrgan("c", true);
    expect(useSceneStore.getState().selectedOrganIds).toEqual(["a", "b", "c"]);
  });

  it("ctrl-clicking a chosen structure removes it", () => {
    // The gesture that adds has to be the gesture that undoes, or a mis-click
    // means starting the set over.
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().selectOrgan("b", true);
    useSceneStore.getState().selectOrgan("a", true);
    expect(useSceneStore.getState().selectedOrganIds).toEqual(["b"]);
  });

  it("isolates the whole selection", () => {
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().selectOrgan("c", true);
    useSceneStore.getState().isolateSelection();
    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["a", "c"]);
  });

  it("hiding consumes the selection", () => {
    // Leaving structures selected but invisible means the next action silently
    // targets things nobody can see.
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().hideSelection();
    expect(useSceneStore.getState().hiddenOrganIds).toEqual(["a"]);
    expect(useSceneStore.getState().selectedOrganIds).toEqual([]);
  });

  it("accumulates hidden structures across calls", () => {
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().hideSelection();
    useSceneStore.getState().selectOrgan("b");
    useSceneStore.getState().hideSelection();
    expect(useSceneStore.getState().hiddenOrganIds.sort()).toEqual(["a", "b"]);
  });

  it("hides and isolates together", () => {
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().hideSelection();
    useSceneStore.getState().selectOrgan("b");
    useSceneStore.getState().isolateSelection();
    const state = useSceneStore.getState();
    expect(isOrganVisible(state, state.organs.b!)).toBe(true);
    expect(isOrganVisible(state, state.organs.a!)).toBe(false);
  });

  it("restores hidden structures", () => {
    useSceneStore.getState().selectOrgan("a");
    useSceneStore.getState().hideSelection();
    useSceneStore.getState().unhideAll();
    expect(useSceneStore.getState().hiddenOrganIds).toEqual([]);
  });
});
