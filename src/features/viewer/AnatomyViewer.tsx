import { AdaptiveDpr, AdaptiveEvents } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { loadManifest } from "@/lib/manifest";
import type { AnatomyManifest } from "@/lib/schemas";
import { organLabel, organSubtitle, useSceneStore } from "@/stores/sceneStore";
import { readStoredView, sanitiseViewPreferences } from "@/stores/viewPreferences";

import { AnatomyScene } from "./AnatomyScene";
import { backgroundTheme } from "./background";
import { ColourLegend } from "./ColourLegend";
import { consumeDepthStackReport } from "./depthStack";
import { DepthProbe } from "./DepthProbe";
import { ExplodeBar } from "./ExplodeBar";
import { IlluminationBar } from "./IlluminationBar";
import { IsolationBar } from "./IsolationBar";
import { LabelOverlay } from "./LabelOverlay";
import { LassoSelect } from "./LassoSelect";
import { PathwayBar } from "./PathwayBar";
import { SelectionBar } from "./SelectionBar";
import { StructureMenu, type MenuTarget } from "./StructureMenu";
import { useCaseMarks } from "./useCaseMarks";
import { ViewpointBar } from "./ViewpointBar";

/**
 * Label shown under the cursor. Terminologia Anatomica Latin over clinical
 * English, in every locale — the atlas speaks the profession's nomenclature and
 * the assistant is what renders it into the reader's language.
 */
function HoverLabel() {
  const hoveredOrganId = useSceneStore((s) => s.hoveredOrganId);
  const organs = useSceneStore((s) => s.organs);
  const organ = hoveredOrganId ? organs[hoveredOrganId] : undefined;
  if (!organ) return null;

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[70%] rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-2 text-center shadow-lg backdrop-blur">
      {organ.path.length > 0 && (
        // Where this sits in the body. A name alone leaves the reader to work
        // out whether they are looking at part of the heart or part of a rib.
        <div className="truncate text-[10px] text-slate-500">
          {organ.path.join(" › ")}
        </div>
      )}
      <div className="text-sm font-medium italic text-slate-100">{organLabel(organ)}</div>
      <div className="text-xs text-slate-400">{organSubtitle(organ)}</div>
    </div>
  );
}

function ViewerFallback({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="max-w-md text-center text-sm text-slate-400">{message}</p>
    </div>
  );
}

export function AnatomyViewer() {
  const setManifest = useSceneStore((s) => s.setManifest);
  const background = useSceneStore((s) => s.background);
  const restoreView = useSceneStore((s) => s.restoreView);
  const [manifest, setLocalManifest] = useState<AnatomyManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const holdDepthStack = useSceneStore((s) => s.holdDepthStack);
  // Lights the open patient's complaints on the body. Derived from the
  // journal, so it costs no model call and lands the moment one is selected.
  useCaseMarks();

  const openMenu = useCallback((organId: string, x: number, y: number) => {
    // Right-drag pans the camera, and the browser fires `contextmenu` at the
    // end of that drag too. Opening a menu after a deliberate pan would be
    // maddening, so a press that travelled is treated as navigation.
    const start = pressAt.current;
    if (start && Math.hypot(x - start.x, y - start.y) > 6) return;

    const bounds = container.current?.getBoundingClientRect();
    setMenu({ organId, x: x - (bounds?.left ?? 0), y: y - (bounds?.top ?? 0) });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadManifest(controller.signal).then(
      (loaded) => {
        setLocalManifest(loaded);
        setManifest(loaded);
        // Immediately after, and validated against the manifest that just
        // loaded: a preference naming a system this build no longer ships
        // would otherwise hide it with no row in the tree to bring it back.
        restoreView(
          sanitiseViewPreferences(
            readStoredView(),
            loaded.systems.map((entry) => entry.system),
          ),
        );
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => controller.abort();
  }, [setManifest, restoreView]);

  if (error) return <ViewerFallback message={error} />;
  if (!manifest) return <ViewerFallback message="Loading anatomy…" />;

  return (
    <div
      ref={container}
      className="relative h-full w-full"
      onPointerDown={(event) => {
        if (event.button === 2) pressAt.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={() => {
        // Runs after the canvas's own listener, because a native listener on
        // the canvas fires while the event is still bubbling and React
        // dispatches to this container afterwards. So by now a structure has
        // either answered for this move or the pointer is over nothing.
        // Held, not cleared. The panel lives inside this container, so a move
        // towards it is a move over nothing — clearing here removed the panel
        // from under the pointer that was travelling to click it.
        if (!consumeDepthStackReport()) holdDepthStack();
      }}
      onPointerLeave={holdDepthStack}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Canvas
        camera={{ position: [0, 0.2, 2.4], fov: 45, near: 0.05, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        // The range `AdaptiveDpr` below is allowed to work within. Without a
        // floor there is nothing to give back when the frame rate drops.
        performance={{ min: 0.5 }}
      >
        <color attach="background" args={[backgroundTheme(background).canvas]} />
        {/*
          Give resolution back while the view is moving, and take it again the
          moment it settles.

          The atlas can put three thousand meshes on screen, and on a laptop the
          expensive frames are the ones where the model is turning. Those are
          also the frames nobody is reading detail in. Rendering an orbit at half
          resolution and the still image at full is the trade every 3D
          application makes, and it is invisible in the direction that matters.
        */}
        <AdaptiveDpr pixelated={false} />
        {/*
          And stop casting rays while it moves.

          Pointer picking tests the ray against every visible mesh, triangle by
          triangle — the single most expensive thing that happens per mouse
          move. During an orbit nobody is hovering anything, so the work is pure
          waste. It comes back as soon as the camera stops.
        */}
        <AdaptiveEvents />
        <Suspense fallback={null}>
          <AnatomyScene manifest={manifest} onContextMenu={openMenu} />
        </Suspense>
      </Canvas>
      <LassoSelect container={container} />
      <LabelOverlay />
      <DepthProbe />
      <HoverLabel />
      <ColourLegend />
      <IsolationBar />
      <PathwayBar />
      <SelectionBar />
      <IlluminationBar />
      <ViewpointBar />
      <ExplodeBar />
      <StructureMenu target={menu} onClose={() => setMenu(null)} />
      <ControlsHint />
    </div>
  );
}

/**
 * Navigation is not discoverable by looking at a canvas, and panning in
 * particular is the control people never find — which is what makes a full body
 * feel like it can only be inspected from the middle outwards.
 */
function ControlsHint() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 space-y-0.5 text-[10px] leading-tight text-slate-600">
      <p>Drag to rotate · Scroll to zoom where you point · Lost? Use Fit, bottom right</p>
      <p>Right-drag to pan · Double-click an organ to open it with its parts</p>
      <p>Shift+double-click to build a study set · Esc to exit</p>
      <p>Ctrl+click to select several · Ctrl+drag to draw round a region</p>
      <p>I isolate · H hide · U restore · X explode the group apart</p>
      <p>Right-click a structure to isolate the organ it belongs to</p>
    </div>
  );
}
