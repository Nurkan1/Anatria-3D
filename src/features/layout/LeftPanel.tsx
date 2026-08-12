import { useState } from "react";

import { StudyPanel } from "@/features/study/StudyPanel";
import { AnatomyTree } from "@/features/tree/AnatomyTree";
import { UsagePanel } from "@/features/usage/UsagePanel";
import { useStudyStore } from "@/stores/studyStore";

type Tab = "atlas" | "study" | "usage";

/**
 * The left column: the atlas, the student's own journal, and what the
 * assistant has cost.
 *
 * All three panels stay mounted and are hidden with CSS rather than unmounted.
 * The tree carries which systems are expanded and where the list is scrolled —
 * state that is expensive to rebuild and infuriating to lose because you
 * glanced at a note. The journal, symmetrically, keeps a half-written note.
 *
 * Consumption is a tab here rather than anything in the assistant panel. It is
 * a separate activity from asking a question: you come looking for it once,
 * when a bill surprises you, and it would tax every reading of every answer if
 * it lived alongside them. The one number that does belong next to an answer —
 * what that answer cost — is already there, as a single faint line.
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
        <TabButton active={tab === "usage"} onClick={() => setTab("usage")}>
          Usage
        </TabButton>
      </div>

      <div className={`min-h-0 flex-1 ${tab === "atlas" ? "" : "hidden"}`}>
        <AnatomyTree />
      </div>
      <div className={`min-h-0 flex-1 ${tab === "study" ? "" : "hidden"}`}>
        <StudyPanel />
      </div>
      <div className={`min-h-0 flex-1 ${tab === "usage" ? "" : "hidden"}`}>
        <UsagePanel />
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
