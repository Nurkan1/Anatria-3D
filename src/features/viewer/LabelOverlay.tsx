import { useEffect, useMemo, useRef } from "react";

import type { ManifestOrgan } from "@/lib/schemas";
import { organLabel, useSceneStore } from "@/stores/sceneStore";

import { backgroundTheme } from "./background";
import { layoutLabels, type LabelAnchor } from "./labelLayout";
import { getViewerHandle, projectToScreen, structurePosition } from "./viewerBridge";

/**
 * Names in the margins, with a leader line to each structure — the way an atlas
 * plate has always done it.
 *
 * # What gets labelled
 *
 * The selection, and if nothing is selected, whatever is isolated. Never
 * "everything visible": with three thousand structures on screen that is not a
 * plate, it is a wall. Choosing what to name is the reader's job, and they
 * already have the gesture for it.
 *
 * # Why the DOM is written by hand
 *
 * Positions change on every frame of an orbit. Rendering them through React
 * would re-render this component sixty times a second to move some text, so the
 * nodes are created once, keyed by structure, and their transforms are written
 * directly from an animation loop.
 */

/** Beyond this a column of names stops being readable, whatever the layout. */
const MAX_LABELS = 40;

/**
 * How much of the canvas the camera these labels follow is drawing into.
 *
 * `1` when it owns the whole thing, `0.5` in the split study view, where it
 * owns the top-left quarter. Only a fraction is needed rather than a full
 * rectangle because that panel shares the container's origin — if the
 * interactive panel ever moves away from the top left, this becomes a rect.
 */
export function LabelOverlay({ fraction = 1 }: { fraction?: number } = {}) {
  const labelsVisible = useSceneStore((s) => s.labelsVisible);
  const organs = useSceneStore((s) => s.organs);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const theme = backgroundTheme(useSceneStore((s) => s.background));
  const focusBadge = useSceneStore((s) => s.focusBadge);

  // Only when it is still the structure the number was given to. A badge that
  // outlived its selection would put an answer's ④ on whatever the reader
  // clicked next, which is worse than no number at all.
  const badgeFor =
    focusBadge && selectedOrganIds.length === 1 && selectedOrganIds[0] === focusBadge.organId
      ? focusBadge
      : null;

  const container = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLSpanElement>());
  const lines = useRef(new Map<string, SVGLineElement>());

  const targets = useMemo(
    () => labelTargets(organs, selectedOrganIds, isolatedOrganIds, labelsVisible),
    [organs, selectedOrganIds, isolatedOrganIds, labelsVisible],
  );

  useEffect(() => {
    if (targets.length === 0) return;
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const handle = getViewerHandle();
      const host = container.current;
      if (!handle || !host) return;

      const width = host.clientWidth * fraction;
      const height = host.clientHeight * fraction;

      const anchors: LabelAnchor[] = targets.map((target) => {
        // Where the structure was drawn, not where the body keeps it: a leader
        // line still pointing into the gap an exploded part left behind is
        // worse than no label at all.
        const centre = structurePosition(handle, target.id);
        if (!centre) return { ...target, x: NaN, y: NaN };
        const point = projectToScreen(centre, handle.camera, width, height);
        return { ...target, x: point.x, y: point.y, behind: point.behind };
      });

      // The nodes are already in the DOM from the previous paint, so their own
      // width is the honest measurement — no font maths, no guessing. A label
      // seen for the first time measures 0 and lands where it always did; the
      // next frame places it properly, which is one frame nobody perceives.
      const placed = layoutLabels(anchors, {
        width,
        height,
        measure: (text) => {
          for (const node of nodes.current.values()) {
            if (node.textContent?.endsWith(text)) return node.offsetWidth;
          }
          return 0;
        },
      });
      const shown = new Set(placed.map((label) => label.id));

      for (const label of placed) {
        const node = nodes.current.get(label.id);
        const line = lines.current.get(label.id);
        if (node) {
          node.style.display = "";
          // Both columns face the figure: a left-hand name ends where the
          // leader line starts, a right-hand one begins there.
          node.style.transform = `translate(${
            label.side === "left" ? label.labelX - node.offsetWidth : label.labelX
          }px, ${label.labelY - node.offsetHeight / 2}px)`;
        }
        if (line) {
          line.style.display = "";
          line.setAttribute("x1", String(label.x));
          line.setAttribute("y1", String(label.y));
          line.setAttribute("x2", String(label.labelX));
          line.setAttribute("y2", String(label.labelY));
        }
      }

      // A structure that turned away, went off screen or lost its column place
      // has to stop being drawn — otherwise its name is left pointing at
      // wherever it was standing when it disappeared.
      for (const [id, node] of nodes.current) {
        if (!shown.has(id)) node.style.display = "none";
      }
      for (const [id, line] of lines.current) {
        if (!shown.has(id)) line.style.display = "none";
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // `fraction` is in here because the loop closes over it: without it the
    // labels would keep laying themselves out for a full canvas after the view
    // was split, and land in the wrong quarter until the targets happened to
    // change.
  }, [targets, fraction]);

  // `targets` already carries the setting — see `labelTargets`, which keeps a
  // single selected structure named whatever the box says.
  if (targets.length === 0) return null;

  return (
    <div ref={container} className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full">
        {targets.map((target) => (
          <line
            key={target.id}
            ref={(node) => {
              if (node) lines.current.set(target.id, node);
              else lines.current.delete(target.id);
            }}
            stroke={theme.leader}
            strokeWidth={1}
            style={{ display: "none" }}
          />
        ))}
      </svg>

      {targets.map((target) => (
        <span
          key={target.id}
          ref={(node) => {
            if (node) nodes.current.set(target.id, node);
            else nodes.current.delete(target.id);
          }}
          style={{
            display: "none",
            top: 0,
            left: 0,
            backgroundColor: theme.chip,
            color: theme.ink,
          }}
          className="absolute flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] italic leading-tight"
        >
          {badgeFor?.organId === target.id && (
            // The same number the answer used, so the paragraph and the body
            // say the same thing. Upright and unitalicised against the Latin
            // beside it: it is a reference mark, not part of the name.
            <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sky-500/20 px-0.5 text-[8px] font-semibold not-italic text-sky-300">
              {badgeFor.index}
            </span>
          )}
          {target.text}
        </span>
      ))}
    </div>
  );
}

