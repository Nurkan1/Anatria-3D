import { AdaptiveDpr, AdaptiveEvents } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { loadManifest } from "@/lib/manifest";
import type { AnatomyManifest } from "@/lib/schemas";
import { organLabel, organSubtitle, useSceneStore } from "@/stores/sceneStore";
import { useStudyViewsStore } from "@/stores/studyViewsStore";
import { readStoredView, sanitiseViewPreferences } from "@/stores/viewPreferences";

import { AnatomyScene } from "./AnatomyScene";
import { backgroundTheme } from "./background";
import { ColourLegend } from "./ColourLegend";
import { consumeClickReport, consumeDepthStackReport } from "./depthStack";
import {
  beginPress,
  DRAG_SLOP,
  pressTravelled,
  trackPress as beginTrack,
} from "./dragGuard";
import { DepthProbe } from "./DepthProbe";
import { ExplodeBar } from "./ExplodeBar";
import { IlluminationBar } from "./IlluminationBar";
import { IsolationBar } from "./IsolationBar";
import { LabelOverlay } from "./LabelOverlay";
import { RenderProbe, RenderStatsPanel } from "./RenderStats";
import { PointerRouting, StudyViews } from "./StudyViews";
import { StudyViewsFrame } from "./StudyViewsFrame";
import { StudyViewsToggle } from "./StudyViewsToggle";
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

/**
 * The atlas a session opens on, and the only one stored view preferences apply
 * to. See the restore in the effect below.
 */
const FIRST_ATLAS = "male";

