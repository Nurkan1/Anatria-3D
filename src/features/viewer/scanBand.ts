import type { Material } from "three";

/** PoC scaffolding only: one shared scalar, not one uniform per mesh. */
export const SHARED_SCAN = { value: 0 };
let elapsed = 0;

type Shader = Parameters<Material["onBeforeCompile"]>[0];

/** The same function object is attached to every experimental material. */
export function scanBandOnBeforeCompile(shader: Shader): void {
  const vertexChunk = "#include <project_vertex>";
  const fragmentChunk = "#include <emissivemap_fragment>";
  if (!shader.vertexShader.includes(vertexChunk) || !shader.fragmentShader.includes(fragmentChunk)) {
    throw new Error("Patient scan PoC: the expected Three r185 shader chunks are missing.");
  }
  shader.uniforms.uScanY = SHARED_SCAN;
  shader.vertexShader = "varying float vScanWorldY;\n" + shader.vertexShader.replace(
    vertexChunk,
    `${vertexChunk}\nvScanWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
  );
  shader.fragmentShader = "uniform float uScanY;\nvarying float vScanWorldY;\n" + shader.fragmentShader.replace(
    fragmentChunk,
    `${fragmentChunk}\nfloat scanBand = 1.0 - smoothstep(0.008, 0.025, abs(vScanWorldY - uScanY));
    totalEmissiveRadiance += vec3(0.1, 1.2, 1.5) * scanBand;`,
  );
}

const ON = Object.freeze({ onBeforeCompile: scanBandOnBeforeCompile });
const OFF = Object.freeze({});

/** Off means no callback prop at all, not an identity shader callback. */
export function scanBandMaterialProps(enabled: boolean) {
  return enabled ? ON : OFF;
}

export function resetScanBand(): void {
  elapsed = 0;
}

/** Called once by the scene per frame; feet -> head -> feet in twelve seconds. */
export function advanceScanBand(delta: number, minY: number, maxY: number): void {
  elapsed = (elapsed + delta) % 12;
  const progress = elapsed <= 6 ? elapsed / 6 : (12 - elapsed) / 6;
  SHARED_SCAN.value = minY + (maxY - minY) * progress;
}
