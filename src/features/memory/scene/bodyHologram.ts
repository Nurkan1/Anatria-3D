import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { loadBrain, worldGeometry, type Brain, type BrainStructure } from "./brainLoader";
import { projector } from "./environment";
import { brainMaterial, brainPoints, RegionLight } from "./hologram";
import type { SceneLayer } from "./memoryScene";

/**
 * A whole body in the hologram's light, standing on a projector of its own
 * beside the brain.
 *
 * Only a figure to look at: it is drawn from the atlas's body-surface regions
 * (one skin-deep shell, so the lit edges read as a silhouette instead of
 * saturating the way a hundred nested organs would) and it does nothing to the
 * atlas or its viewport. It can be turned by dragging, and when a memory is
 * opened the structures it was about light up inside it, in amber, with a scan
 * running down to find them.
 *
 * A scene of its own, drawn by the brain's renderer into the rectangle of the
 * page element it is given, so the page can place it like a panel: the brain is
 * framed into whatever space is left, and a body standing in the brain's scene
 * would slide around with it. Not a canvas of its own: a second canvas has to
 * be blended over the first by the page, and on some GPUs that drew a black
 * box and made the whole window blink.
 */

export interface BodyHologramOptions {
  meshUrl: string;
  structures: readonly BrainStructure[];
  dracoPath: string;
  reducedMotion?: boolean;
  /** What draws it: the brain's scene. */
  host: { addLayer(layer: SceneLayer): () => void };
  /** The element everything is measured from — the one the host draws across. */
  frame: HTMLElement;
  /** Where a system's mesh file is, by its file name. */
  fileUrl: (file: string) => string;
  onError?: (error: unknown) => void;
}

/** A structure to light: the node that holds it, in which of the atlas's files. */
export interface OrganRef {
  id: string;
  node: string;
  file: string;
}

export interface BodyHologram {
  /** 1 is fully present; lower while something is laid over it. */
  setPresence(level: number): void;
  /**
   * Light these structures inside the figure, replacing any lit before; an
   * empty list puts them out. Resolves with the ids that were found and drawn.
   */
  show(organs: readonly OrganRef[]): Promise<string[]>;
  skipIntro(): void;
  dispose(): void;
}

const INTRO = { boot: 1.1, deploy: 2.4, materialize: 1.4 } as const;
const SCAN_S = 1.8;
/**
 * The surface's strength against the brain's. One shell instead of many, so it
 * needs more light per layer to be seen at all.
 */
