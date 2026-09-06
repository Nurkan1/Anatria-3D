import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureView } from "./captureView";
import { mainRect, type AuxiliaryView } from "./studyLayout";
import { setViewerHandle, type ViewerHandle } from "./viewerBridge";
import { useSceneStore } from "@/stores/sceneStore";

vi.mock("@/lib/studyDb", () => ({ saveViewImage: vi.fn().mockResolvedValue("image.png") }));
afterEach(() => { vi.restoreAllMocks(); setViewerHandle(null); });

function fixture(active: AuxiliaryView[]) {
  const panel = mainRect(active);
  const camera = new THREE.PerspectiveCamera(45, 2 * panel.width / panel.height, 0.03, 80);
  camera.position.set(1, 2, 3);
  camera.lookAt(0, 0, 0);
  camera.zoom = 1.4;
  camera.updateProjectionMatrix();
  const viewport = new THREE.Vector4(10, 20, 500, 400);
  const scissor = viewport.clone();
  const target = new THREE.WebGLRenderTarget(20, 20);
  let enabled = true;
  let currentTarget: THREE.WebGLRenderTarget | null = target;
  const gl = {
    domElement: { width: 2000, height: 1000 }, autoClear: false,
    getSize: (out: THREE.Vector2) => out.set(1000, 500),
    getViewport: (out: THREE.Vector4) => out.copy(viewport),
    getScissor: (out: THREE.Vector4) => out.copy(scissor),
    getScissorTest: () => enabled,
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn((next) => { currentTarget = next; }),
    setScissorTest: vi.fn((next) => { enabled = next; }),
    setViewport: vi.fn((x, y, width, height) => {
      if (x instanceof THREE.Vector4) viewport.copy(x);
      else viewport.set(x, y, width, height);
    }),
    setScissor: vi.fn((next: THREE.Vector4) => scissor.copy(next)),
    render: vi.fn(),
  };
  const handle: ViewerHandle = { gl: gl as unknown as THREE.WebGLRenderer, scene: new THREE.Scene(), camera, centres: new Map(), offsets: new Map(), controls: null };
  return { handle, gl, camera, viewport, target };
}

describe("principal-view capture", () => {
  it.each<AuxiliaryView[][]>([[], ["anterior"], ["anterior", "left"], ["anterior", "left", "superior"]].map((views) => [views as AuxiliaryView[]]))("uses the full aspect with auxiliary views %j", (active) => {
    const { handle, camera, gl, viewport, target } = fixture(active);
    const original = camera.projectionMatrix.clone();
    const consume = vi.fn((exported: THREE.Camera) => {
      expect(exported).not.toBe(camera);
      expect((exported as THREE.PerspectiveCamera).aspect).toBe(2);
      expect((exported as THREE.PerspectiveCamera).zoom).toBe(1.4);
      expect(exported.position.toArray()).toEqual(camera.position.toArray());
      expect(viewport.toArray()).toEqual([0, 0, 1000, 500]);
      expect(gl.getScissorTest()).toBe(false);
      expect(gl.getRenderTarget()).toBeNull();
      // Labels receive the exact camera that drew the pixels.
      expect(gl.render.mock.calls[0]?.[1]).toBe(exported);
    });
    captureView(handle, consume);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(camera.projectionMatrix.equals(original)).toBe(true);
    expect(viewport.toArray()).toEqual([10, 20, 500, 400]);
    expect(gl.getScissorTest()).toBe(true);
    expect(gl.getRenderTarget()).toBe(target);
    expect(gl.autoClear).toBe(false);
  });

  it.each(["render", "consume"])("restores renderer state when %s throws", (stage) => {
    const { handle, gl, target, viewport } = fixture(["anterior"]);
    const failure = () => { throw new Error("Capture failed"); };
    if (stage === "render") gl.render.mockImplementation(failure);
    expect(() => captureView(handle, stage === "consume" ? failure : vi.fn())).toThrow("Capture failed");
    expect(gl.getRenderTarget()).toBe(target);
    expect(gl.getScissorTest()).toBe(true);
    expect(viewport.toArray()).toEqual([10, 20, 500, 400]);
    expect(gl.autoClear).toBe(false);
  });
});

it("the actual image export uses the full projection and restores state on a canvas failure", async () => {
  const { exportViewImage } = await import("./exportView");
  const { handle, gl, viewport } = fixture(["anterior"]);
  setViewerHandle(handle);
  useSceneStore.setState({ selectedOrganIds: [], isolatedOrganIds: null });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    drawImage: () => { throw new Error("Canvas capture failed"); },
  } as unknown as CanvasRenderingContext2D);
  await expect(exportViewImage()).rejects.toThrow("Canvas capture failed");
  expect((gl.render.mock.calls[0]?.[1] as THREE.PerspectiveCamera).aspect).toBe(2);
  expect(viewport.toArray()).toEqual([10, 20, 500, 400]);
  expect(gl.autoClear).toBe(false);
});
