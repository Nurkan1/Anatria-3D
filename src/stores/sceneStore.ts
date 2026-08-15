import { create } from "zustand";

import type {
  AnatomicalSystem,
  AnatomyManifest,
  ManifestOrgan,
  SceneCommand,
  SectionPlane,
} from "@/lib/schemas";
import type { BackgroundMode } from "@/features/viewer/background";
import type { AnatomicalView } from "@/features/viewer/cameraViews";
import { sameStack } from "@/features/viewer/depthStack";
import { MAX_EXPLODE, nextExplodeStop } from "@/features/viewer/explode";
import { SUPPLY_SYSTEM, type SupplyKind } from "@/features/viewer/supply";
import type { ViewPreferences } from "./viewPreferences";

/**
 * The single source of truth for what the viewport shows.
 *
 * Both the user's clicks and the AI's scene commands write here, and the R3F
 * scene renders from here alone. That is deliberate: one render path means the
 * AI cannot put the viewport into a state the user could not have reached by
 * hand, and there is no second code path to keep in sync.
 *
 * `applySceneCommand` is a pure function so the AI-facing half of that contract
 * is unit-testable without mounting a canvas — see `sceneStore.test.ts`.
 */

export interface PathologyOverlay {
  pathology: string;
  severity: number;
}

export interface CrossSection {
  plane: SectionPlane;
  position: number;
}

/**
 * What the ghost button steps through.
 *
 * `0.28` is the setting that does the work: enough to read the shape and
 * position of the layer, thin enough to see what is under it.
 */
export const GHOST_STOPS = [1, 0.28, 0.12] as const;

/** How faint everything else goes in an X-ray view. */
export const XRAY_OPACITY = 0.16;

/**
 * How faint *everything* goes in the glass body.
 *
 * Fainter than the x-ray's background, because here there is no solid layer to
 * be read against — the whole body is the background, and at 0.16 twenty
 * overlapping structures accumulate back into an opaque mass.
 */
export const GLASS_OPACITY = 0.1;

/**
 * Below this a structure stops receiving clicks.
 *
 * If you can see through it you should be able to click through it — ghosting
 * the skin to reach the muscles under it is useless when the skin keeps
 * catching the ray. A ghosted structure is still selectable from the tree.
 */
export const GHOST_CLICK_THROUGH = 0.5;

/** A focus is an event, not a state — the counter lets the same organ be re-focused. */
export interface FocusRequest {
  organId: string;
  seq: number;
}

/**
 * A move the camera should make, asked for by a button.
 *
 * An event rather than a stored viewpoint, for the same reason a focus is: the
 * camera's real position belongs to the orbit controls and the reader's hand,
 * and mirroring it into the store would mean writing state sixty times a second
 * to describe something React never renders.
 *
 * `orient` deliberately keeps the current distance. Turning to look at a
 * structure from behind should not also throw away the zoom you set to see it —
 * `fit` is the separate verb for reframing.
 */
export type ViewpointRequest =
  | { kind: "fit"; seq: number }
  | { kind: "orient"; view: AnatomicalView; seq: number }
  | { kind: "dolly"; factor: number; seq: number };

/**
 * A physiological route being traced through the model.
 *
 * Note what is *not* here: elapsed time, or a current step. A pathway is an
 * intention — which structures, in what order, at what pace — and the clock
 * that walks it lives in the viewer's render loop. Storing the position here
 * would mean a store write on every frame, which at 60 Hz would re-render the
 * scene graph sixty times a second for an animation that touches one marker.
 *
 * `seq` exists for the same reason `FocusRequest` has one: re-issuing the same
 * route has to restart it, and comparing the route itself cannot tell the
 * difference between "again" and "still".
 */
export interface PathwayRequest {
  /** What the route is, shown over the canvas. */
  label: string;
  organIds: string[];
  /** Seconds spent traversing each segment. */
  stepSeconds: number;
  loop: boolean;
  seq: number;
}

