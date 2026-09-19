import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { loadBrain, worldGeometry, type Brain, type BrainStructure } from "./brainLoader";
import { projector } from "./environment";
import { brainMaterial, brainPoints, RegionLight } from "./hologram";
import { createPost } from "./post";

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
 * A canvas of its own rather than an object in the brain's scene, so the page
 * can place it like a panel: the brain is framed into whatever space is left,
 * and a body standing in that scene would slide around with it.
 */

export interface BodyHologramOptions {
  meshUrl: string;
  structures: readonly BrainStructure[];
  dracoPath: string;
  reducedMotion?: boolean;
  /** Where a system's mesh file is, by its file name. */
  fileUrl: (file: string) => string;
  onError?: (error: unknown) => void;
}

/** A structure to light: the node that holds it, in which of the atlas's files. */
export interface OrganRef {
  node: string;
  file: string;
}

export interface BodyHologram {
  /** 1 is fully present; lower while something is laid over it. */
  setPresence(level: number): void;
  /**
   * Light these structures inside the figure, replacing any lit before; an
   * empty list puts them out. Resolves with how many were found and drawn.
   */
  show(organs: readonly OrganRef[]): Promise<number>;
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  // True black: this canvas is screened over the room, and black is what adds nothing.
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "ml-body-gl";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  const post = createPost(renderer, scene, camera);
  // The room's canvas already has the film look. Grain and a vignette here too
  // would draw this column as a visible box over it.
  const film = post.film.uniforms as Record<string, { value: number }>;
  film.uGrain!.value = 0;
  film.uVignette!.value = 0;
  film.uAberration!.value = 0;
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
  let frame = 0;
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

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    post.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

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

  // Drag to turn it. Nothing else happens on this canvas.
  let pressed: { x: number; spin: number } | null = null;
  const canvas = renderer.domElement;
  canvas.style.cursor = "grab";
  const onDown = (event: PointerEvent) => {
    pressed = { x: event.clientX, spin };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  };
  const onMove = (event: PointerEvent) => {
    if (pressed) spin = pressed.spin + (event.clientX - pressed.x) * 0.008;
  };
  const onUp = () => {
    pressed = null;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  const elapsed = () => (started === null ? 0 : performance.now() / 1000 - started + offset);

  const render = () => {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    const now = performance.now() / 1000;
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
      d.uPixel!.value = renderer.getPixelRatio() * (container.clientHeight / 700);
    }
    (post.film.uniforms.uTime as { value: number }).value = now;
    post.composer.render();
  };
  frame = requestAnimationFrame(render);

  return {
    setPresence(level) {
      presence = Math.min(1, Math.max(0, level));
    },
    async show(organs) {
      const mine = ++request;
      if (organs.length === 0) {
        putOut();
        return 0;
      }
      await loaded;
      if (disposed || mine !== request || !body) return 0;
      const parts: THREE.BufferGeometry[] = [];
      const byFile = new Map<string, string[]>();
      for (const organ of organs) byFile.set(organ.file, [...(byFile.get(organ.file) ?? []), organ.node]);
      let found = 0;
      for (const [file, nodes] of byFile) {
        let names: Map<string, THREE.Object3D>;
        try {
          names = await nodesIn(file);
        } catch {
          continue; // One system that fails to load does not stop the others.
        }
        if (disposed || mine !== request) return 0;
        for (const node of nodes) {
          const object = names.get(node) ?? names.get(THREE.PropertyBinding.sanitizeNodeName(node));
          if (!object) continue;
          found += 1;
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && mesh.geometry) parts.push(worldGeometry(mesh, 0));
          });
        }
      }
      putOut();
      if (parts.length === 0) return 0;
      const merged = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!merged) return 0;
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
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
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
      post.dispose();
      renderer.dispose();
      canvas.remove();
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
