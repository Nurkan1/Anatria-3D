import { useEffect, useState } from "react";

import { ChatPanel } from "@/features/chat/ChatPanel";
import { GuideOverlay } from "@/features/help/GuideOverlay";
import { useFirstRun } from "@/features/help/useFirstRun";
import { IdleScreen } from "@/features/idle/IdleScreen";
import { useIdleScreen } from "@/features/idle/useIdleScreen";
import { LeftPanel } from "@/features/layout/LeftPanel";
import { SplashScreen } from "@/features/splash/SplashScreen";
import { useSplash } from "@/features/splash/useSplash";
import { ResizeHandle } from "@/features/layout/ResizeHandle";
import { CHAT_LIMITS, TREE_LIMITS, useLayout } from "@/features/layout/useLayout";
import { ConfirmDialog } from "@/features/common/ConfirmDialog";
import { PrintSheet } from "@/features/study/PrintSheet";
import { AnatomyViewer } from "@/features/viewer/AnatomyViewer";
import { useChatStore } from "@/stores/chatStore";
import { checkStorage, confirmStoragePersists } from "@/lib/localStore";
import { useStudyStore } from "@/stores/studyStore";
import { startViewPersistence } from "@/stores/persistView";
import { useSceneStore } from "@/stores/sceneStore";

/**
 * The application shell: anatomy tree, viewport, assistant.
 *
 * Both side panels are resizable and collapsible, and their widths persist —
 * how much room the reading pane deserves versus the model depends on what
 * someone is doing, and that changes minute to minute.
 *
 * The viewport is a flex child rather than a fixed grid track so it absorbs
 * whatever the panels leave. Three sized columns would let a wide panel push
 * the canvas off-screen instead of shrinking it.
 */
export default function App() {
  const { layout, setTreeWidth, setChatWidth, toggleTree, toggleChat } = useLayout();
  const { firstRun, markSeen } = useFirstRun();
  // Opened for a first-time reader, because the two things they cannot discover
  // by poking at the model are the right-click menu and what the app is not for.
  const [guideOpen, setGuideOpen] = useState(firstRun);

  // Ready when the atlas is, not when React is: the panels render instantly
  // and would otherwise appear as empty furniture around a blank viewport.
  const atlasReady = useSceneStore((s) => s.manifest !== null);
  const splash = useSplash(atlasReady);

  // Remember how the reader left the view, so the next launch opens on it.
  useEffect(startViewPersistence, []);
  // Proved rather than assumed, once, at launch. An empty store and a refused
  // one both read as `null`, which is how a machine that could not save
  // anything went a whole release looking like a machine nobody had configured.
  useEffect(checkStorage, []);
  // And the harder half, once the journal has answered: whether anything
  // written by an earlier launch is still here. A browser engine that has
  // quietly fallen back to an in-memory store passes every check inside a
  // single run — this is the only one it fails.
  const journal = useStudyStore((s) => s.stats);
  useEffect(() => {
    if (!journal) return;
    confirmStoragePersists(journal.sessions + journal.notes + journal.cases > 0);
  }, [journal]);

  /**
   * The resting screen waits for the app to be genuinely idle.
   *
   * Not while an answer is still arriving, and — checked inside the hook —
   * not while a question sits typed and unsent. Someone who walks away
   * mid-answer comes back to the answer.
   */
  const answering = useChatStore((s) => s.pendingRequestId !== null);
  const idle = useIdleScreen({ armed: atlasReady && !splash.visible && !answering });

  const closeGuide = () => {
    setGuideOpen(false);
    markSeen();
  };

  return (
    <div className="flex h-full bg-slate-950 text-slate-200">
      {splash.visible && <SplashScreen leaving={splash.leaving} />}
      {idle.showing && <IdleScreen onDismiss={idle.dismiss} />}
      {/* Renders through a portal into `<body>`, outside this tree: the print
          stylesheet hides `#root` so the sheet is the whole page. */}
      <PrintSheet />
      {/* Also a portal, and mounted after the sheet so it sits above it: the
          only thing allowed to interrupt a print preview is a question about
          destroying something. */}
      <ConfirmDialog />
        <>
          <aside
            hidden={layout.treeCollapsed}
            inert={layout.treeCollapsed}
            className="min-h-0 shrink-0 overflow-hidden"
            style={{ width: layout.treeWidth }}
          >
            <LeftPanel />
          </aside>
          {!layout.treeCollapsed && <ResizeHandle
            width={layout.treeWidth}
            onResize={setTreeWidth}
            side="left"
            min={TREE_LIMITS.min}
            max={TREE_LIMITS.max}
            defaultWidth={TREE_LIMITS.default}
            label="Resize the anatomy panel"
          />}
        </>

      <main className="relative min-h-0 min-w-0 flex-1">
        <AnatomyViewer />
        <TopBar
          treeCollapsed={layout.treeCollapsed}
          chatCollapsed={layout.chatCollapsed}
          onToggleTree={toggleTree}
          onToggleChat={toggleChat}
          onOpenGuide={() => setGuideOpen(true)}
        />
        {/* Scoped to the viewport rather than the window: the panels stay
            reachable, so the guide can be read next to the thing it describes. */}
        {guideOpen && <GuideOverlay onClose={closeGuide} />}
      </main>

        <>
          {!layout.chatCollapsed && <ResizeHandle
            width={layout.chatWidth}
            onResize={setChatWidth}
            side="right"
            min={CHAT_LIMITS.min}
            max={CHAT_LIMITS.max}
            defaultWidth={CHAT_LIMITS.default}
            label="Resize the assistant panel"
          />}
          <aside
            hidden={layout.chatCollapsed}
            inert={layout.chatCollapsed}
            className="min-h-0 shrink-0 overflow-hidden"
            style={{ width: layout.chatWidth }}
          >
            <ChatPanel />
          </aside>
        </>
    </div>
  );
}

