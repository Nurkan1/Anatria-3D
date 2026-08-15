import { useMemo, useState } from "react";

import type { AnatomicalSystem, ManifestOrgan, SectionPlane } from "@/lib/schemas";

import { busiestTouches, coverageLegend } from "@/features/viewer/coverage";
import { exportViewImage } from "@/features/viewer/exportView";
import { explodeScope, MAX_EXPLODE } from "@/features/viewer/explode";
import { SYSTEM_COLOURS, SYSTEM_LABELS } from "@/features/viewer/palette";

import { StructureSearch } from "./StructureSearch";
import {
  GLASS_OPACITY,
  isOrganVisible,
  organLabel,
  organSubtitle,
  useSceneStore,
} from "@/stores/sceneStore";
import { useStudyStore } from "@/stores/studyStore";

const PLANES: SectionPlane[] = ["axial", "coronal", "sagittal"];

/**
 * Whether a system's structures are listed.
 *
 * **Everything starts closed, and nothing is remembered.** There used to be a
 * size threshold: systems under sixty structures opened on mount, which meant
 * five of them did, and every launch began by pressing "Collapse all". A
 * default that has to be undone on every start is not a default.
 *
 * Closed also removes the reason the threshold existed. The nervous system
 * alone carries over five hundred rows, and rendering them as buttons on mount
 * cost a visible freeze; with nothing open there is nothing to render until
 * somebody asks for it.
 *
 * A function rather than the expression written twice: the global toggle reads
 * the same state to decide whether it says "expand" or "collapse", and a
 * default that disagreed between the two would make the button lie about what
 * it is about to do.
 */
export function systemIsOpen(
  expanded: Record<string, boolean>,
  system: string,
): boolean {
  return expanded[system] === true;
}

/**
 * Take the current view out of the app as an image.
 *
 * Its own component so the whole tree does not re-render while an export is in
 * flight, and so the outcome — the path it landed on, or why it did not — has
 * somewhere to be said.
 */
function SaveImageButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="pt-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setResult(null);
          exportViewImage()
            .then((path) => setResult(path ? `Saved to ${path}` : null))
            .catch((error: unknown) =>
              setResult(error instanceof Error ? error.message : String(error)),
            )
            .finally(() => setBusy(false));
        }}
        title="Save the viewport, with its labels and its attribution, as a PNG"
        className="w-full rounded border border-slate-700 py-1 text-[11px] text-slate-300 transition hover:border-sky-600 hover:text-sky-200 disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save this view as an image"}
      </button>
      {result && (
        <button
          type="button"
          onClick={() => setResult(null)}
          className="mt-1 block w-full truncate text-left text-[10px] text-slate-500 hover:text-slate-300"
          title={result}
        >
          {result}
        </button>
      )}
    </div>
  );
}

/**
 * Your own revision, painted onto the body.
 *
 * An atlas knows anatomy; a notebook knows what you wrote. Only something
 * holding both can answer the question a student actually has in the week
 * before finals — *where have I not been?* — and it is not answerable from a
 * list of notes. It is obvious the instant it is a shape on a body.
 *
 * The legend is not decoration. A coloured body with no key is a mood, and the
 * top of the scale is whatever this journal's busiest structure happens to be,
 * which the reader has to be told.
 */
