import { beforeEach, expect, it, vi } from "vitest";
import { Material, MeshStandardMaterial, ShaderLib, UniformsUtils, type WebGLRenderer } from "three";

import { advanceScanBand, resetScanBand, scanBandMaterialProps, scanBandOnBeforeCompile, SHARED_SCAN } from "./scanBand";

function shader() {
  return {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
  } as Parameters<Material["onBeforeCompile"]>[0];
}
beforeEach(resetScanBand);

it("uses the same callback and default cache key for two separate materials", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true));
  expect(first).not.toBe(second);
  expect(first.onBeforeCompile).toBe(scanBandOnBeforeCompile);
  expect(second.onBeforeCompile).toBe(first.onBeforeCompile);
  expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
  expect(first.customProgramCacheKey).toBe(Material.prototype.customProgramCacheKey);
});

it("binds exactly the same uniform object into two independent shader objects", () => {
  const first = new MeshStandardMaterial(scanBandMaterialProps(true));
  const second = new MeshStandardMaterial(scanBandMaterialProps(true));
  const a = shader();
  const b = shader();
  first.onBeforeCompile(a, {} as WebGLRenderer);
  second.onBeforeCompile(b, {} as WebGLRenderer);
  expect(a.uniforms.uScanY).toBe(SHARED_SCAN);
  expect(b.uniforms.uScanY).toBe(a.uniforms.uScanY);
  expect(a.vertexShader).toBe(b.vertexShader);
  expect(a.fragmentShader).toBe(b.fragmentShader);
});

it("writes the shared value once per advance regardless of attached materials", () => {
  const a = shader();
  const b = shader();
  scanBandOnBeforeCompile(a);
  scanBandOnBeforeCompile(b);
  let value = SHARED_SCAN.value;
  const write = vi.fn((next: number) => { value = next; });
  Object.defineProperty(SHARED_SCAN, "value", { configurable: true, get: () => value, set: write });
  try {
    advanceScanBand(3, -1, 1);
    expect(write).toHaveBeenCalledExactlyOnceWith(0);
    expect(a.uniforms.uScanY?.value).toBe(0);
    expect(b.uniforms.uScanY?.value).toBe(0);
  } finally {
    Object.defineProperty(SHARED_SCAN, "value", { configurable: true, writable: true, value });
  }
});

it("goes from feet to head and back without walking any materials", () => {
  advanceScanBand(0, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
  advanceScanBand(6, -1, 1);
  expect(SHARED_SCAN.value).toBe(1);
  advanceScanBand(3, -1, 1);
  expect(SHARED_SCAN.value).toBe(0);
  advanceScanBand(3, -1, 1);
  expect(SHARED_SCAN.value).toBe(-1);
});

it("does not assign onBeforeCompile at all when disabled, including after a toggle", () => {
  for (const enabled of [false, true, false]) {
    const props = scanBandMaterialProps(enabled);
    const material = new MeshStandardMaterial(props);
    expect(Object.hasOwn(props, "onBeforeCompile")).toBe(enabled);
    expect(Object.hasOwn(material, "onBeforeCompile")).toBe(enabled);
    if (!enabled) expect(material.onBeforeCompile).toBe(Material.prototype.onBeforeCompile);
    material.dispose();
  }
});

it("injects into the installed r185 chunks and fails explicitly if they change", () => {
  const input = shader();
  scanBandOnBeforeCompile(input);
  expect(input.vertexShader).toContain("(modelMatrix * vec4(transformed, 1.0)).y");
  expect(input.fragmentShader).toContain("totalEmissiveRadiance +=");
  expect(() => scanBandOnBeforeCompile({ ...shader(), vertexShader: "changed" })).toThrow(/chunks are missing/);
});