export function AnatomyViewer() {
  const setManifest = useSceneStore((s) => s.setManifest);
  const genderModel = useSceneStore((s) => s.genderModel);
  const background = useSceneStore((s) => s.background);
  const restoreView = useSceneStore((s) => s.restoreView);
  // Asked for in the left panel, allowed only while something is isolated —
  // see `StudyViews` for the measurement that makes that gate the whole
  // performance strategy. Enforced here as well as there, because a mode left
  // on when the reader clears the isolation must switch itself off rather than
  // start drawing the atlas four times.
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const studyViews = useStudyViewsStore((s) => s.wanted);
  const splitting = studyViews && (isolatedOrganIds?.length ?? 0) > 0;
  const [manifest, setLocalManifest] = useState<AnatomyManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const clearDepthStack = useSceneStore((s) => s.clearDepthStack);
  const selectFromViewport = useSceneStore((s) => s.selectFromViewport);
  // Lights the open patient's complaints on the body. Derived from the
  // journal, so it costs no model call and lands the moment one is selected.
  useCaseMarks();

  const openMenu = useCallback((organId: string, x: number, y: number) => {
    // Right-drag pans the camera, and the browser fires `contextmenu` at the
    // end of that drag too. Opening a menu after a deliberate pan would be
    // maddening, so a press that travelled is treated as navigation.
    const start = pressAt.current;
    // The same rule, and now literally the same number: a press that
    // travelled is navigation, whichever button was held down for it.
    if (start && Math.hypot(x - start.x, y - start.y) > DRAG_SLOP) return;

    const bounds = container.current?.getBoundingClientRect();
    setMenu({ organId, x: x - (bounds?.left ?? 0), y: y - (bounds?.top ?? 0) });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLocalManifest(null);
    setError(null);
    loadManifest(genderModel, controller.signal).then(
      (loaded) => {
        setLocalManifest(loaded);
        setManifest(loaded);
        // Only for the atlas the session opened with. A stored preference is a
        // record of what the reader had switched off on *that* body, and the
        // two atlases share system names without sharing systems — restoring it
        // onto the other one would hide the female reproductive structures
        // because the male ones had been put away, which reads as the module
        // failing to load.
        if (genderModel !== FIRST_ATLAS) return;
        // Validated against the manifest that just loaded: a preference naming
        // a system this build no longer ships would otherwise hide it with no
        // row in the tree to bring it back.
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
  }, [genderModel, setManifest, restoreView]);

  if (error) return <ViewerFallback message={error} />;
  if (!manifest) return <ViewerFallback message="Loading anatomy…" />;

  return (
    <div
      ref={container}
      className="relative h-full w-full"
      onPointerDown={(event) => {
        if (event.button === 2) pressAt.current = { x: event.clientX, y: event.clientY };
        beginPress(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        beginTrack(event.clientX, event.clientY);
        // Runs after the canvas's own listener, because a native listener on
        // the canvas fires while the event is still bubbling and React
        // dispatches to this container afterwards. So by now a structure has
        // either answered for this move or the pointer is over nothing.
        // A pinned reading is untouched by this: it lives in its own field,
        // which is what lets the panel be walked over to and clicked.
        if (!consumeDepthStackReport()) clearDepthStack();
      }}
      onClick={(event) => {
        // The click nobody wanted.
        //
        // A structure faded past `GHOST_CLICK_THROUGH` declines clicks so the
        // event can carry on to the first thing solid enough to take it. With
        // the whole body ghosted there is no such thing, so every handler
        // along the ray declines and a single click did nothing at all — while
        // double-click, which never had that guard, went on isolating.
        //
        // The reading is still being taken: `onPointerMove` has no guard
        // either, which is why the panel keeps listing what is under the
        // cursor. So answer from that. `depthStack[0]` is the nearest crossing
        // — the very structure the panel names first, and the one a reader
        // pointing at the body means.
        //
        // Only for clicks that landed on the canvas: the overlays are children
        // of this container too, and a click on the panel's own rows must not
        // be read as a click on the body behind it.
        if (!(event.target instanceof HTMLCanvasElement)) return;
        // Orbiting is press, travel, release, and the browser calls the
        // release a click. Turning the body to see the back of the heart used
        // to finish by selecting a rib.
        if (pressTravelled()) return;
        if (consumeClickReport()) return;
        const nearest = useSceneStore.getState().depthStack[0];
        if (nearest) selectFromViewport(nearest, event.ctrlKey || event.metaKey);
      }}
      onPointerLeave={clearDepthStack}
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
        {/* An instrument, not a feature. Vite strips the whole branch from a
            production build, so neither this nor its panel ships. */}
        {import.meta.env.DEV && <RenderProbe />}
        {/* Always mounted, so it can put the pointer mapping back however the
            store was left. `StudyViews` mounts and unmounts with the mode; this
            does not, and that is the point. */}
        <PointerRouting splitting={splitting} />
        {splitting && <StudyViews />}
      </Canvas>
      {/* The lasso projects against a camera that owns the whole canvas and has
          no notion of a panel, so it sits the split out. Drawing a region over
          four viewports is a question with no obvious answer, and guessing at
          one would select structures the reader never enclosed. */}
      {!splitting && <LassoSelect container={container} />}
      {/* Labels do not sit it out. "Label what I select" is a setting the
          reader turned on, and quietly ignoring it in one mode is a small
          betrayal of it. They project into the interactive panel, which owns
          the top-left quarter of the canvas and therefore shares its origin —
          so halving the extent is the whole correction. */}
      <LabelOverlay fraction={splitting ? 0.5 : 1} />
      {splitting && <StudyViewsFrame />}
      {/* One column, well clear of the bottom edge, so neither of these lands
          on the chrome already there — the collapse toggle above, the controls
          hint below. The readout is the measuring instrument and dev-only;
          Vite strips that branch from a production build. The switch ships. */}
      <div className="pointer-events-none absolute bottom-32 left-3 z-20 flex flex-col items-start gap-1.5">
        {import.meta.env.DEV && <RenderStatsPanel />}
        <StudyViewsToggle />
      </div>
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
      <p>I isolate · H hide · U bring hidden back · C clear · X explode</p>
      <p>F fit · A P L R S viewpoints · + − zoom</p>
      <p>Right-click a structure to isolate the organ it belongs to</p>
    </div>
  );
}
