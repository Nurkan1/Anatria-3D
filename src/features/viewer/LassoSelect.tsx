import { useCallback, useEffect, useRef, useState } from "react";

import { isOrganVisible, useSceneStore } from "@/stores/sceneStore";

import {
  collectInPath,
  extendPath,
  isLassoMeaningful,
  suppressNextClick,
  type Point,
} from "./areaSelect";
import { backgroundTheme } from "./background";
import { getViewerHandle, positionLookup } from "./viewerBridge";

/**
 * Draw round a region to select it.
 *
 * # The gesture
 *
 * Hold Ctrl (Cmd on a Mac) and drag. Ctrl already means "add to what is
 * selected" everywhere else here, so Ctrl+draw meaning "add this whole area"
 * is the same idea at a larger scale rather than a new one to learn.
 *
 * # Why the orbit has to be switched off, in the capture phase
 *
 * OrbitControls listens on the canvas and would rotate the model while the loop
 * is being drawn. Disabling it on the way *down* through the container — before
 * the canvas sees the press — is what stops the camera moving at all, rather
 * than moving a few degrees before a threshold notices.
 */
export function LassoSelect({
  container,
}: {
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const organs = useSceneStore((s) => s.organs);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);
  const hiddenOrganIds = useSceneStore((s) => s.hiddenOrganIds);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const addToSelection = useSceneStore((s) => s.addToSelection);
  const theme = backgroundTheme(useSceneStore((s) => s.background));

  const [path, setPath] = useState<Point[]>([]);
  const [caught, setCaught] = useState(0);
  const drawing = useRef(false);
  const pathRef = useRef<Point[]>([]);

  /** Everything a loop is allowed to catch: on screen, and switched on. */
  const visible = useCallback(
    () =>
      Object.values(organs).filter((organ) =>
        isOrganVisible({ hiddenSystems, isolatedOrganIds, hiddenOrganIds }, organ),
      ),
    [organs, hiddenSystems, isolatedOrganIds, hiddenOrganIds],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const drawn = pathRef.current;
      drawing.current = false;
      pathRef.current = [];
      setPath([]);
      setCaught(0);

      const handle = getViewerHandle();
      if (handle?.controls) handle.controls.enabled = true;
      if (!commit || !handle || !isLassoMeaningful(drawn)) return;

      const host = container.current;
      if (!host) return;
      const ids = collectInPath(
        visible(),
        positionLookup(handle),
        handle.camera,
        host.clientWidth,
        host.clientHeight,
        drawn,
      );
      // Even an empty loop suppresses the click: the reader drew a shape and
      // caught nothing, which is an answer. Letting the release fall through to
      // select a rib would look like the gesture doing something random.
      suppressNextClick();
      if (ids.length > 0) addToSelection(ids);
    },
    [addToSelection, container, visible],
  );

  useEffect(() => {
    const host = container.current;
    if (!host) return;

    const localPoint = (event: PointerEvent): Point => {
      const bounds = host.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
      const handle = getViewerHandle();
      // Capture phase, so this runs before OrbitControls' own listener on the
      // canvas and the camera never starts to move.
      if (handle?.controls) handle.controls.enabled = false;
      drawing.current = true;
      pathRef.current = [localPoint(event)];
      setPath(pathRef.current);
    };

    const onMove = (event: PointerEvent) => {
      if (!drawing.current) return;
      const next = extendPath(pathRef.current, localPoint(event));
      if (next === pathRef.current) return;
      pathRef.current = next;
      setPath(next);

      const handle = getViewerHandle();
      if (handle && isLassoMeaningful(next)) {
        setCaught(
          collectInPath(
            visible(),
            positionLookup(handle),
            handle.camera,
            host.clientWidth,
            host.clientHeight,
            next,
          ).length,
        );
      }
    };

    const onUp = () => {
      if (drawing.current) finish(true);
    };

    const onKey = (event: KeyboardEvent) => {
      // Escape abandons the loop. Releasing Ctrl does not: people let go of the
      // modifier halfway through a long shape without meaning to cancel.
      if (event.key === "Escape" && drawing.current) finish(false);
    };

    host.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      host.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      // A panel collapsed mid-draw never sees a pointer-up, and the orbit would
      // stay switched off for the rest of the session.
      const handle = getViewerHandle();
      if (handle?.controls) handle.controls.enabled = true;
    };
  }, [container, finish, visible]);

  if (path.length < 2) return null;

  const outline = path.map((point) => `${point.x},${point.y}`).join(" ");
  const last = path[path.length - 1]!;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full">
        <polygon
          points={outline}
          fill={theme.leader}
          fillOpacity={0.12}
          stroke={theme.leader}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      </svg>
      <span
        style={{
          transform: `translate(${last.x + 12}px, ${last.y + 12}px)`,
          backgroundColor: theme.chip,
          color: theme.ink,
        }}
        className="absolute left-0 top-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] tabular-nums"
      >
        {caught} structure{caught === 1 ? "" : "s"}
      </span>
    </div>
  );
}