/** The part of the store `applySceneCommand` may touch. */
export interface SceneViewState {
  /**
   * The working selection, in the order it was built.
   *
   * A set rather than a single id because comparing structures is the everyday
   * study move — four muscles of the rotator cuff, the branches of one artery —
   * and a single-selection model forces that into four separate lookups.
   */
  selectedOrganIds: string[];
  /**
   * Structures explicitly hidden, independent of isolation.
   *
   * Isolation answers "show me only this"; hiding answers "get this out of my
   * way" — the dissection move, peeling off what covers the thing being
   * studied. They compose: you can hide a muscle inside an isolated region.
   */
  hiddenOrganIds: string[];
  /**
   * Systems explicitly switched off. Stored as hidden rather than visible so a
   * system added to the manifest later shows up without having to be
   * registered anywhere first.
   */
  hiddenSystems: AnatomicalSystem[];
  /**
   * Per-system translucency, 0–1. A system absent from the map is solid.
   *
   * The third thing you can do to a layer, after showing it and hiding it:
   * leave it there but see through it. Ghosting the skin to read the muscles
   * under it is a different question from hiding the skin — the first keeps the
   * relationship on screen, and that relationship is usually the point.
   */
  systemOpacity: Partial<Record<AnatomicalSystem, number>>;
  /** `null` means nothing is isolated; a list means show only these. */
  isolatedOrganIds: string[] | null;
  pathologyOverlays: Record<string, PathologyOverlay>;
  /**
   * Where the reader marked a complaint on the open virtual patient.
   *
   * Its own slice rather than more `pathologyOverlays`, and the reason is the
   * command right below them: `clear_pathology_overlays` is the assistant's to
   * call whenever a topic moves on, and the patient's presentation is not the
   * assistant's to erase. One is transient teaching, the other is recorded
   * state that outlives the conversation.
   *
   * They share the *look* deliberately — a marked complaint should read as
   * "this structure, affected", which is exactly what the overlay colour says.
   */
  caseMarks: Record<string, PathologyOverlay>;
  crossSection: CrossSection | null;
  focusRequest: FocusRequest | null;
  /** An outstanding camera move; `null` when the reader has not asked for one. */
  viewpoint: ViewpointRequest | null;
  /** `null` means no route is being traced. */
  pathway: PathwayRequest | null;
  /**
   * Structures the assistant has lit while it explains.
   *
   * Separate from the cursor's own light, and it outranks it: sharing one
   * channel would mean the first pointer move wiped out what the assistant was
   * pointing at, and sharing one *appearance* would leave the reader unable to
   * tell which of the two lit things was being talked about.
   */
  illuminated: string[];
  /** An outstanding "add what supplies this" request; `null` when idle. */
  supplyRequest: { kind: SupplyKind; seq: number } | null;
  /**
   * What the last one found.
   *
   * Kept because the honest outcome is sometimes *nothing*, and a button that
   * silently does nothing reads as broken. The count is the difference between
   * "there is nothing there" and "this is not working".
   */
  supplyResult: { kind: SupplyKind; added: number } | null;
  /**
   * How far the parts of the current group are pushed apart, 0 for not at all.
   *
   * Working state, not a preference: it cuts the view the way a cross-section
   * does, so `reset_view` clears it and nothing carries it into the next
   * session. See `explode.ts` for what "the current group" resolves to.
   */
  explode: number;
  /**
   * Whether the body is drained of colour so that what is marked stands out.
   *
   * Working state rather than a preference, like `explode` and the ghosting:
   * it is a way of looking at one thing, and "show me everything again" should
   * put the colour back. See `scan.ts` for what keeps its own.
   */
  scan: boolean;
}

export const initialViewState: SceneViewState = {
  selectedOrganIds: [],
  hiddenOrganIds: [],
  hiddenSystems: [],
  systemOpacity: {},
  isolatedOrganIds: null,
  pathologyOverlays: {},
  caseMarks: {},
  crossSection: null,
  focusRequest: null,
  viewpoint: null,
  pathway: null,
  explode: 0,
  scan: false,
  supplyRequest: null,
  supplyResult: null,
  illuminated: [],
};

/**
 * Reduce one scene command into new view state.
 *
 * Unknown organ ids are *not* filtered here. The engine already rejects them
 * against the loaded manifest before a command is ever emitted, and silently
 * dropping one at this layer would turn a protocol bug into a mystery — the
 * viewport would simply not respond, with nothing logged.
 */