/**
 * Panel toggles either side of the disclaimer.
 *
 * The disclaimer is permanent and non-dismissable — not a UI preference but
 * part of what keeps the product outside the scope of EU MDR 2017/745 (see
 * README). The toggles live here rather than inside the panels so a collapsed
 * panel can still be brought back.
 */
function TopBar({
  treeCollapsed,
  chatCollapsed,
  onToggleTree,
  onToggleChat,
  onOpenGuide,
}: {
  treeCollapsed: boolean;
  chatCollapsed: boolean;
  onToggleTree: () => void;
  onToggleChat: () => void;
  onOpenGuide: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-slate-900/80 px-2 py-1.5 backdrop-blur">
      <PanelToggle
        active={!treeCollapsed}
        onClick={onToggleTree}
        title={treeCollapsed ? "Show the anatomy panel" : "Hide the anatomy panel"}
      >
        ▌▍
      </PanelToggle>

      <p className="flex-1 text-center text-[11px] text-slate-400">
        Educational use only — not a medical device, and not for diagnosis or treatment.
      </p>

      <button
        type="button"
        onClick={onOpenGuide}
        title="How Anatria3D works"
        aria-label="How Anatria3D works"
        className="rounded-full border border-slate-700 px-[7px] text-[11px] leading-[17px] text-slate-500 transition hover:border-sky-600 hover:text-sky-300"
      >
        ?
      </button>

      <PanelToggle
        active={!chatCollapsed}
        onClick={onToggleChat}
        title={chatCollapsed ? "Show the assistant" : "Hide the assistant"}
      >
        ▍▌
      </PanelToggle>
    </div>
  );
}

function PanelToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded px-1.5 py-0.5 text-[13px] leading-none transition ${
        active
          ? "text-slate-300 hover:text-sky-300"
          : "text-slate-600 hover:text-slate-400"
      }`}
    >
      {children}
    </button>
  );
}
