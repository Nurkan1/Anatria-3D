import { useEffect, useMemo, useRef } from "react";

import { regionMembersByNode, useSceneStore } from "@/stores/sceneStore";

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
  const menuRef = useRef<HTMLDivElement>(null);

  const organ = target ? organs[target.organId] : undefined;

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
        <p className="truncate italic text-slate-200">{organ.ta2_latin}</p>
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