export function applySceneCommand(
  state: SceneViewState,
  command: SceneCommand,
): SceneViewState {
  switch (command.action) {
    case "focus_organ":
      return {
        ...state,
        selectedOrganIds: [command.organ_id],
        focusRequest: {
          organId: command.organ_id,
          seq: (state.focusRequest?.seq ?? 0) + 1,
        },
      };

    case "set_layer_visibility": {
      const hidden = new Set(state.hiddenSystems);
      if (command.visible) hidden.delete(command.system);
      else hidden.add(command.system);
      return { ...state, hiddenSystems: [...hidden].sort() };
    }

    case "set_layer_opacity": {
      const opacity = { ...state.systemOpacity };
      // Solid is the *absence* of an entry, not a stored 1. Keeping a 1 around
      // would make "is anything ghosted?" — which drives the reset button and
      // the x-ray toggle — answer yes for a scene that is entirely solid.
      if (command.opacity >= 1) delete opacity[command.system];
      else opacity[command.system] = command.opacity;
      return { ...state, systemOpacity: opacity };
    }

    case "isolate_structures":
      return { ...state, isolatedOrganIds: [...command.organ_ids] };

    case "isolate_region":
      // Resolved by the store, which holds the manifest; the reducer is pure
      // and has no view of the hierarchy. Falling back to the structure alone
      // keeps this total — a region with no children is just that structure.
      return {
        ...state,
        isolatedOrganIds: [command.organ_id],
        selectedOrganIds: [command.organ_id],
        focusRequest: {
          organId: command.organ_id,
          seq: (state.focusRequest?.seq ?? 0) + 1,
        },
      };

    case "apply_pathology_overlay":
      return {
        ...state,
        pathologyOverlays: {
          ...state.pathologyOverlays,
          [command.organ_id]: {
            pathology: command.pathology,
            severity: command.severity,
          },
        },
      };

    case "clear_pathology_overlays":
      return { ...state, pathologyOverlays: {} };

    case "highlight_pathway":
      return {
        ...state,
        pathway: {
          label: command.label,
          organIds: [...command.organ_ids],
          stepSeconds: command.step_seconds,
          loop: command.loop,
          // Counted from whatever is running, so asking for the same route
          // twice replays it instead of appearing to do nothing.
          seq: (state.pathway?.seq ?? 0) + 1,
        },
      };

    case "clear_pathway":
      return { ...state, pathway: null };

    case "illuminate_structures":
      // Replaced whole, never merged. What is lit is exactly what was last
      // asked for, so an explanation that moves on to another structure does
      // not leave the previous one still glowing behind it.
      return { ...state, illuminated: [...command.organ_ids] };

    case "set_cross_section":
      return {
        ...state,
        crossSection: { plane: command.plane, position: command.position },
      };

    case "reset_view":
      // What the assistant is allowed to undo is *what is shown* — the
      // isolation it made, the section it cut, the overlays and routes it drew.
      // Not *how the reader is looking at it*.
      //
      // Three things therefore survive, and it is the same argument three
      // times: the reader put them there and the assistant did not.
      //
      // - `selectedOrganIds`, because the reader's place in the anatomy is
      //   theirs.
      // - `systemOpacity`, because the glass body is a way of seeing that the
      //   reader turned on, and the assistant calls this tool routinely — once
      //   before drawing a new pathway, say — so wiping it means the body snaps
      //   back to solid in the middle of an explanation the reader was
      //   following through it. The assistant can still undo ghosting it
      //   applied itself, precisely, with `set_layer_opacity`.
      // - `scan`, for which there is not even a tool: nothing the assistant can
      //   call turns it on, so nothing it calls should turn it off.
      //
      // The reader's own *Reset view* button is a different intention and
      // clears all of it — see `resetView` below. This is the one place the two
      // must not share an implementation.
      return {
        ...initialViewState,
        selectedOrganIds: state.selectedOrganIds,
        systemOpacity: state.systemOpacity,
        scan: state.scan,
      };
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SceneStore extends SceneViewState {
  manifest: AnatomyManifest | null;
  organs: Record<string, ManifestOrgan>;
  hoveredOrganId: string | null;
  /**
   * Whether the eyes follow the reader.
   *
   * A preference, not view state — which is why it sits outside
   * `SceneViewState` and survives `reset_view`. Someone who turned it off did
   * so because it distracts them, and "show me everything again" is not a
   * request to be looked at.
   */
  eyeTracking: boolean;
  /**
   * Whether names are drawn in the margins with leader lines.
   *
   * A preference like `eyeTracking`, so it sits outside `SceneViewState` and
   * survives `reset_view`: someone who turned labels on wants them on for the
   * next structure too.
   */
  labelsVisible: boolean;
  /**
   * What the viewport sits on. Dark to work in, light to take figures out of.
   *
   * A preference like the others here, so it survives `reset_view`.
   */
  background: BackgroundMode;
  /**
   * Whether the depth reading is drawn beside the cursor.
   *
   * On by default, because it answers a question no page in a book can and
   * nobody would think to look for it. Off is for small screens, where a list
   * that long sits over the thorax — the panel is most in the way precisely
   * when the viewport is most cramped.
   *
   * A preference like `eyeTracking`: someone who turned it off wants it off
   * for the next structure too, and `reset_view` is not a request to have it
   * back.
   */
  depthProbeVisible: boolean;

  /**
   * Every structure under the cursor, nearest first.
   *
   * Working state of the most transient kind — it is rewritten as the pointer
   * travels — so it lives outside `SceneViewState` and nothing persists it.
   */
  depthStack: string[];
  pinnedStack: string[] | null;

  setManifest: (manifest: AnatomyManifest) => void;
  setHovered: (organId: string | null) => void;
  /** Ignored when the reading has not changed; see `sameStack`. */
  setDepthStack: (organIds: string[]) => void;
  /**
   * The pointer left the body, so there is no reading to show.
   *
   * This *held* the last one for a while, which was the first attempt at
   * making the panel reachable — it is drawn over the model, so travelling to
   * it left the body and emptied the list on the way. Pinning replaced that
   * properly, and holding then became a nuisance: sweeping the pointer across
   * the body left a panel behind that nobody had asked for.
   *
   * A pinned reading is unaffected. That one was asked for.
   */
  clearDepthStack: () => void;
  /** Freeze the current reading against the pointer wandering off it. */
  pinDepthStack: () => void;
  unpinDepthStack: () => void;
  /**
   * Select by clicking the body, which also pins the reading at that point.
   *
   * Its own action rather than a flag on `selectOrgan`: the tree and the search
   * box select too, and pinning a depth reading taken wherever the pointer
   * happened to be resting would be a reading of nothing in particular.
   */
  selectFromViewport: (organId: string | null, additive?: boolean) => void;
  /** The reader closed the panel. Nothing to hold on to. */
  dismissDepthStack: () => void;
  setEyeTracking: (enabled: boolean) => void;
  setDepthProbeVisible: (visible: boolean) => void;
  setLabelsVisible: (visible: boolean) => void;
  toggleScan: () => void;
  setBackground: (mode: BackgroundMode) => void;
  /** Apply the view settings carried over from the last session. */
  restoreView: (preferences: Partial<ViewPreferences>) => void;
  /** Ctrl/Cmd-click toggles into the set; a plain click replaces it. */
  selectOrgan: (organId: string | null, additive?: boolean) => void;
  /** Replace the selection wholesale — reopening a saved session, mostly. */
  selectMany: (organIds: string[]) => void;
  /** Fold a group into the selection, keeping what was already there. */
  addToSelection: (organIds: string[]) => void;
  clearSelection: () => void;
  /**
   * Light up the open patient's complaints, replacing whatever was lit before.
   *
   * A whole-set replacement rather than add/remove, because the marks are a
   * projection of the journal: whenever the presentation changes, this is
   * recomputed from it. Nothing here is the source of truth.
   */
  setCaseMarks: (marks: Record<string, PathologyOverlay>) => void;
  /** Show only the current selection. */
  isolateSelection: () => void;
  /** Take the current selection out of the way, dissection-style. */
  hideSelection: () => void;
  unhideAll: () => void;
  applyCommand: (command: SceneCommand) => void;
  toggleSystem: (system: AnatomicalSystem) => void;
  /** Show only this system. Calling it again on the same one shows all. */
  soloSystem: (system: AnatomicalSystem) => void;
  /** Step a system through solid → ghosted → barely there → solid. */
  cycleSystemOpacity: (system: AnatomicalSystem) => void;
  /** Keep this system solid and ghost every other one. Press again to clear. */
  xraySystem: (system: AnatomicalSystem) => void;
  clearGhosting: () => void;
  /** Turn every system to glass, or back to solid. */
  glassBody: () => void;
  /** Frame what is being studied, or the whole body when nothing is. */
  fitView: () => void;
  /** Turn to a standard anatomical viewpoint, keeping the current distance. */
  orientView: (view: AnatomicalView) => void;
  /** Step closer to, or further from, whatever the camera is looking at. */
  dollyView: (factor: number) => void;
  /** Push the current group's parts apart. 0 puts them back. */
  setExplode: (factor: number) => void;
  /** Step to the next explode stop, wrapping back to nothing. */
  cycleExplode: () => void;
  showAllSystems: () => void;
  /** Stop tracing the current route. */
  clearPathway: () => void;
  clearIsolation: () => void;
  /** Take one structure out of the study set, leaving the rest isolated. */
  dropFromIsolation: (organId: string) => void;
  /**
   * Ask for the vessels — or the nerves — that reach what is being studied.
   *
   * A request rather than an action because the answer depends on geometry the
   * store does not have, and may depend on a mesh file that is not loaded yet:
   * asking for vessels switches the cardiovascular system on, and the meshes
   * arrive afterwards. The viewer resolves it once it can measure them.
   */
  requestSupply: (kind: SupplyKind) => void;
  /** Fold the answer in. Called by the viewer, not by the interface. */
  resolveSupply: (organIds: string[]) => void;
  /** Abandon a request that can never be answered. */
  cancelSupply: () => void;
  /** Isolate a structure and fly to it. `additive` extends the study set. */
  studyOrgan: (organId: string, additive?: boolean) => void;
  /** Isolate a structure together with everything anatomically inside it. */
  studyRegion: (organId: string) => void;
  /** Isolate a named anatomical group — 'Heart', 'Brain', 'Systemic arteries'. */
  studyGroup: (node: string) => void;
  resetView: () => void;
}

export const useSceneStore = create<SceneStore>()((set, get) => ({
  ...initialViewState,
  manifest: null,
  organs: {},
  hoveredOrganId: null,
  depthStack: [],
  pinnedStack: null,
  eyeTracking: true,
  depthProbeVisible: true,
  labelsVisible: false,
  background: "dark",

  setManifest: (manifest) =>
    set({
      manifest,
      organs: Object.fromEntries(manifest.organs.map((organ) => [organ.organ_id, organ])),
      // Systems not marked `load_on_start` begin hidden, and the viewer only
      // mounts — and therefore only fetches — the mesh files of visible
      // systems. Adding the rest of the body is then a data change: the app
      // never downloads a system the user has not opened.
      hiddenSystems: manifest.systems
        .filter((entry) => !entry.load_on_start)
        .map((entry) => entry.system)
        .sort(),
    }),

  setHovered: (organId) => set({ hoveredOrganId: organId }),

  setDepthStack: (organIds) =>
    set((state) =>
      // Compared before writing: the pointer emits far more moves than the
      // reading changes, and each write re-renders the scene graph.
      sameStack(state.depthStack, organIds) ? state : { depthStack: organIds },
    ),

  clearDepthStack: () =>
    set((state) => (state.depthStack.length === 0 ? state : { depthStack: [] })),

  pinDepthStack: () =>
    set((state) =>
      // Nothing under the pointer is nothing worth pinning: a click that
      // landed on a structure the ray never reported would freeze an empty
      // panel open with no way to tell why.
      state.depthStack.length > 0 ? { pinnedStack: state.depthStack } : state,
    ),

  unpinDepthStack: () =>
    set((state) => (state.pinnedStack === null ? state : { pinnedStack: null })),

  dismissDepthStack: () => set({ depthStack: [], pinnedStack: null }),

  selectFromViewport: (organId, additive = false) => {
    get().selectOrgan(organId, additive);
    // Only a click on the body pins. Selecting from the tree or the search box
    // reaches `selectOrgan` directly and leaves the panel live, because there
    // is no reading behind those — the pointer was never over the model.
    if (organId !== null) get().pinDepthStack();
  },

  setEyeTracking: (enabled) => set({ eyeTracking: enabled }),

  setDepthProbeVisible: (visible) => set({ depthProbeVisible: visible }),

  setLabelsVisible: (visible) => set({ labelsVisible: visible }),

  toggleScan: () => set((state) => ({ scan: !state.scan })),

  setBackground: (mode) => set({ background: mode }),

  /**
   * Only the keys that were actually stored are applied, so a preferences file
   * written by an older build leaves the rest at this build's defaults rather
   * than blanking them.
   */
  restoreView: (preferences) =>
    set((state) => ({
      hiddenSystems: preferences.hiddenSystems
        ? [...preferences.hiddenSystems].sort()
        : state.hiddenSystems,
      systemOpacity: preferences.systemOpacity ?? state.systemOpacity,
      eyeTracking: preferences.eyeTracking ?? state.eyeTracking,
      depthProbeVisible: preferences.depthProbeVisible ?? state.depthProbeVisible,
      labelsVisible: preferences.labelsVisible ?? state.labelsVisible,
      background: preferences.background ?? state.background,
    })),

  selectOrgan: (organId, additive = false) =>
    set((state) => {
      if (organId === null) return { selectedOrganIds: [] };
      if (!additive) return { selectedOrganIds: [organId] };
      // Toggling on re-click is what makes a set buildable by hand: the same
      // gesture that adds a structure removes one added by mistake.
      return state.selectedOrganIds.includes(organId)
        ? { selectedOrganIds: state.selectedOrganIds.filter((id) => id !== organId) }
        : { selectedOrganIds: [...state.selectedOrganIds, organId] };
    }),

  selectMany: (organIds) =>
    set((state) => ({
      // Filtered against what is loaded, unlike `applySceneCommand`: these ids
      // come from the journal and may name a system switched off since, or an
      // atlas build that no longer matches. Selecting a structure that cannot
      // be drawn would leave the bar counting invisible members.
      selectedOrganIds: organIds.filter((id) => id in state.organs),
    })),

  addToSelection: (organIds) =>
    set((state) => {
      // Filtered against the atlas for the same reason `selectMany` is, and
      // deduplicated so drawing over the same region twice does not make the
      // selection count climb without anything being added.
      const merged = new Set(state.selectedOrganIds);
      for (const id of organIds) {
        if (id in state.organs) merged.add(id);
      }
      return { selectedOrganIds: [...merged] };
    }),

  clearSelection: () => set({ selectedOrganIds: [], pinnedStack: null }),

  setCaseMarks: (marks) => set({ caseMarks: marks }),

  isolateSelection: () =>
    set((state) =>
      state.selectedOrganIds.length === 0
        ? state
        : { isolatedOrganIds: [...state.selectedOrganIds] },
    ),

  hideSelection: () =>
    set((state) => {
      if (state.selectedOrganIds.length === 0) return state;
      const hidden = new Set([...state.hiddenOrganIds, ...state.selectedOrganIds]);
      return {
        hiddenOrganIds: [...hidden],
        // The selection is consumed: leaving structures selected but invisible
        // means the next action silently targets things nobody can see.
        selectedOrganIds: [],
      };
    }),

  unhideAll: () => set({ hiddenOrganIds: [] }),

  applyCommand: (command) => set((state) => applySceneCommand(state, command)),

  toggleSystem: (system) =>
    set((state) => {
      const hidden = new Set(state.hiddenSystems);
      if (hidden.has(system)) hidden.delete(system);
      else hidden.add(system);
      return { hiddenSystems: [...hidden].sort() };
    }),

  soloSystem: (system) =>
    set((state) => {
      const all = state.manifest?.systems.map((entry) => entry.system) ?? [];
      const alreadySolo =
        !state.hiddenSystems.includes(system) && state.hiddenSystems.length === all.length - 1;

      return {
        // A second press restores everything, so the same control both enters
        // and leaves the view rather than stranding the user in it.
        hiddenSystems: alreadySolo ? [] : all.filter((entry) => entry !== system).sort(),
        // Structure-level isolation would fight a system-level one: the union
        // of both filters usually leaves an empty viewport.
        isolatedOrganIds: null,
      };
    }),

  cycleSystemOpacity: (system) =>
    set((state) => {
      const next = { ...state.systemOpacity };
      const current = next[system] ?? 1;
      // Three stops, not a slider: a slider at this size is fiddly, and the
      // useful settings are "solid", "see the shape through it" and "barely
      // there". `GHOST_STOPS` is what the button cycles.
      const stop = GHOST_STOPS.findIndex((value) => Math.abs(value - current) < 0.01);
      const chosen = GHOST_STOPS[(stop + 1) % GHOST_STOPS.length]!;
      if (chosen >= 1) delete next[system];
      else next[system] = chosen;
      return { systemOpacity: next };
    }),

  xraySystem: (system) =>
    set((state) => {
      const all = state.manifest?.systems.map((entry) => entry.system) ?? [];
      const alreadyXray =
        state.systemOpacity[system] === undefined &&
        all.every((entry) => entry === system || state.systemOpacity[entry] !== undefined);

      // A second press restores everything, so the same control both enters and
      // leaves the view rather than stranding the reader in it.
      if (alreadyXray || all.length === 0) return { systemOpacity: {} };

      const ghosted: Partial<Record<AnatomicalSystem, number>> = {};
      for (const entry of all) {
        if (entry !== system) ghosted[entry] = XRAY_OPACITY;
      }
      return { systemOpacity: ghosted };
    }),

  clearGhosting: () => set({ systemOpacity: {} }),

  /**
   * Turn the whole body to glass, and back.
   *
   * Different from the x-ray, which keeps one system solid to be read against.
   * Here nothing is solid: you sweep the cursor over the abdomen and what lies
   * under that point lights up through it, in depth order. The light is the
   * depth probe — the two are one feature, and this is the half that makes the
   * other half visible.
   *
   * A second press restores everything, so the same control both enters and
   * leaves the view rather than stranding the reader in it.
   */
  glassBody: () =>
    set((state) => {
      const all = state.manifest?.systems.map((entry) => entry.system) ?? [];
      const alreadyGlass =
        all.length > 0 &&
        all.every((entry) => state.systemOpacity[entry] === GLASS_OPACITY);
      if (alreadyGlass) return { systemOpacity: {} };

      const glass: Partial<Record<AnatomicalSystem, number>> = {};
      for (const entry of all) glass[entry] = GLASS_OPACITY;
      return { systemOpacity: glass };
    }),

  setExplode: (factor) =>
    set({
      // Clamped rather than trusted: the slider is bounded but the value also
      // arrives from a keyboard step, and a NaN here would silently send every
      // matrix in the scene to an invalid transform.
      explode: Number.isFinite(factor) ? Math.min(Math.max(factor, 0), MAX_EXPLODE) : 0,
    }),

  cycleExplode: () => set((state) => ({ explode: nextExplodeStop(state.explode) })),

  // The counter is what lets the same button work twice. Comparing the request
  // itself cannot tell "again" from "still" — the same reason a focus carries
  // one.
  fitView: () =>
    set((state) => ({ viewpoint: { kind: "fit", seq: (state.viewpoint?.seq ?? 0) + 1 } })),

  orientView: (view) =>
    set((state) => ({
      viewpoint: { kind: "orient", view, seq: (state.viewpoint?.seq ?? 0) + 1 },
    })),

  dollyView: (factor) =>
    set((state) => ({
      viewpoint: { kind: "dolly", factor, seq: (state.viewpoint?.seq ?? 0) + 1 },
    })),

  clearPathway: () => set({ pathway: null }),

  showAllSystems: () =>
    set({ hiddenSystems: [], isolatedOrganIds: null, hiddenOrganIds: [], systemOpacity: {} }),

  studyRegion: (organId) =>
    set((state) => {
      const members = regionMembers(state.organs, organId);
      return {
        ...applySceneCommand(state, { action: "focus_organ", organ_id: organId }),
        isolatedOrganIds: members,
      };
    }),

  studyGroup: (node) =>
    set((state) => {
      const members = regionMembersByNode(state.organs, node);
      if (members.length === 0) return state;
      return {
        ...applySceneCommand(state, { action: "focus_organ", organ_id: members[0]! }),
        isolatedOrganIds: members,
      };
    }),

  clearIsolation: () =>
    set({
      isolatedOrganIds: null,
      hiddenOrganIds: [],
      supplyRequest: null,
      supplyResult: null,
    }),

  requestSupply: (kind) =>
    set((state) => {
      if (state.isolatedOrganIds === null) return state;
      const system = SUPPLY_SYSTEM[kind];
      return {
        // Switching the system on is part of fulfilling the request, not a
        // guess at what the reader wanted: they asked for vessels, and vessels
        // that are switched off cannot be shown to them. This is the opposite
        // case to hiding something nobody asked to lose.
        hiddenSystems: state.hiddenSystems.filter((entry) => entry !== system),
        supplyRequest: { kind, seq: (state.supplyRequest?.seq ?? 0) + 1 },
        supplyResult: null,
      };
    }),

  resolveSupply: (organIds) =>
    set((state) => {
      const kind = state.supplyRequest?.kind;
      if (!kind || state.isolatedOrganIds === null) {
        return { supplyRequest: null };
      }
      const merged = new Set(state.isolatedOrganIds);
      for (const id of organIds) merged.add(id);
      return {
        isolatedOrganIds: [...merged],
        supplyRequest: null,
        supplyResult: { kind, added: merged.size - state.isolatedOrganIds.length },
      };
    }),

  cancelSupply: () => set({ supplyRequest: null }),

  dropFromIsolation: (organId) =>
    set((state) => {
      if (state.isolatedOrganIds === null) return state;
      const next = state.isolatedOrganIds.filter((id) => id !== organId);
      // Removing the last member must leave *no* isolation rather than an empty
      // one: an empty study set renders as a blank viewport, which reads as a
      // broken app instead of as "nothing is being studied".
      return { isolatedOrganIds: next.length === 0 ? null : next };
    }),

  studyOrgan: (organId, additive = false) =>
    set((state) => {
      const current = state.isolatedOrganIds ?? [];
      // Additive keeps the set and re-centres on the newcomer; a plain
      // double-click replaces it, because the common case is "just this one".
      const next = additive
        ? current.includes(organId)
          ? current.filter((id) => id !== organId)
          : [...current, organId]
        : [organId];

      // Removing the last member would leave an empty study set, which renders
      // as an empty viewport rather than as "no isolation".
      if (next.length === 0) {
        return { ...state, isolatedOrganIds: null };
      }

      return {
        ...applySceneCommand(state, { action: "focus_organ", organ_id: organId }),
        isolatedOrganIds: next,
      };
    }),

  /**
   * The reader's own reset, which really does put everything back.
   *
   * Deliberately more than the assistant's `reset_view`: someone who presses a
   * button labelled *Reset view* is asking for the body they started with,
   * including the ghosting and the scan they themselves switched on. The
   * assistant calls the same command as a housekeeping step between
   * demonstrations, and must not take those with it.
   */
  resetView: () =>
    set((state) => ({
      ...applySceneCommand(state, { action: "reset_view" }),
      systemOpacity: {},
      scan: false,
    })),
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Visibility is the conjunction of the two independent mechanisms. Takes only
 * the two fields it reads so callers can pass a slice of the store rather than
 * having to reconstruct — or cast to — a whole `SceneViewState`.
 */
export function isOrganVisible(
  state: Pick<SceneViewState, "hiddenSystems" | "isolatedOrganIds" | "hiddenOrganIds">,
  organ: ManifestOrgan,
): boolean {
  if (state.hiddenSystems.includes(organ.system)) return false;
  if (state.hiddenOrganIds.includes(organ.organ_id)) return false;
  if (state.isolatedOrganIds !== null && !state.isolatedOrganIds.includes(organ.organ_id)) {
    return false;
  }
  return true;
}

/** How opaque a structure is drawn, from its system's ghosting. */
export function organOpacity(
  state: Pick<SceneViewState, "systemOpacity">,
  organ: ManifestOrgan,
): number {
  return state.systemOpacity[organ.system] ?? 1;
}

/**
 * The label the interface shows for a structure.
 *
 * Terminologia Anatomica Latin, always, in every locale. The atlas speaks the
 * profession's nomenclature; the assistant is what translates and explains it
 * for the reader's language and level. A localised name baked into the manifest
 * would have to serve laypeople and clinicians with the same words.
 */
/**
 * A structure and everything anatomically inside it.
 *
 * Membership is by ancestry: any organ whose path passes through this one is
 * part of its region. Z-Anatomy nests `Heart / Left ventricle / Trabecular part
 * of left ventricle`, so isolating the heart brings its chambers, valves and
 * papillary muscles with it.
 *
 * Matching is on the path's *node names* rather than organ ids, because a
 * collection can nest structures that are not themselves exported as meshes —
 * the group exists in the hierarchy even when nothing renders for it.
 */
export function regionMembers(
  organs: Record<string, ManifestOrgan>,
  organId: string,
): string[] {
  const root = organs[organId];
  if (!root) return [organId];

  const members = new Set<string>([organId, ...regionMembersByNode(organs, root.node)]);
  return [...members];
}

/**
 * Every structure inside a named anatomical group.
 *
 * Groups are addressed by name rather than by id because **most of them are not
 * structures at all**: the atlas has no mesh called "Heart" — it is a
 * collection holding seventeen parts. Isolating "the heart" therefore has to go
 * through the ancestry, not through an organ that does not exist.
 */
export function regionMembersByNode(
  organs: Record<string, ManifestOrgan>,
  node: string,
): string[] {
  const members: string[] = [];
  for (const organ of Object.values(organs)) {
    if (organ.path.includes(node) || organ.node === node) members.push(organ.organ_id);
  }
  return members;
}

/**
 * ` (left)` / ` (right)`, as the asset pipeline writes it into the English name.
 *
 * The Latin does not carry it. Z-Anatomy encodes the side in the mesh node
 * (`Vagus nerve (X).l`) and the pipeline surfaces it in `name_en`; `ta2_latin`
 * stays the bare term, identical for both halves of a pair.
 */
const SIDE = /\s\((left|right)\)$/i;

/** Which side of the body a structure is on. Null for the midline ones. */
export function organSide(organ: Pick<ManifestOrgan, "name_en">): "left" | "right" | null {
  const match = SIDE.exec(organ.name_en);
  return match ? (match[1]!.toLowerCase() as "left" | "right") : null;
}

/**
 * What a structure is called on screen.
 *
 * # Why the side is appended rather than left to the Latin
 *
 * 3,024 of the atlas's 3,478 structures are one half of a bilateral pair, and
 * `ta2_latin` is the same string for both. Showing it alone put two identical
 * chips under an answer, two identical labels on the model, and two
 * indistinguishable rows in the study bar — and filed a note about the left
 * vagus under a name that also described the right one. In anatomy that is not
 * a cosmetic loss: the left recurrent laryngeal hooks under the aortic arch and
 * the right under the subclavian, and "which one" is the question.
 *
 * The side is appended in English rather than declined into Latin on purpose.
 * `Truncus sympathicus sinister` is correct and `Nervus vagus (X) sinister` is
 * correct, but agreement follows the noun's gender — *sinister*, *sinistra*,
 * *sinistrum* — and that cannot be recovered from the string. Mis-declined
 * Latin in an anatomy atlas would be a worse fault than the one being fixed.
 */
export function organLabel(organ: ManifestOrgan): string {
  const side = organSide(organ);
  return side ? `${organ.ta2_latin} · ${side}` : organ.ta2_latin;
}

/** Clinical English, shown as a secondary line under the Latin. */
export function organSubtitle(organ: ManifestOrgan): string {
  return organ.name_en;
}