function CoverageToggle() {
  const visible = useStudyStore((s) => s.coverageVisible);
  const setVisible = useStudyStore((s) => s.setCoverageVisible);
  const coverage = useStudyStore((s) => s.coverage);

  const busiest = busiestTouches(coverage);
  const studied = Object.keys(coverage).length;

  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => void setVisible(event.target.checked)}
          className="accent-teal-400"
        />
        <span>Show what I have studied</span>
      </label>

      {!visible && (
        <p className="text-[10px] leading-snug text-slate-600">
          Colours the body by your own notes and sessions, so the parts you have not
          worked on are the ones that stay grey.
        </p>
      )}

      {visible && busiest === 0 && (
        <p className="text-[10px] leading-snug text-slate-600">
          Nothing filed against a structure yet. Write a note or ask about something
          with it selected, and it will start to show here.
        </p>
      )}

      {visible && busiest > 0 && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-2">
            {coverageLegend(busiest).map(({ label, hex }) => (
              <span key={label} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full ring-1 ring-inset ring-black/30"
                  style={{ backgroundColor: hex }}
                />
                <span className="text-[9px] text-slate-500">{label}</span>
              </span>
            ))}
          </div>
          <p className="text-[10px] leading-snug text-slate-600">
            {studied} structure{studied === 1 ? "" : "s"} touched. The scale is
            relative to your own journal, not to the atlas — the brightest is
            whatever you have worked on most.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Exploded view.
 *
 * Its own component so dragging the slider does not re-render three thousand
 * rows of the structure list on every pointer move — the same reason the image
 * export is separated out above.
 *
 * The caption is not decoration. What comes apart depends on what the reader has
 * already selected or isolated, and a control that silently acts on a different
 * group than the one they had in mind is worse than no control.
 */
function ExplodeControl() {
  const explode = useSceneStore((s) => s.explode);
  const setExplode = useSceneStore((s) => s.setExplode);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);

  const scope = explodeScope({ selectedOrganIds, isolatedOrganIds });
  const subject =
    scope === "selection"
      ? `the ${selectedOrganIds.length} structures you have selected`
      : scope === "region"
        ? `the ${isolatedOrganIds?.length ?? 0} parts you are studying`
        : "everything on screen";

  return (
    <section className="space-y-1 border-t border-slate-800 pt-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Exploded view
        </h2>
        {explode > 0 && (
          <button
            type="button"
            onClick={() => setExplode(0)}
            className="ml-auto rounded border border-violet-700/70 bg-violet-600/15 px-2 py-0.5 text-[10px] text-violet-300"
          >
            Reassemble
          </button>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={MAX_EXPLODE}
        step={0.05}
        value={explode}
        aria-label="How far apart to push the parts"
        onChange={(event) => setExplode(Number(event.target.value))}
        className="w-full accent-violet-500"
      />
      <p className="text-[10px] leading-snug text-slate-600">
        Pushes {subject} apart, away from its own centre, so you can see the faces
        that are normally pressed together. Nothing is hidden and nothing moves out
        of order — slide back to zero for the anatomy exactly as it was. <kbd>X</kbd>{" "}
        steps through it from the keyboard.
      </p>
    </section>
  );
}

export function AnatomyTree() {
  const organs = useSceneStore((s) => s.organs);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const hiddenOrganIds = useSceneStore((s) => s.hiddenOrganIds);
  const overlays = useSceneStore((s) => s.pathologyOverlays);
  const crossSection = useSceneStore((s) => s.crossSection);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectOrgan = useSceneStore((s) => s.selectOrgan);
  const setHovered = useSceneStore((s) => s.setHovered);
  const toggleSystem = useSceneStore((s) => s.toggleSystem);
  const soloSystem = useSceneStore((s) => s.soloSystem);
  const systemOpacity = useSceneStore((s) => s.systemOpacity);
  const cycleSystemOpacity = useSceneStore((s) => s.cycleSystemOpacity);
  const xraySystem = useSceneStore((s) => s.xraySystem);
  const clearGhosting = useSceneStore((s) => s.clearGhosting);
  const glassBody = useSceneStore((s) => s.glassBody);
  const scan = useSceneStore((s) => s.scan);
  const toggleScan = useSceneStore((s) => s.toggleScan);
  const manifest = useSceneStore((s) => s.manifest);
  // Every system at the glass setting, which is what the button both makes and
  // undoes. Derived rather than stored: a flag could disagree with the
  // opacities the moment one system was cycled by hand. Read from the manifest
  // because that is the list the action itself works from.
  const isGlass =
    (manifest?.systems.length ?? 0) > 0 &&
    (manifest?.systems ?? []).every(
      (entry) => systemOpacity[entry.system] === GLASS_OPACITY,
    );
  const eyeTracking = useSceneStore((s) => s.eyeTracking);
  const setEyeTracking = useSceneStore((s) => s.setEyeTracking);
  const depthProbeVisible = useSceneStore((s) => s.depthProbeVisible);
  const setDepthProbeVisible = useSceneStore((s) => s.setDepthProbeVisible);
  const labelsVisible = useSceneStore((s) => s.labelsVisible);
  const setLabelsVisible = useSceneStore((s) => s.setLabelsVisible);
  const background = useSceneStore((s) => s.background);
  const setBackground = useSceneStore((s) => s.setBackground);
  const showAllSystems = useSceneStore((s) => s.showAllSystems);
  const clearIsolation = useSceneStore((s) => s.clearIsolation);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const resetView = useSceneStore((s) => s.resetView);

  const bySystem = useMemo(() => {
    const groups = new Map<AnatomicalSystem, ManifestOrgan[]>();
    for (const organ of Object.values(organs)) {
      const list = groups.get(organ.system) ?? [];
      list.push(organ);
      groups.set(organ.system, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => organLabel(a).localeCompare(organLabel(b)));
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [organs]);

  /**
   * Whether anything is open, which is what the global toggle acts on.
   *
   * "Any" rather than "all": with one system left open the useful move is
   * closing it, and a toggle keyed on *all* being open would make the button
   * say "expand" while the thing in your way is still on screen.
   */
  const anyOpen = bySystem.some(([system]) => systemIsOpen(expanded, system));
  const totalStructures = bySystem.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StructureSearch />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Systems
          </h2>
          {bySystem.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setExpanded(
                  Object.fromEntries(bySystem.map(([system]) => [system, !anyOpen])),
                )
              }
              title={
                anyOpen
                  ? "Collapse every system"
                  : `Expand every system — ${totalStructures} structures`
              }
              className="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500 transition hover:border-sky-600 hover:text-sky-300"
            >
              {anyOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
        {bySystem.map(([system, list]) => {
          const isOpen = systemIsOpen(expanded, system);
          return (
          <div key={system} className="mb-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-200">
              <input
                type="checkbox"
                checked={!hiddenSystems.includes(system)}
                onChange={() => toggleSystem(system)}
                title={
                  hiddenSystems.includes(system)
                    ? "Load and show this system"
                    : "Hide this system"
                }
                className="accent-sky-500"
              />
              <button
                type="button"
                onClick={() =>
                  setExpanded((state) => ({ ...state, [system]: !isOpen }))
                }
                className="flex flex-1 items-center gap-1.5 text-left hover:text-sky-300"
                aria-expanded={isOpen}
              >
                <span className="w-2 text-[9px] text-slate-500">
                  {isOpen ? "▼" : "▶"}
                </span>
                {/* The legend for the viewport's tissue colours. Without it the
                    palette is decoration; with it, the colour of a mesh tells
                    you which system it belongs to before you click anything. */}
                <span
                  aria-hidden
                  title={`${SYSTEM_LABELS[system]} — the colour key in the viewport names every tissue on screen`}
                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/30"
                  style={{ backgroundColor: SYSTEM_COLOURS[system] }}
                />
                <span className="capitalize">{system}</span>
                <span className="ml-auto text-xs text-slate-500">{list.length}</span>
              </button>
              {/* Three things you can do to a layer, and they are different
                  questions: show it, see through it, or have it alone. */}
              <button
                type="button"
                onClick={() => cycleSystemOpacity(system)}
                title={
                  systemOpacity[system] === undefined
                    ? `Make ${system} translucent — see what is under it`
                    : `${system} is at ${Math.round(systemOpacity[system]! * 100)}% — click for less, again for solid`
                }
                className={`shrink-0 rounded border px-1 py-0.5 text-[9px] leading-none ${
                  systemOpacity[system] === undefined
                    ? "border-slate-700 text-slate-500 hover:border-sky-600 hover:text-sky-300"
                    : "border-sky-700/70 bg-sky-600/15 text-sky-300"
                }`}
              >
                ◐
              </button>
              <button
                type="button"
                onClick={() => xraySystem(system)}
                title={`Keep ${system} solid and ghost everything else`}
                className="shrink-0 rounded border border-slate-700 px-1 py-0.5 text-[9px] uppercase tracking-wide text-slate-500 hover:border-sky-600 hover:text-sky-300"
              >
                X-ray
              </button>
              <button
                type="button"
                onClick={() => soloSystem(system)}
                title={`Study ${system} on its own`}
                className="shrink-0 rounded border border-slate-700 px-1 py-0.5 text-[9px] uppercase tracking-wide text-slate-500 hover:border-sky-600 hover:text-sky-300"
              >
                Solo
              </button>
            </div>

            {isOpen && (
            <ul className="ml-5 space-y-0.5">
              {list.map((organ) => {
                const visible = isOrganVisible(
                  { hiddenSystems, isolatedOrganIds, hiddenOrganIds },
                  organ,
                );
                const overlay = overlays[organ.organ_id];
                return (
                  <li key={organ.organ_id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHovered(organ.organ_id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={(event) =>
                        selectOrgan(organ.organ_id, event.ctrlKey || event.metaKey)
                      }
                      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition ${
                        selectedOrganIds.includes(organ.organ_id)
                          ? "bg-sky-500/15 text-sky-300"
                          : "text-slate-400 hover:bg-slate-800/60"
                      } ${visible ? "" : "opacity-40"}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate italic">{organLabel(organ)}</span>
                        <span className="block truncate text-[10px] text-slate-500">
                          {organSubtitle(organ)}
                        </span>
                      </span>
                      {overlay && (
                        <span
                          className="shrink-0 text-[10px] text-amber-400"
                          title={`${overlay.pathology} (${Math.round(overlay.severity * 100)}%)`}
                        >
                          ●
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
          );
        })}
      </section>

      <section className="space-y-1 border-t border-slate-800 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          View
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={eyeTracking}
            onChange={(event) => setEyeTracking(event.target.checked)}
            className="accent-sky-500"
          />
          <span>Eyes follow you</span>
        </label>
        <p className="text-[10px] leading-snug text-slate-600">
          The globes turn in their orbits, up to about 35° — as far as a real eye
          goes before the head has to follow.
        </p>

        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={labelsVisible}
            onChange={(event) => setLabelsVisible(event.target.checked)}
            className="accent-sky-500"
          />
          <span>Label what I select</span>
        </label>
        <p className="text-[10px] leading-snug text-slate-600">
          Names in the margins with a leader line to each structure, the way an atlas
          plate does it. Select structures — or isolate a region — to name them.
        </p>

        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={depthProbeVisible}
            onChange={(event) => setDepthProbeVisible(event.target.checked)}
            className="accent-sky-500"
          />
          <span>List what is under the cursor</span>
        </label>
        <p className="text-[10px] leading-snug text-slate-600">
          The panel on the right, naming everything the cursor passes through from
          the surface inwards. It is the one thing here no page in a book can
          answer — but on a small screen it sits over the chest, so it comes off
          from here or from the right-click menu.
        </p>

        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-slate-300">Background</span>
          <div className="ml-auto flex overflow-hidden rounded border border-slate-700">
            {(["dark", "light"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setBackground(mode)}
                aria-pressed={background === mode}
                title={
                  mode === "dark"
                    ? "Easier on the eye for a long session"
                    : "For handouts, slides and anything not itself dark"
                }
                className={`px-2 py-0.5 text-[10px] capitalize transition ${
                  background === mode
                    ? "bg-slate-700/70 text-slate-100"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <CoverageToggle />
        <SaveImageButton />
      </section>

      <section className="space-y-2 border-t border-slate-800 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Cross-section
        </h2>
        <div className="flex gap-1">
          {PLANES.map((plane) => (
            <button
              key={plane}
              type="button"
              onClick={() =>
                applyCommand({
                  action: "set_cross_section",
                  plane,
                  position: crossSection?.plane === plane ? crossSection.position : 0,
                })
              }
              className={`flex-1 rounded border px-2 py-1 text-xs capitalize ${
                crossSection?.plane === plane
                  ? "border-sky-500 bg-sky-500/10 text-sky-300"
                  : "border-slate-700 text-slate-400"
              }`}
            >
              {plane}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={crossSection?.position ?? 0}
          disabled={!crossSection}
          onChange={(e) =>
            crossSection &&
            applyCommand({
              action: "set_cross_section",
              plane: crossSection.plane,
              position: Number(e.target.value),
            })
          }
          className="w-full accent-sky-500 disabled:opacity-30"
        />
      </section>

      <ExplodeControl />

      <section className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
        {isolatedOrganIds !== null && (
          <button
            type="button"
            onClick={clearIsolation}
            className="rounded border border-amber-600/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-300"
          >
            Showing {isolatedOrganIds.length} isolated — clear
          </button>
        )}
        <button
          type="button"
          onClick={showAllSystems}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400"
        >
          Show all systems
        </button>
        <button
          type="button"
          onClick={glassBody}
          title="Turn the whole body to glass — then point at it, and what lies under the cursor lights up"
          aria-pressed={isGlass}
          className={`rounded border px-2 py-1 text-xs ${
            isGlass
              ? "border-amber-500/70 bg-amber-400/15 text-amber-200"
              : "border-slate-700 text-slate-400"
          }`}
        >
          Glass body
        </button>
        {/*
          Beside Glass body rather than as another checkbox above, because it
          answers the same question those buttons do — *how* the body is drawn,
          not *what* is drawn. There are already several ways to play down the
          anatomy, and grouping the ones that change its appearance keeps them
          from reading as five unrelated switches.
        */}
        <button
          type="button"
          onClick={toggleScan}
          title="Drain the colour from everything except what is marked, selected or isolated"
          aria-pressed={scan}
          className={`rounded border px-2 py-1 text-xs ${
            scan
              ? "border-slate-300/70 bg-slate-200/15 text-slate-100"
              : "border-slate-700 text-slate-400"
          }`}
        >
          Scan
        </button>
        {Object.keys(systemOpacity).length > 0 && (
          <button
            type="button"
            onClick={clearGhosting}
            title="Make every layer solid again"
            className="rounded border border-sky-700/70 bg-sky-600/15 px-2 py-1 text-xs text-sky-300"
          >
            Solid again
          </button>
        )}
        <button
          type="button"
          onClick={resetView}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400"
        >
          Reset view
        </button>
      </section>
      </div>
    </div>
  );
}
