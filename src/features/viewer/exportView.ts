import { saveViewImage } from "@/lib/studyDb";
import { useSceneStore } from "@/stores/sceneStore";

import { backgroundTheme, type BackgroundTheme } from "./background";
import { layoutLabels, type LabelAnchor } from "./labelLayout";
import { labelTargets } from "./LabelOverlay";
import { getViewerHandle, projectToScreen } from "./viewerBridge";

/**
 * The current view, as an image you can put in a slide.
 *
 * # Why it is composited rather than screenshotted
 *
 * The labels are DOM, not WebGL, so a plain `toDataURL` of the canvas would
 * hand back an unlabelled render — which is exactly what the operating system's
 * own screenshot already gives you, and the reason this feature exists. So the
 * WebGL frame is drawn into a 2D canvas and the names are drawn on top, at the
 * export's own resolution. The text ends up sharper than it is on screen rather
 * than upscaled.
 *
 * # Why the footer is not optional
 *
 * An image that leaves the app carries anatomy licensed CC BY-SA 4.0, and the
 * attribution has to travel with it — that is the licence, not a courtesy. The
 * educational-use line rides along for the same reason it is on every screen:
 * a picture of a diseased heart with no context is exactly what should never
 * circulate without one.
 */

const FOOTER_HEIGHT = 46;
const ATTRIBUTION = "Anatomy: Z-Anatomy / BodyParts3D (DBCLS) — CC BY-SA 4.0";
const DISCLAIMER = "Anatria3D — educational use only. Not a medical device.";

export async function exportViewImage(): Promise<string | null> {
  const handle = getViewerHandle();
  if (!handle) throw new Error("The viewer is not ready yet.");

  const { gl, scene, camera, centres } = handle;
  const source = gl.domElement;

  // Rendered right now, and read in the same synchronous stretch. Without a
  // fresh render the drawing buffer has already been presented and cleared, and
  // the capture comes back black — the classic WebGL screenshot trap. Forcing
  // the frame here avoids paying for `preserveDrawingBuffer` on every frame of
  // every session for the sake of an occasional export.
  gl.render(scene, camera);

  const width = source.width;
  const height = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height + FOOTER_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image.");

  // The image is meant to be pasted somewhere, so it carries the background the
  // reader chose rather than the one the app happens to prefer.
  const theme = backgroundTheme(useSceneStore.getState().background);

  ctx.fillStyle = theme.canvas;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);

  drawLabels(ctx, width, height, centres, camera, theme);
  drawFooter(ctx, width, height, theme);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not encode the image.");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return saveViewImage(toBase64(bytes));
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centres: Map<string, { x: number; y: number; z: number }>,
  camera: Parameters<typeof projectToScreen>[1],
  theme: BackgroundTheme,
): void {
  const state = useSceneStore.getState();
  if (!state.labelsVisible) return;

  const targets = labelTargets(
    state.organs,
    state.selectedOrganIds,
    state.isolatedOrganIds,
  );
  if (targets.length === 0) return;

  // The canvas is at device resolution, so everything scales with it and the
  // exported plate reads the same as the one on screen.
  const scale = Math.max(width / 1000, 1);
  const fontSize = Math.round(13 * scale);
  const lineHeight = Math.round(22 * scale);
  const margin = Math.round(14 * scale);

  const anchors: LabelAnchor[] = targets.map((target) => {
    const centre = centres.get(target.id);
    if (!centre) return { ...target, x: NaN, y: NaN };
    const point = projectToScreen(centre as never, camera, width, height);
    return { ...target, x: point.x, y: point.y, behind: point.behind };
  });

  const placed = layoutLabels(anchors, {
    width,
    height,
    lineHeight,
    margin,
    padding: Math.round(18 * scale),
    gap: Math.round(70 * scale),
  });

  ctx.font = `italic ${fontSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";

  for (const label of placed) {
    ctx.strokeStyle = theme.leader;
    ctx.lineWidth = Math.max(scale, 1);
    ctx.beginPath();
    ctx.moveTo(label.x, label.y);
    ctx.lineTo(label.labelX, label.labelY);
    ctx.stroke();

    ctx.textAlign = label.side === "left" ? "right" : "left";
    const textWidth = ctx.measureText(label.text).width;
    const boxX =
      label.side === "left" ? label.labelX - textWidth - 4 * scale : label.labelX - 4 * scale;

    ctx.fillStyle = theme.chip;
    ctx.fillRect(
      boxX,
      label.labelY - fontSize * 0.85,
      textWidth + 8 * scale,
      fontSize * 1.7,
    );
    ctx.fillStyle = theme.ink;
    ctx.fillText(label.text, label.labelX, label.labelY);
  }
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: BackgroundTheme,
): void {
  const scale = Math.max(width / 1000, 1);
  ctx.fillStyle = theme.canvas;
  ctx.fillRect(0, height, width, FOOTER_HEIGHT);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height + 0.5);
  ctx.lineTo(width, height + 0.5);
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `${Math.round(11 * scale)}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillStyle = theme.footerInk;
  ctx.fillText(DISCLAIMER, 12 * scale, height + FOOTER_HEIGHT * 0.36);
  ctx.fillStyle = theme.footerSubtle;
  ctx.fillText(ATTRIBUTION, 12 * scale, height + FOOTER_HEIGHT * 0.72);
}

/**
 * Bytes to base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` on a multi-megabyte image blows the argument
 * limit and throws — a stack overflow is a poor way to learn that the export
 * worked on a small window and not a large one.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** Exported for its own test — the chunking is the part that can go wrong. */
export const encodeImageBytes = toBase64;

/** Text drawn into every exported image, asserted by its test. */
export const IMAGE_FOOTER = { ATTRIBUTION, DISCLAIMER };