const BODY_GAIN = 2.6;
/** How much of the projector's size the body's pad is: a figure stands on less than a brain floats over. */
const PAD_SCALE = 0.4;
/** Seconds for a structure to come up to full light. */
const ORGAN_IN_S = 0.9;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function createBodyHologram(container: HTMLElement, options: BodyHologramOptions): BodyHologram {
  const reducedMotion =
    options.reducedMotion ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  const pad = projector();
  pad.scale.setScalar(PAD_SCALE);
  const holder = new THREE.Group();
  scene.add(pad, holder);

  let body: Brain | null = null;
  let surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let light: RegionLight | null = null;
  let started: number | null = null;
  let offset = 0;
  let presence = 1;
  let shown = 1;
  let scanStarted = -100;
  let spin = 0;
  let disposed = false;
  let lit: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let litAt = 0;
  /** Bumped by every `show`, so a slow load cannot land over a newer one. */
  let request = 0;
  let loaded: Promise<void> = Promise.resolve();

  // The atlas's files, each loaded once and only when a structure in it is asked for.
  const draco = new DRACOLoader().setDecoderPath(options.dracoPath);
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  const files = new Map<string, Promise<Map<string, THREE.Object3D>>>();
  const nodesIn = (file: string) => {
    let nodes = files.get(file);
    if (!nodes) {
      nodes = gltf.loadAsync(options.fileUrl(file)).then((result) => {
        result.scene.updateMatrixWorld(true);
        const byName = new Map<string, THREE.Object3D>();
        result.scene.traverse((object) => byName.set(object.name, object));
        return byName;
      });
      // A file that failed is forgotten, so the next memory can try it again.
      nodes.catch(() => files.delete(file));
      files.set(file, nodes);
    }
    return nodes;
  };

  /** Everything is sized from the body: its height, and where its feet are. */
  const size = { height: 2, bottom: -1 };

  loaded = (async () => {
    try {
      const loaded = await loadBrain({ meshUrl: options.meshUrl, structures: options.structures, dracoPath: options.dracoPath });
      if (disposed) {
        loaded.geometry.dispose();
        return;
      }
      body = loaded;
      size.height = body.top - body.bottom;
      size.bottom = body.bottom;
      light = new RegionLight(body.regions.length);
      surface = new THREE.Mesh(body.geometry, brainMaterial(light));
      dust = brainPoints(body.geometry, reducedMotion ? 4000 : 9000, 11);
      dust.material.uniforms.uRegions!.value = light.texture;
      dust.material.uniforms.uRegionCount!.value = light.size;
      holder.add(surface, dust);
      // Feet on the pad.
      holder.position.y = -1.55 * PAD_SCALE - body.bottom + 0.02;
      pad.position.y = -1.55 * PAD_SCALE;
      started = performance.now() / 1000;
    } catch (error) {
      options.onError?.(error);
    }
  })();

  const putOut = () => {
    if (!lit) return;
    holder.remove(lit);
    lit.geometry.dispose();
    lit.material.dispose();
    lit = null;
  };

  // Drag to turn it. Nothing else happens in its column.
  let pressed: { x: number; spin: number } | null = null;
  container.style.cursor = "grab";
  const onDown = (event: PointerEvent) => {
    pressed = { x: event.clientX, spin };
    container.setPointerCapture(event.pointerId);
    container.style.cursor = "grabbing";
  };
  const onMove = (event: PointerEvent) => {
    if (pressed) spin = pressed.spin + (event.clientX - pressed.x) * 0.008;
  };
  const onUp = () => {
    pressed = null;
    container.style.cursor = "grab";
  };
  container.addEventListener("pointerdown", onDown);
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerup", onUp);
  container.addEventListener("pointercancel", onUp);

  const elapsed = () => (started === null ? 0 : performance.now() / 1000 - started + offset);

  const update = (now: number, aspect: number, pixelRatio: number) => {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const t = elapsed();
    const gridFade = smooth(t / INTRO.boot);
    const assemble = smooth((t - INTRO.boot) / INTRO.deploy);
    const reveal = smooth((t - INTRO.boot - INTRO.deploy) / INTRO.materialize);
    shown += (presence - shown) * 0.08;

    // Frame the whole figure and its pad, whatever the column's proportions.
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const tall = (size.height + 0.55) / 2;
    const wide = (1.8 * PAD_SCALE) / Math.max(0.2, camera.aspect);
    const distance = Math.max(tall, wide) / Math.tan(halfFov);
    const centreY = holder.position.y + size.bottom + size.height / 2 - 0.12;
    camera.position.set(0, centreY + distance * 0.08, distance);
    camera.lookAt(0, centreY, 0);

    const calm = reducedMotion ? 0.35 : 1;
    if (!pressed) spin += 0.0025 * calm;
    holder.rotation.y = spin;

    for (const child of pad.children) {
      const u = ((child as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
      u.uFade!.value = gridFade * shown;
      u.uTime!.value = now;
    }
    if (lit) {
      const u = lit.material.uniforms;
      u.uTime!.value = now;
      u.uIn!.value = smooth((now - litAt) / ORGAN_IN_S) * shown;
    }
    if (surface && dust && body) {
      const u = surface.material.uniforms;
      u.uTime!.value = now;
      u.uReveal!.value = reveal;
      // The skin steps back a little while something inside it is lit.
      u.uFade!.value = BODY_GAIN * shown * (lit ? 0.7 : 1);
      const k = (now - scanStarted) / SCAN_S;
      u.uScanOn!.value = k >= 0 && k <= 1 ? 1 : 0;
      u.uScanY!.value = body.top - (body.top - body.bottom) * smooth(k);
      const d = dust.material.uniforms;
      d.uTime!.value = now;
      d.uAssemble!.value = assemble;
      d.uDust!.value = (1 - reveal * 0.85) * shown;
      d.uPixel!.value = pixelRatio * (container.clientHeight / 700);
    }
  };

  const remove = options.host.addLayer({
    scene,
    camera,
    update,
    rect() {
      // Hidden (a small screen, or no memories): nothing to draw.
      if (container.offsetParent === null || container.classList.contains("ml-hidden")) return null;
      const box = container.getBoundingClientRect();
      const origin = options.frame.getBoundingClientRect();
      return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
    },
  });

  return {
    setPresence(level) {
      presence = Math.min(1, Math.max(0, level));
    },
    async show(organs) {
      const mine = ++request;
      if (organs.length === 0) {
        putOut();
        return [];
      }
      await loaded;
      if (disposed || mine !== request || !body) return [];
      const parts: THREE.BufferGeometry[] = [];
      const byFile = new Map<string, OrganRef[]>();
      for (const organ of organs) byFile.set(organ.file, [...(byFile.get(organ.file) ?? []), organ]);
      const found: string[] = [];
      for (const [file, refs] of byFile) {
        let names: Map<string, THREE.Object3D>;
        try {
          names = await nodesIn(file);
        } catch {
          continue; // One system that fails to load does not stop the others.
        }
        if (disposed || mine !== request) return [];
        for (const ref of refs) {
          const object = names.get(ref.node) ?? names.get(THREE.PropertyBinding.sanitizeNodeName(ref.node));
          if (!object) continue;
          found.push(ref.id);
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && mesh.geometry) parts.push(worldGeometry(mesh, 0));
          });
        }
      }
      putOut();
      if (parts.length === 0) return [];
      const merged = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!merged) return [];
      // Into the figure's own space: the same two steps the body went through.
      const { centre, scale } = body.normalise;
      merged.translate(-centre.x, -centre.y, -centre.z);
      merged.scale(scale, scale, scale);
      lit = new THREE.Mesh(merged, organMaterial());
      lit.renderOrder = 2;
      holder.add(lit);
      litAt = performance.now() / 1000;
      scanStarted = litAt;
      return found;
    },
    skipIntro() {
      const end = INTRO.boot + INTRO.deploy + INTRO.materialize;
      if (started !== null && elapsed() < end) offset += end - elapsed();
    },
    dispose() {
      disposed = true;
      remove();
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      putOut();
      draco.dispose();
      files.clear();
      light?.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
    },
  };
}

/**
 * A studied structure: amber, lit mostly at its edges so the shape reads, with
 * a slow pulse so it is plainly the thing being pointed at.
 */
function organMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uIn: { value: 0 },
      uAmber: { value: new THREE.Color("#ffb347") },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vY;
      void main() {
        vY = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIn;
      uniform vec3 uAmber;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vY;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float rim = pow(1.0 - facing, 2.2);
        float pulse = 0.8 + 0.2 * sin(uTime * 2.4);
        float lines = 0.85 + 0.15 * sin(vY * 220.0 - uTime * 2.0);
        float a = (0.05 + rim * 0.5) * pulse * lines * uIn;
        gl_FragColor = vec4(uAmber * a, 1.0);
      }
    `,
  });
}