/**
 * Which structures to name.
 *
 * Exported for its own test: the rule is a judgement, not an implementation
 * detail, and getting it wrong means either an unreadable screen or a feature
 * that appears to do nothing.
 */
export function labelTargets(
  // `name_en` is here because the label carries the side, which only that
  // field has. Narrowing it away is what let the cast below hide the fact.
  organs: Record<string, { organ_id: string; ta2_latin: string; name_en: string }>,
  selectedOrganIds: string[],
  isolatedOrganIds: string[] | null,
  labelsVisible: boolean,
): { id: string; text: string }[] {
  // **One structure is always named, whatever the setting says.**
  //
  // The setting means "keep naming what I select" — a standing preference about
  // a plate full of labels. It was also, accidentally, the switch that decided
  // whether a numbered reference in an answer pointed at anything: the reader
  // clicks ④ beside *lobus superior pulmonis sinistri*, `focus_organ` selects
  // it and flies the camera, and with the box unticked nothing on screen says
  // which of the structures in view it is. The number promised to point, and
  // pointed nowhere.
  //
  // A single label cannot clutter a plate, so the promise is kept and the
  // preference is left meaning what it says for everything above one.
  if (!labelsVisible) {
    return selectedOrganIds.length === 1 ? named(organs, selectedOrganIds) : [];
  }

  // The selection wins: naming it is the most direct way to ask for a label,
  // and someone who has selected four muscles inside an isolated region wants
  // those four named, not the whole region.
  const chosen = selectedOrganIds.length > 0 ? selectedOrganIds : (isolatedOrganIds ?? []);

  return named(organs, chosen);
}

function named(
  organs: Record<string, { organ_id: string; ta2_latin: string; name_en: string }>,
  ids: string[],
): { id: string; text: string }[] {
  return ids
    .slice(0, MAX_LABELS)
    .map((id) => organs[id])
    .filter((organ) => !!organ)
    .map((organ) => ({ id: organ.organ_id, text: organLabel(organ as ManifestOrgan) }));
}
