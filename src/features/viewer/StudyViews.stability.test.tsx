import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { useSceneStore } from "@/stores/sceneStore";
import { useStudyViewsStore } from "@/stores/studyViewsStore";
import { setViewerHandle, type ViewerHandle } from "./viewerBridge";

const frame = vi.hoisted(() => ({ run: undefined as (() => void) | undefined, state: {} as Record<string, unknown> }));
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: typeof frame.state) => unknown) => selector(frame.state),
  useFrame: (callback: (state: typeof frame.state) => void) => { frame.run = () => callback(frame.state); },
}));
import { StudyViews } from "./StudyViews";

let now = 1000;
let graph: THREE.Scene;
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  graph = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.userData.organId = "a";
  graph.add(mesh);
  const camera = new THREE.PerspectiveCamera(45, 2, 0.01, 100);
  camera.position.z = 4;
  frame.state = { scene: graph, camera, size: { width: 1000, height: 500 }, gl: {
    info: { autoReset: true, reset: vi.fn() }, render: vi.fn(), setViewport: vi.fn(),
    setScissor: vi.fn(), setScissorTest: vi.fn(),
  } };
  useSceneStore.setState({ selectedOrganIds: ["a"], illuminated: [], isolatedOrganIds: ["a"] });
  useStudyViewsStore.setState({ active: ["anterior", "left", "superior"] });
});

it("invalidates on lazy geometry arrival without waiting for the interval", () => {
  const handle = { ...frame.state, centres: new Map(), offsets: new Map(), controls: null, geometryRevision: 1 } as unknown as ViewerHandle;
  setViewerHandle(handle);
  const scan = vi.spyOn(graph, "traverse");
  render(<StudyViews />);
  frame.run!();
  handle.geometryRevision = 2;
  now += 1;
  frame.run!();
  expect(scan).toHaveBeenCalledTimes(2);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); setViewerHandle(null); });

it("walks geometry once per 400 ms, not once per rendered frame", () => {
  const scan = vi.spyOn(graph, "traverse");
  render(<StudyViews />);
  frame.run!();
  expect(scan).toHaveBeenCalledTimes(1);
  for (let i = 1; i < 24; i++) { now = 1000 + i * 16; frame.run!(); }
  expect(scan).toHaveBeenCalledTimes(1);
  now = 1401;
  frame.run!();
  expect(scan).toHaveBeenCalledTimes(2);
});

it("invalidates the bounds immediately for a changed selection and layout", () => {
  const scan = vi.spyOn(graph, "traverse");
  render(<StudyViews />);
  frame.run!();
  act(() => useSceneStore.setState({ selectedOrganIds: ["a", "b"] }));
  now += 1;
  frame.run!();
  expect(scan).toHaveBeenCalledTimes(2);
  act(() => useStudyViewsStore.setState({ active: ["anterior"] }));
  now += 1;
  frame.run!();
  expect(scan).toHaveBeenCalledTimes(3);
});
