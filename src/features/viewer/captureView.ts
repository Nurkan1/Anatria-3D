import * as THREE from "three";
import type { ViewerHandle } from "./viewerBridge";

/** Capture the principal view without borrowing its panel-shaped projection. */
export function captureView<T>(handle: ViewerHandle, consume: (camera: THREE.Camera) => T): T {
  const { gl, scene, camera } = handle;
  const viewport = gl.getViewport(new THREE.Vector4());
  const scissor = gl.getScissor(new THREE.Vector4());
  const scissorTest = gl.getScissorTest();
  const target = gl.getRenderTarget();
  const face = gl.getActiveCubeFace();
  const level = gl.getActiveMipmapLevel();
  const autoClear = gl.autoClear;
  const size = gl.getSize(new THREE.Vector2());
  camera.updateWorldMatrix(true, false);
  const exported = camera.clone();
  camera.matrixWorld.decompose(exported.position, exported.quaternion, exported.scale);
  if (exported instanceof THREE.PerspectiveCamera) {
    exported.aspect = gl.domElement.width / gl.domElement.height;
    exported.updateProjectionMatrix();
  }
  exported.updateMatrixWorld(true);

  try {
    gl.setRenderTarget(null);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.x, size.y);
    gl.autoClear = true;
    gl.render(scene, exported);
    // Pixels must be consumed synchronously, before the browser presents them.
    return consume(exported);
  } finally {
    gl.setRenderTarget(target, face, level);
    gl.setViewport(viewport);
    gl.setScissor(scissor);
    gl.setScissorTest(scissorTest);
    gl.autoClear = autoClear;
  }
}
