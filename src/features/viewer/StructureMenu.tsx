import { useEffect, useMemo, useRef, useState } from "react";

import type { ManifestOrgan } from "@/lib/schemas";
import { activeCase, useCaseStore } from "@/stores/caseStore";
import { organLabel, regionMembersByNode, useSceneStore } from "@/stores/sceneStore";

export interface MenuTarget {
  organId: string;
  x: number;
  y: number;
}

/**
 * Right-click menu for isolating a structure or any group that contains it.
 *
 * This exists because the obvious gesture does not work: **the atlas has no
 * mesh called "Heart"**. The heart is a *collection* holding seventeen parts,
 * so there is nothing to double-click that means "the whole organ" — clicking a
 * chamber can only ever isolate that chamber.
 *
 * The ancestry is the answer. Right-clicking a chamber offers the chamber, then
 * the heart, then the cardiovascular system, each with the count it would show.
 * Picking the level of detail is the reader's decision, not a guess we make for
 * them.
 */
export function StructureMenu({
  target,
  onClose,
}: {
  target: MenuTarget | null;
  onClose: () => void;
}) {
  const organs = useSceneStore((s) => s.organs);
  const studyOrgan = useSceneStore((s) => s.studyOrgan);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const isolateSelection = useSceneStore((s) => s.isolateSelection);
  const hideSelection = useSceneStore((s) => s.hideSelection);
  const studyGroup = useSceneStore((s) => s.studyGroup);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  const showAllSystems = useSceneStore((s) => s.showAllSystems);
  const setHovered = useSceneStore((s) => s.setHovered);
  const activePatient = useCaseStore(activeCase);
  const symptoms = useCaseStore((s) => s.symptoms);
  const unmark = useCaseStore((s) => s.unmark);
  const menuRef = useRef<HTMLDivElement>(null);
  const [marking, setMarking] = useState(false);

  const organ = target ? organs[target.organId] : undefined;
  /** What is already recorded here, so the menu shows it rather than duplicating it. */
  const marked = symptoms.filter((entry) => entry.organ_id === target?.organId);

  /**
   * Ancestry, innermost group first. Reversed because the group that contains
   * this structure most closely is the one most likely wanted.
   */
  const groups = useMemo(() => {
    if (!organ) return [];
    return [...organ.path]
      .reverse()
      .map((node) => ({ node, count: regionMembersByNode(organs, node).length }))
      .filter((entry) => entry.count > 1);
  }, [organ, organs]);

  useEffect(() => {
    if (!target) return;
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // `pointerdown` rather than `click`: dismissing on click would let the same
    // press that closes the menu also select whatever is behind it.
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [target, onClose]);

  if (!target || !organ) return null;

  const act = (run: () => void) => () => {
    run();
    setHovered(null);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      // Nudged off the cursor so the pointer is not sitting on the first item.
      style={{ left: target.x + 2, top: target.y + 2 }}
      className="absolute z-50 w-64 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/98 py-1 text-xs shadow-2xl backdrop-blur"
      role="menu"
    >
      <div className="border-b border-slate-800 px-3 py-1.5">
        <p className="truncate italic text-slate-200">{organLabel(organ)}</p>
        <p className="truncate text-[10px] text-slate-500">{organ.name_en}</p>
      </div>

      <MenuItem onClick={act(() => studyOrgan(organ.organ_id))}>
        Isolate this structure
      </MenuItem>

      {selectedOrganIds.length > 1 && (
        <>
          <MenuItem onClick={act(isolateSelection)}>
            Isolate selection
            <span className="ml-auto text-[10px] text-slate-500">
              {selectedOrganIds.length}
            </span>
          </MenuItem>
          <MenuItem onClick={act(hideSelection)}>Hide selection</MenuItem>
        </>
      )}

      {groups.length > 0 && (
        <>
          <p className="px-3 pb-0.5 pt-2 text-[9px] uppercase tracking-wider text-slate-600">
            Isolate the group it belongs to
          </p>
          {groups.map((group) => (
            <MenuItem key={group.node} onClick={act(() => studyGroup(group.node))}>
              <span className="truncate">{group.node}</span>
              <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                {group.count}
              </span>
            </MenuItem>
          ))}
        </>
      )}

      <div className="my-1 border-t border-slate-800" />

      <MenuItem
        onClick={act(() =>
          applyCommand({ action: "focus_organ", organ_id: organ.organ_id }),
        )}
      >
        Fly to this structure
      </MenuItem>
      <MenuItem onClick={act(showAllSystems)}>Show everything</MenuItem>

      {/* Only with a patient open: a complaint has to belong to someone, and
          there is nowhere to file one otherwise. */}
      {activePatient && (
        <>
          <div className="my-1 border-t border-slate-800" />
          {marking ? (
            <SymptomComposer
              organ={organ}
              caseId={activePatient.id}
              onDone={() => {
                setMarking(false);
                setHovered(null);
                onClose();
              }}
              onCancel={() => setMarking(false)}
            />
          ) : (
            <>
              <p className="px-3 pb-0.5 pt-1 text-[9px] uppercase tracking-wider text-slate-600">
                {activePatient.title}
              </p>
              <MenuItem onClick={() => setMarking(true)}>Mark a complaint here</MenuItem>
              {marked.length > 0 && (
                <div className="px-3 pb-1.5 pt-0.5 space-y-0.5">
                  {marked.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[10px] text-amber-300/90">
                        {entry.symptom}
                        {entry.severity !== null && (
                          <span className="text-slate-500"> · {entry.severity}/10</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void unmark(entry.id)}
                        title="Remove this complaint"
                        className="shrink-0 text-[10px] text-slate-600 transition hover:text-rose-400"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Marking what the reader says hurts here.
 *
 * **Where they point, not where the cause is.** Nothing tries to be clever
 * about relocating a complaint to the organ it suggests — pain down an arm
 * belonging to a heart is the reasoning the case exists to teach, and quietly
 * filing it under the heart would delete the exercise.
 */
function SymptomComposer({
  organ,
  caseId,
  onDone,
  onCancel,
}: {
  organ: ManifestOrgan;
  caseId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const mark = useCaseStore((s) => s.mark);
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState(5);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (text.trim().length === 0) return;
    setBusy(true);
    const marked = await mark({
      case_id: caseId,
      organ_id: organ.organ_id,
      // Stored beside the id so the complaint can still name where it was
      // marked when this structure's system is switched off.
      organ_label: organLabel(organ),
      symptom: text.trim(),
      severity,
    });
    setBusy(false);
    if (marked) onDone();
  }

  return (
    <div className="space-y-1.5 px-3 py-2">
      <input
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") onCancel();
        }}
        placeholder="What does the patient report here?"
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] outline-none placeholder:text-slate-600 focus:border-amber-600"
      />
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={10}
          value={severity}
          onChange={(event) => setSeverity(Number(event.target.value))}
          className="h-1 flex-1 accent-amber-500"
        />
        <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
          {severity}/10
        </span>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || text.trim().length === 0}
          className="flex-1 rounded border border-amber-700/60 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-40"
        >
          Mark it
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[10px] text-slate-500 transition hover:text-slate-200"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-300 hover:bg-sky-600/20 hover:text-sky-200"
    >
      {children}
    </button>
  );
}
