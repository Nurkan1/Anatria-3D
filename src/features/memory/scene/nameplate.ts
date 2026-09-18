import * as THREE from "three";

import { LOOK } from "./hologram";

/**
 * The name, projected above the brain in the hologram's own light.
 *
 * Drawn once to a canvas as an outline with a faint fill — the same line-work
 * the brain is drawn in — and shown on a plane that always turns to face the
 * viewer. It does not spin with the brain: a label that turns away from you
 * half the time is not a label. It sweeps in from the left as the projection
 * deploys, and drifts gently up and down after that.
 */

const WIDTH = 2048;
const HEIGHT = 256;

function drawName(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `200 150px "Bahnschrift", "Segoe UI", system-ui, sans-serif`;
  // Letter spacing where the canvas supports it; generous either way.
  (context as unknown as { letterSpacing?: string }).letterSpacing = "38px";
  const x = WIDTH / 2;
  const y = HEIGHT / 2 + 6;
  // A faint fill, then the outline that carries the shape.
  context.fillStyle = "rgba(86, 225, 255, 0.18)";
  context.fillText(text, x, y);
  context.lineWidth = 3;
  context.strokeStyle = "rgba(170, 240, 255, 1)";
  context.strokeText(text, x, y);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function nameplate(text = "ANATRIA 3D"): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uText: { value: drawName(text) },
      uReveal: { value: 0 },
      uTime: { value: 0 },
      uCyan: { value: LOOK.cyan },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uText;
      uniform float uReveal;
      uniform float uTime;
      uniform vec3 uCyan;
      varying vec2 vUv;
      void main() {
        float ink = texture2D(uText, vUv).a;
        // The sweep: a bright edge crossing left to right, the name behind it.
        float edge = uReveal * 1.2 - 0.1;
        float shown = smoothstep(edge, edge - 0.04, vUv.x);
        float front = exp(-pow((vUv.x - edge) * 40.0, 2.0)) * step(uReveal, 0.99);
        // Hologram lines drifting upward through the letters.
        float lines = 0.72 + 0.28 * sin(vUv.y * 90.0 - uTime * 2.0);
        float a = ink * shown * lines * 0.55 + front * 0.35 * ink + front * 0.05;
        gl_FragColor = vec4(uCyan * a, 1.0);
      }
    `,
  });
  const width = 1.9;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, (width * HEIGHT) / WIDTH), material);
  mesh.renderOrder = 5;
  return mesh;
}

/** Height above the brain's centre, in brain radii. */
export const NAME_HEIGHT = 1.28;

/** Place it for this frame: above the brain, bobbing, turned to the camera. */
export function floatName(mesh: THREE.Mesh, camera: THREE.Camera, now: number, reveal: number): void {
  mesh.position.set(0, NAME_HEIGHT + Math.sin(now * 0.6) * 0.025, 0);
  // Turn about the vertical only, so the name stays upright as the camera sways.
  const toCamera = Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z);
  mesh.rotation.set(0, toCamera, 0);
  const material = mesh.material as THREE.ShaderMaterial;
  material.uniforms.uReveal!.value = reveal;
  material.uniforms.uTime!.value = now;
}
