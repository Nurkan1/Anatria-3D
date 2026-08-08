import { useState } from "react";

import { StudyPanel } from "@/features/study/StudyPanel";
import { AnatomyTree } from "@/features/tree/AnatomyTree";
import { useStudyStore } from "@/stores/studyStore";

type Tab = "atlas" | "study";

/**
 * The left column: the atlas, and the student's own journal.
 *
 * Both panels stay mounted and are hidden with CSS rather than unmounted. The
 * tree carries which systems are expanded and where the list is scrolled —
 * state that is expensive to rebuild and infuriating to lose because you
 * glanced at a note. The journal, symmetrically, keeps a half-written note.
 */
export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("atlas");
  const noteCount = useStudyStore((s) => s.stats?.notes ?? 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-slate-800">
        <TabButton active={tab === "atlas"} onClick={() => setTab("atlas")}>
          Atlas
        </TabButton>
        <TabButton active={tab === "study"} onClick={() => setTab("study")}>
          Study
          {noteCount > 0 && (
            <span className="ml-1 rounded-full bg-slate-700/70 px-1 text-[9px] text-slate-300">
              {noteCount}
            </span>
          )}
        </TabButton>
      </div>

      <div className={`min-h-0 flex-1 ${tab === "atlas" ? "" : "hidden"}`}>
        <AnatomyTree />
      </div>
      <div className={`min-h-0 flex-1 ${tab === "study" ? "" : "hidden"}`}>
        <StudyPanel />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 border-b-2 px-3 py-1.5 text-[11px] font-medium transition ${
        active
          ? "border-sky-500 text-slate-100"
          : "border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
