import { useEffect, useState } from "react";

import { organLabel, organSubtitle, useSceneStore } from "@/stores/sceneStore";

import { SUPPLY_LABEL, type SupplyKind } from "./supply";
import { useDraggablePanel } from "./useDraggablePanel";

/** Where the study panel sits, remembered between sessions. */
const POSITION_KEY = "anatria3d.studyPanel.v1";

/**
 * Study mode: the panel shown while structures are isolated.
 *
 * Isolation without a visible way out is a trap — the viewport looks broken
 * rather than filtered, and the control that caused it is in a panel the user
 * may have collapsed. So the state announces itself over the canvas, names what
 * is being studied, and offers both a button and the Escape key to leave.
 *
 * **Every member gets its own control.** Isolating the heart brings seventeen
 * parts, and collapsing thirteen of them into "+13 more" made most of the study
 * set unreachable: you could see that they were there and do nothing with them.
 * A part you have isolated is a part you are working on, so each one can be
 * flown to, highlighted, or dropped from the set.
 */
export function IsolationBar() {
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const organs = useSceneStore((s) => s.organs);
  const overlays = useSceneStore((s) => s.pathologyOverlays);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const clearIsolation = useSceneStore((s) => s.clearIsolation);
  const dropFromIsolation = useSceneStore((s) => s.dropFromIsolation);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const setHovered = useSceneStore((s) => s.setHovered);

  const [collapsed, setCollapsed] = useState(false);
  const { ref, position, moved, reset, handleProps } = useDraggablePanel(POSITION_KEY);

  // Escape is what people try first when a view narrows unexpectedly.
  useEffect(() => {
    if (isolatedOrganIds === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearIsolation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolatedOrganIds, clearIsolation]);

  if (isolatedOrganIds === null || isolatedOrganIds.length === 0) return null;

  const studied = isolatedOrganIds.map((id) => organs[id]).filter((organ) => !!organ);
  if (studied.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={ref}
        // Centred until the reader moves it, then wherever they put it.
        style={
          position
            ? { left: position.x, top: position.y }
            : { left: "50%", top: 36, transform: "translateX(-50%)" }
        }
        className="pointer-events-auto absolute w-full max-w-2xl overflow-hidden rounded-lg border border-sky-800/70 bg-slate-900/95 shadow-lg backdrop-blur"
      >
        <div
          {...handleProps}
          onDoubleClick={reset}
          title="Drag to move · double-click to put it back"
          className="flex cursor-grab items-center gap-2 px-2.5 py-1.5 active:cursor-grabbing"
        >
          <span
            aria-hidden
            className="shrink-0 select-none text-[11px] leading-none text-slate-600"
          >
            ⠿
          </span>
          <span className="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
            Studying · {studied.length}
          </span>

          {collapsed && (
            <span className="min-w-0 flex-1 truncate text-xs italic text-slate-400">
              {studied.map(organLabel).join(" · ")}
            </span>
          )}

          {moved && (
            <button
              type="button"
              onClick={reset}
              title="Put the panel back where it started"
              className="ml-auto shrink-0 rounded px-1 text-[10px] text-slate-600 transition hover:text-slate-300"
            >
              recentre
            </button>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((open) => !open)}
            title={collapsed ? "Show every part" : "Collapse the list"}
            aria-expanded={!collapsed}
            className={`shrink-0 rounded px-1.5 text-[11px] text-slate-500 transition hover:text-slate-200 ${
              collapsed || moved ? "" : "ml-auto"
            }`}
          >
            {collapsed ? "▾" : "▴"}
          </button>

          <SupplyButton kind="vascular" />
          <SupplyButton kind="neural" />

          <button
            type="button"
            onClick={clearIsolation}
            className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-sky-600 hover:text-sky-200"
          >
            Exit · Esc
          </button>
        </div>

        <SupplyNote />

        {!collapsed && (
          <div
            // Capped and scrollable: isolating a whole system can bring hundreds
            // of parts, and a list that grows without limit would cover the very
            // model it describes.
            className="flex max-h-[34vh] flex-wrap content-start gap-1 overflow-y-auto border-t border-slate-800 px-2.5 py-2"
          >
            {studied.map((organ) => (
              <StudyChip
                key={organ.organ_id}
                label={organLabel(organ)}
                subtitle={organSubtitle(organ)}
                selected={selectedOrganIds.includes(organ.organ_id)}
                pathology={overlays[organ.organ_id]?.pathology}
                onFocus={() =>
                  applyCommand({ action: "focus_organ", organ_id: organ.organ_id })
                }
                onHover={(on) => setHovered(on ? organ.organ_id : null)}
                onDrop={() => dropFromIsolation(organ.organ_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Bring in what serves the organ.
 *
 * The atlas files structures by system, so isolating the heart brings its
 * chambers and valves and leaves the coronary arteries behind in *Systemic
 * arteries*. That is a taxonomy doing its job and an anatomy lesson failing: an
 * organ is studied with its supply or it is not studied.
 *
 * Deliberately not a heart-and-brain special case. It asks "what reaches what I
 * am looking at", so it works the same on the pancreas, on an eye, or on one
 * muscle — and vessels and nerves are separate buttons because next to the
 * brain, every cranial nerve is a wonderful answer to a question you asked and
 * noise you did not.
 */
function SupplyButton({ kind }: { kind: SupplyKind }) {
  const requestSupply = useSceneStore((s) => s.requestSupply);
  const pending = useSceneStore((s) => s.supplyRequest);
  const working = pending?.kind === kind;

  return (
    <button
      type="button"
      onClick={() => requestSupply(kind)}
      disabled={pending !== null}
      title={
        kind === "vascular"
          ? "Add the arteries and veins that reach what you are studying"
          : "Add the nerves that reach what you are studying"
      }
      className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-sky-600 hover:text-sky-200 disabled:opacity-40"
    >
      {working ? "adding…" : `+ ${SUPPLY_LABEL[kind]}`}
    </button>
  );
}

/**
 * What the last request found.
 *
 * Nothing is a real answer — an isolated fingernail has no nerves modelled near
 * it — and a button that silently changes nothing reads as broken. The count is
 * what separates "there is none" from "this does not work".
 */
function SupplyNote() {
  const result = useSceneStore((s) => s.supplyResult);
  if (!result) return null;

  return (
    <p className="border-t border-slate-800 px-2.5 py-1 text-[10px] text-slate-500">
      {result.added === 0
        ? `No ${SUPPLY_LABEL[result.kind]} reach this — nothing was added.`
        : `Added ${result.added} ${SUPPLY_LABEL[result.kind]}.`}
    </p>
  );
}

/**
 * One member of the study set.
 *
 * Three affordances on one chip because a part in a study set is something you
 * are doing three things with: finding it, pointing at it, and deciding it does
 * not belong.
 */
function StudyChip({
  label,
  subtitle,
  selected,
  pathology,
  onFocus,
  onHover,
  onDrop,
}: {
  label: string;
  subtitle: string;
  selected: boolean;
  pathology: string | undefined;
  onFocus: () => void;
  onHover: (on: boolean) => void;
  onDrop: () => void;
}) {
  return (
    <span
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`group flex max-w-full items-center overflow-hidden rounded border transition ${
        selected
          ? "border-sky-600/70 bg-sky-600/15"
          : "border-slate-700/70 bg-slate-800/50 hover:border-slate-600"
      }`}
    >
      <button
        type="button"
        onClick={onFocus}
        title={pathology ? `${subtitle} — ${pathology}` : subtitle}
        className="flex min-w-0 items-center gap-1 py-0.5 pl-1.5 pr-1 text-left"
      >
        {pathology && (
          // The assistant marked this one during a case. Worth seeing at a
          // glance: it is the part the scenario is actually about.
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
          />
        )}
        <span
          className={`truncate text-[11px] italic ${
            selected ? "text-sky-200" : "text-slate-300"
          }`}
        >
          {label}
        </span>
      </button>
      <button
        type="button"
        onClick={onDrop}
        title={`Remove ${subtitle} from the study set`}
        aria-label={`Remove ${subtitle} from the study set`}
        className="shrink-0 px-1 py-0.5 text-[10px] leading-none text-slate-600 opacity-0 transition hover:text-rose-400 focus:opacity-100 group-hover:opacity-100"
      >
        ✕
      </button>
    </span>
  );
}
