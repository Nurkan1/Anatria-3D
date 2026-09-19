import * as THREE from "three";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";

import { placeOnCortex, type MemoryKind } from "../memories";
import { loadBrain, type Brain, type BrainStructure } from "./brainLoader";
import { floorGrid, orbitRings, projector } from "./environment";
import { brainMaterial, brainPoints, LOOK, RegionLight } from "./hologram";
import { floatName, nameplate } from "./nameplate";
import { createPost } from "./post";
import { classifyAdapter, FrameGovernor, LEVELS, startingLevel, type Adapter } from "./quality";

/**
 * The Memory Lab's hologram: a brain with the study journal laid on it.
 *
 * Every memory is a point of light on the cortex, and a thread joins them in
 * the order they happened, winding up and forward from the back of the brain.
 * On opening, the brain is projected and the memories are mapped one after
 * another along the thread; after that it is live — point at one to see what
 * it is, click to open it, drag to turn the brain.
 *
 * Framework-free like the screensaver it grew from: React drives the panels
 * around it through the handle this returns and the callbacks it takes.
 */

export type LabPhase = "boot" | "deploy" | "materialize" | "mapping" | "live";

/** What the page should know about how the hologram is running. */
export interface GraphicsStatus {
  adapter: Adapter;
  /** Index into LEVELS: the last is the full lab. */
  level: number;
  /** True while the machine could not hold the starting level and it stepped down. */
  eased: boolean;
  /** The graphics card dropped the hologram and it has not come back yet. */
  lost: boolean;
}

export interface SceneMemory {
  key: string;
  kind: MemoryKind;
}

export interface MemorySceneOptions {
  meshUrl: string;
  structures: readonly BrainStructure[];
  dracoPath: string;
  memories: readonly SceneMemory[];
  reducedMotion?: boolean;
  onHover?: (key: string | null) => void;
  onSelect?: (key: string | null) => void;
  /** The opening sequence: which phase, and how many memories are mapped so far. */
  onPhase?: (phase: LabPhase, mapped: number) => void;
  onError?: (error: unknown) => void;
  onGraphics?: (status: GraphicsStatus) => void;
}

export interface FocusMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Another scene drawn into part of the screen by this one's renderer, before
 * the bloom and film, so it is lit exactly like the brain.
 *
 * One renderer rather than a second canvas: a second WebGL canvas has to be
 * blended over this one by the page compositor, and on some GPUs that showed
 * as a black box and as the whole window blinking.
 */
export interface SceneLayer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Where to draw, in CSS pixels from the lab's top-left; null to skip a frame. */
  rect(): { left: number; top: number; width: number; height: number } | null;
  /**
   * Called each frame just before drawing, with the drawing's aspect, its pixel
   * ratio and the share of particles the current quality level draws.
   */
  update(now: number, aspect: number, pixelRatio: number, particles: number): void;
}

export interface MemoryScene {
  select(key: string | null): void;
  /** Dissolve a memory. It can still come back with `restore` until `forget`. */
  erase(key: string): void;
  restore(key: string): void;
  /** Screen position of a memory in CSS pixels, for a label; null if hidden. */
  screenPosition(key: string): { x: number; y: number } | null;
  /** Jump straight to the live brain. */
  skipIntro(): void;
  /**
   * The space the panels leave free, as margins in CSS pixels from each edge.
   * The brain glides to the middle of it and shrinks to fit, so it is never
   * behind a panel on a small screen.
   */
  setFocus(margins: FocusMargins): void;
  /** Draw another scene into part of the screen. Returns what takes it away again. */
  addLayer(layer: SceneLayer): () => void;
  /** Focus: the film grain and fringing off, for reading. Every animation stays. */
  setFilm(on: boolean): void;
  dispose(): void;
}

const INTRO = { boot: 1.1, deploy: 2.4, materialize: 1.4 } as const;
/** Seconds to map each memory, within a floor and a ceiling for the whole run. */
const PER_MEMORY_S = 0.22;
const MAPPING_MIN_S = 3;
const MAPPING_MAX_S = 12;
/** How close, in pixels, the pointer must come to pick a memory. */
const PICK_PX = 18;
const ERASE_S = 1.6;
const BURST = 240;

const KIND_COLOUR: Record<MemoryKind, THREE.Color> = {
  session: new THREE.Color("#56e1ff"),
  case: new THREE.Color("#ffb347"),
  note: new THREE.Color("#c29bff"),
};

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function createMemoryScene(container: HTMLElement, options: MemorySceneOptions): MemoryScene {
  const reducedMotion =
    options.reducedMotion ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const count = options.memories.length;
  const indexOf = new Map(options.memories.map((memory, i) => [memory.key, i]));
  const mappingSeconds = Math.min(MAPPING_MAX_S, Math.max(MAPPING_MIN_S, count * PER_MEMORY_S));
  const introEnd = INTRO.boot + INTRO.deploy + INTRO.materialize;
  const sequenceEnd = introEnd + mappingSeconds;

  // Throws where there is no WebGL at all; the page catches it and keeps the
  // lab readable without the hologram.
  //
  // No antialias: everything is drawn into the composer's own buffers, which do
  // not use the canvas's multisampling, so it only cost memory and bandwidth.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x010408, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "ml-gl";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
  const post = createPost(renderer, scene, camera);

  // --- a safety net, not a setting: the full lab unless the machine cannot keep up.
  // The lab is built to cost little (under a millisecond a frame on a mid-range
  // card, measured), so on almost every machine this never moves. It exists so a
  // machine that genuinely cannot keep up stutters for two seconds, not forever.
  const adapter = classifyAdapter(rendererName(renderer));
  const ceiling = startingLevel(adapter);
  const governor = new FrameGovernor(ceiling);
  let level = -1;
  let lost = false;
  const report = () => options.onGraphics?.({ adapter, level, eased: level < ceiling, lost });
  const applyLevel = (next: number) => {
    if (next === level) return;
    level = next;
    const settings = LEVELS[level]!;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatio));
    post.composer.setPixelRatio(renderer.getPixelRatio());
    post.setBloomScale(settings.bloom);
    resize();
    if (dust) dust.geometry.setDrawRange(0, Math.round(dustCount * settings.particles));
    report();
  };

  // A graphics card can drop the context (a driver reset, a sleeping laptop).
  // Asking to keep it lets the renderer rebuild everything when it comes back.
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    report();
  };
  const onRestored = () => {
    lost = false;
    report();
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);
  renderer.domElement.addEventListener("webglcontextrestored", onRestored);

  const layers = new Set<SceneLayer>();
  const layerPass = new LayerPass(
    layers,
    container,
    () => performance.now() / 1000,
    () => LEVELS[Math.max(0, level)]!.particles,
  );
  // Straight after the brain is drawn, so bloom and film treat both the same.
  post.composer.insertPass(layerPass, 1);
  const grid = floorGrid();
  const base = projector();
  const rings = orbitRings();
  const holder = new THREE.Group();
  const name = nameplate();
  scene.add(grid, base, rings, holder, name);

  // Memory nodes, thread and erase burst: made once the brain is in.
  let brain: Brain | null = null;
  let surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let nodes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let thread: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let burst: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let positions: THREE.Vector3[] = [];
  const presence = new Float32Array(Math.max(1, count)).fill(1);
  const erasing = new Map<number, { from: number; to: number; started: number }>();
  const light = new RegionLight(1);

  let started: number | null = null;
  let offset = 0;
  let hovered = -1;
  let selected = -1;
  let spin = 0;
  let focus: FocusMargins = { left: 0, right: 0, top: 0, bottom: 0 };
  /** Where the framing is now: screen offset of the brain and its zoom, eased. */
  const framing = { x: 0, y: 0, zoom: 1 };
  let lastPhase: LabPhase | null = null;
  let lastMapped = -1;
  let disposed = false;
  let frame = 0;
  let lastFrame = 0;
  const dustCount = reducedMotion ? 10000 : 20000;

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    post.setSize(width, height);
    camera.aspect = width / height;
    camera.fov = width / height < 1.2 ? 42 : 30;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  applyLevel(governor.level);

  (async () => {
    try {
      const loaded = await loadBrain({ meshUrl: options.meshUrl, structures: options.structures, dracoPath: options.dracoPath });
      if (disposed) {
        loaded.geometry.dispose();
        return;
      }
      brain = loaded;
      surface = new THREE.Mesh(brain.geometry, brainMaterial(light));
      dust = brainPoints(brain.geometry, dustCount);
      dust.geometry.setDrawRange(0, Math.round(dustCount * LEVELS[level]!.particles));
      dust.material.uniforms.uRegions!.value = light.texture;
      holder.add(surface, dust);
      positions = cortexPlaces(brain, count);
      nodes = memoryNodes(positions, options.memories);
      thread = memoryThread(positions);
      burst = eraseBurst();
      holder.add(thread, nodes, burst);
      started = performance.now() / 1000;
    } catch (error) {
      options.onError?.(error);
    }
  })();

  // --- pointer: hover, click, drag to turn -------------------------------
  let pressed: { x: number; y: number; spin: number } | null = null;
  let dragged = false;
  const toLocal = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const nearest = (x: number, y: number): number => {
    let best = -1;
    let bestDistance = PICK_PX;
    positions.forEach((_, i) => {
      if (presence[i]! < 0.5 || !mappedYet(i)) return;
      const at = project(i);
      if (!at) return;
      const distance = Math.hypot(at.x - x, at.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  };
  const onDown = (event: PointerEvent) => {
    const at = toLocal(event);
    pressed = { x: at.x, y: at.y, spin };
    dragged = false;
  };
  const onMove = (event: PointerEvent) => {
    const at = toLocal(event);
    if (pressed) {
      const dx = at.x - pressed.x;
      if (Math.abs(dx) > 4) dragged = true;
      if (dragged) spin = pressed.spin + dx * 0.006;
      return;
    }
    const found = nearest(at.x, at.y);
    if (found !== hovered) {
      hovered = found;
      renderer.domElement.style.cursor = found >= 0 ? "pointer" : "grab";
      options.onHover?.(found >= 0 ? options.memories[found]!.key : null);
    }
  };
  const onUp = (event: PointerEvent) => {
    // Only a press that began on the hologram. The panels sit over the same
    // window, and a click on one of their buttons must not also deselect.
    if (!pressed) return;
    const wasDrag = dragged;
    pressed = null;
    dragged = false;
    if (wasDrag) return;
    const at = toLocal(event);
    const found = nearest(at.x, at.y);
    selected = found;
    options.onSelect?.(found >= 0 ? options.memories[found]!.key : null);
  };
  const canvas = renderer.domElement;
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  const worldPoint = new THREE.Vector3();
  function project(i: number): { x: number; y: number } | null {
    const position = positions[i];
    if (!position) return null;
    worldPoint.copy(position).applyMatrix4(holder.matrixWorld).project(camera);
    if (worldPoint.z > 1) return null;
    return {
      x: (worldPoint.x * 0.5 + 0.5) * container.clientWidth,
      y: (-worldPoint.y * 0.5 + 0.5) * container.clientHeight,
    };
  }

  function elapsed(): number {
    return started === null ? 0 : performance.now() / 1000 - started + offset;
  }
  function mappedCount(t: number): number {
    if (t < introEnd) return 0;
    return Math.min(count, Math.floor(((t - introEnd) / mappingSeconds) * count) + 1);
  }
  function mappedYet(i: number): boolean {
    return i < mappedCount(elapsed());
  }

  /**
   * Put the brain in the middle of the free space and fit it there.
   *
   * A view offset slides the picture without moving the camera, so the
   * perspective stays the one the scene was designed for; the zoom then fits
   * the brain to the smaller of the free width and height. Both ease towards
   * their target, so opening a panel reads as the hologram making room.
   */
  function frame_(width: number, height: number) {
    const freeW = Math.max(120, width - focus.left - focus.right);
    const freeH = Math.max(120, height - focus.top - focus.bottom);
    const centreX = focus.left + freeW / 2;
    const centreY = focus.top + freeH / 2;
    // How big the brain is on screen at zoom 1, from the camera's own geometry.
    const distance = camera.position.length();
    const pixelsPerUnit = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance);
    const needed = FRAME_RADIUS * 2 * pixelsPerUnit;
    const zoom = Math.min(1, Math.max(0.45, Math.min(freeW, freeH) / needed));
    const ease = 0.08;
    framing.x += (width / 2 - centreX - framing.x) * ease;
    framing.y += (height / 2 - centreY - framing.y) * ease;
    framing.zoom += (zoom - framing.zoom) * ease;
    camera.zoom = framing.zoom;
    camera.setViewOffset(width, height, framing.x, framing.y, width, height);
    camera.updateProjectionMatrix();
  }

  // --- the frame -----------------------------------------------------------
  const render = () => {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    const now = performance.now() / 1000;
    const t = elapsed();

    // Judge speed only once the brain is in: loading stalls are not slowness.
    const dt = (now - lastFrame) * 1000;
    lastFrame = now;
    if (started !== null && t > INTRO.boot && !lost) {
      const next = governor.sample(dt);
      if (next !== null) applyLevel(next);
    }

    const phase: LabPhase =
      started === null || t < INTRO.boot
        ? "boot"
        : t < INTRO.boot + INTRO.deploy
          ? "deploy"
          : t < introEnd
            ? "materialize"
            : t < sequenceEnd
              ? "mapping"
              : "live";
    const mapped = mappedCount(t);
    if (phase !== lastPhase || mapped !== lastMapped) {
      lastPhase = phase;
      lastMapped = mapped;
      options.onPhase?.(phase, mapped);
    }

    const gridFade = smooth(t / INTRO.boot);
    const assemble = smooth((t - INTRO.boot) / INTRO.deploy);
    const reveal = smooth((t - INTRO.boot - INTRO.deploy) / INTRO.materialize);
    // The name sweeps in as the projection deploys, before the brain is solid.
    floatName(name, camera, now, smooth((t - INTRO.boot - 0.4) / 1.6));

    // A slow orbit, and the brain turning unless someone is reading it.
    const calm = reducedMotion ? 0.35 : 1;
    const orbit = now * 0.03 * calm;
    camera.position.set(Math.sin(orbit) * 0.8, 0.45 + Math.sin(now * 0.1) * 0.12, 5.6);
    camera.lookAt(0, 0.02, 0);
    frame_(container.clientWidth, container.clientHeight);
    if (!pressed && hovered < 0 && selected < 0) spin += 0.0012 * calm;
    holder.rotation.y = spin;
    holder.updateMatrixWorld();

    for (const material of [grid.material, ...base.children.map((child) => (child as THREE.Mesh).material)] as THREE.ShaderMaterial[]) {
      material.uniforms.uFade!.value = gridFade;
      material.uniforms.uTime!.value = now;
    }
    rings.children.forEach((ring, i) => {
      ring.rotation.z = now * (ring.userData.spin as number) * calm + i;
      const material = (ring as THREE.LineLoop).material as THREE.ShaderMaterial;
      material.uniforms.uFade!.value = assemble * 0.7;
      material.uniforms.uTime!.value = now;
    });

    if (brain && surface && dust && nodes && thread && burst) {
      const u = surface.material.uniforms;
      u.uTime!.value = now;
      u.uReveal!.value = reveal;
      u.uScanOn!.value = phase === "mapping" ? 1 : 0;
      u.uScanY!.value = brain.bottom + (brain.top - brain.bottom) * ((t - introEnd) / mappingSeconds);

      const d = dust.material.uniforms;
      d.uTime!.value = now;
      d.uAssemble!.value = assemble;
      d.uDust!.value = 1 - reveal * 0.9;
      d.uPixel!.value = renderer.getPixelRatio() * (container.clientHeight / 900);

      // Erasing and restoring: presence eases between its ends.
      if (erasing.size > 0) {
        const presenceAttribute = nodes.geometry.getAttribute("presence") as THREE.BufferAttribute;
        for (const [i, change] of erasing) {
          const k = smooth((now - change.started) / ERASE_S);
          presence[i] = change.from + (change.to - change.from) * k;
          presenceAttribute.setX(i, presence[i]!);
          if (k >= 1) erasing.delete(i);
        }
        presenceAttribute.needsUpdate = true;
        updateThreadPresence(thread, presence);
      }

      const n = nodes.material.uniforms;
      n.uTime!.value = now;
      n.uShown!.value = phase === "live" ? count : mapped;
      n.uHover!.value = hovered;
      n.uSelected!.value = selected;
      n.uPixel!.value = renderer.getPixelRatio();
      n.uFade!.value = reveal;
      const th = thread.material.uniforms;
      th.uShown!.value = phase === "live" ? count : Math.max(0, ((t - introEnd) / mappingSeconds) * count);
      th.uTime!.value = now;
      th.uFade!.value = reveal;
      const b = burst.material.uniforms;
      b.uTime!.value = now;
      b.uPixel!.value = renderer.getPixelRatio();
    }

    (post.film.uniforms.uTime as { value: number }).value = now;
    post.composer.render();
  };
  frame = requestAnimationFrame(render);

  return {
    select(key) {
      selected = key === null ? -1 : (indexOf.get(key) ?? -1);
    },
    erase(key) {
      const i = indexOf.get(key);
      if (i === undefined || !burst) return;
      const now = performance.now() / 1000;
      erasing.set(i, { from: presence[i]!, to: 0, started: now });
      fireBurst(burst, positions[i]!, now, KIND_COLOUR[options.memories[i]!.kind]);
      if (selected === i) selected = -1;
    },
    restore(key) {
      const i = indexOf.get(key);
      if (i === undefined) return;
      erasing.set(i, { from: presence[i]!, to: 1, started: performance.now() / 1000 });
    },
    screenPosition(key) {
      const i = indexOf.get(key);
      return i === undefined || presence[i]! < 0.3 ? null : project(i);
    },
    setFocus(margins) {
      focus = margins;
    },
    setFilm(on) {
      post.setFilm(on);
    },
    addLayer(layer) {
      layers.add(layer);
      return () => layers.delete(layer);
    },

    skipIntro() {
      if (started !== null && elapsed() < sequenceEnd) offset += sequenceEnd - elapsed();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      light.dispose();
      layers.clear();
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

/** The graphics adapter's own name, where the browser will say it. */
function rendererName(renderer: THREE.WebGLRenderer): string | null {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return null;
  }
}

/** Draws each layer into its own rectangle of the frame the brain was drawn into. */
class LayerPass extends Pass {
  constructor(
    private readonly layers: ReadonlySet<SceneLayer>,
    private readonly container: HTMLElement,
    private readonly clock: () => number,
    private readonly particles: () => number,
  ) {
    super();
    this.needsSwap = false;
    this.clear = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    if (this.layers.size === 0) return;
    const cssWidth = Math.max(1, this.container.clientWidth);
    const cssHeight = Math.max(1, this.container.clientHeight);
    const ratio = read.width / cssWidth;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    for (const layer of this.layers) {
      const r = layer.rect();
      if (!r || r.width < 2 || r.height < 2) continue;
      layer.update(this.clock(), r.width / r.height, ratio, this.particles());
      // Render targets count from the bottom, in device pixels.
      const x = Math.round(r.left * ratio);
      const y = Math.round((cssHeight - r.top - r.height) * ratio);
      const w = Math.round(r.width * ratio);
      const h = Math.round(r.height * ratio);
      read.viewport.set(x, y, w, h);
      read.scissor.set(x, y, w, h);
      read.scissorTest = true;
      renderer.setRenderTarget(this.renderToScreen ? null : read);
      renderer.clearDepth();
      renderer.render(layer.scene, layer.camera);
    }
    read.viewport.set(0, 0, read.width, read.height);
    read.scissor.set(0, 0, read.width, read.height);
    read.scissorTest = false;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.autoClear = autoClear;
  }
}

/** Brain radius in unit space, with room for the thread and labels around it. */
const FRAME_RADIUS = 1.4;

/** Points on the cerebral cortex, one per memory, in the order of the path. */
function cortexPlaces(brain: Brain, count: number): THREE.Vector3[] {
  const position = brain.geometry.getAttribute("position") as THREE.BufferAttribute;
  const region = brain.geometry.getAttribute("region") as THREE.BufferAttribute;
  const cerebrum = new Set(brain.regions.map((r, i) => (r.division === "Cerebrum" ? i : -1)).filter((i) => i >= 0));
  const step = Math.max(1, Math.floor(position.count / 12000));
  const candidates: number[] = [];
  for (let v = 0; v < position.count; v += step) {
    if (cerebrum.size > 0 && !cerebrum.has(region.getX(v))) continue;
    candidates.push(position.getX(v), position.getY(v), position.getZ(v));
  }
  return placeOnCortex(count, candidates).map((p) =>
    new THREE.Vector3(candidates[p * 3]!, candidates[p * 3 + 1]!, candidates[p * 3 + 2]!).multiplyScalar(1.02),
  );
}

function memoryNodes(positions: THREE.Vector3[], memories: readonly SceneMemory[]) {
  const count = Math.max(1, positions.length);
  const xyz = new Float32Array(count * 3);
  const colour = new Float32Array(count * 3);
  const order = new Float32Array(count);
  const presence = new Float32Array(count).fill(1);
  positions.forEach((p, i) => {
    p.toArray(xyz, i * 3);
    KIND_COLOUR[memories[i]!.kind].toArray(colour, i * 3);
    order[i] = i;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
  geometry.setAttribute("colour", new THREE.BufferAttribute(colour, 3));
  geometry.setAttribute("order", new THREE.BufferAttribute(order, 1));
  geometry.setAttribute("presence", new THREE.BufferAttribute(presence, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uShown: { value: 0 },
      uHover: { value: -1 },
      uSelected: { value: -1 },
      uPixel: { value: 1 },
      uFade: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 colour;
      attribute float order;
      attribute float presence;
      uniform float uTime;
      uniform float uShown;
      uniform float uHover;
      uniform float uSelected;
      uniform float uPixel;
      uniform float uFade;
      varying vec3 vColour;
      varying float vAlpha;
      varying float vRing;
      void main() {
        float shown = step(order, uShown - 0.5);
        // The newest one mapped flares as it arrives, then settles.
        float arriving = exp(-pow(max(0.0, uShown - 1.0 - order) * 1.6, 2.0));
        float focus = max(step(abs(order - uHover), 0.1), step(abs(order - uSelected), 0.1));
        vRing = step(abs(order - uSelected), 0.1);
        vColour = colour;
        float breathe = 0.85 + 0.15 * sin(uTime * 1.3 + order * 0.7);
        vAlpha = shown * presence * uFade * breathe * (0.75 + 0.25 * focus);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uPixel * (13.0 + arriving * 12.0 + focus * 10.0 + vRing * 12.0) * (5.6 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColour;
      varying float vAlpha;
      varying float vRing;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        float core = exp(-r * r * 9.0);
        float halo = exp(-r * 3.0) * 0.35;
        float ring = vRing * smoothstep(0.08, 0.0, abs(r - 0.82));
        gl_FragColor = vec4(vColour * (core + halo + ring) * vAlpha, 1.0);
      }
    `,
  });
  return new THREE.Points(geometry, material);
}

/** Arcs between consecutive memories, lifted a little off the cortex. */
const THREAD_STEPS = 14;
function memoryThread(positions: THREE.Vector3[]) {
  const pairs = Math.max(0, positions.length - 1);
  const vertices = Math.max(2, pairs * THREAD_STEPS * 2);
  const xyz = new Float32Array(vertices * 3);
  const along = new Float32Array(vertices);
  const ends = new Float32Array(vertices * 2);
  const presence = new Float32Array(vertices).fill(1);
  const point = new THREE.Vector3();
  for (let i = 0; i < pairs; i++) {
    const a = positions[i]!;
    const b = positions[i + 1]!;
    const middle = a.clone().add(b).multiplyScalar(0.5);
    const lift = middle.clone().normalize().multiplyScalar(0.06 + a.distanceTo(b) * 0.25);
    const curve = new THREE.QuadraticBezierCurve3(a, middle.add(lift), b);
    for (let k = 0; k < THREAD_STEPS; k++) {
      for (const [slot, f] of [[0, k / THREAD_STEPS], [1, (k + 1) / THREAD_STEPS]] as const) {
        const v = (i * THREAD_STEPS + k) * 2 + slot;
        curve.getPoint(f, point).toArray(xyz, v * 3);
        along[v] = i + f;
        ends[v * 2] = i;
        ends[v * 2 + 1] = i + 1;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
  geometry.setAttribute("along", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("ends", new THREE.BufferAttribute(ends, 2));
  geometry.setAttribute("presence", new THREE.BufferAttribute(presence, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uShown: { value: 0 }, uTime: { value: 0 }, uFade: { value: 0 }, uCyan: { value: LOOK.cyan } },
    vertexShader: /* glsl */ `
      attribute float along;
      attribute float presence;
      varying float vAlong;
      varying float vPresence;
      void main() {
        vAlong = along;
        vPresence = presence;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uShown;
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uCyan;
      varying float vAlong;
      varying float vPresence;
      void main() {
        float lead = uShown - 1.0;
        if (vAlong > lead) discard;
        float head = exp(-pow((lead - vAlong) * 3.0, 2.0));
        // A slow pulse runs along the finished thread, oldest to newest.
        float pulse = exp(-pow(mod(vAlong - uTime * 1.2, 24.0) - 12.0, 2.0) * 0.5) * 0.5;
        float a = (0.18 + head * 0.8 + pulse * 0.3) * vPresence * uFade;
        gl_FragColor = vec4(uCyan * a, 1.0);
      }
    `,
  });
  return new THREE.LineSegments(geometry, material);
}

/** The thread fades where either of its two memories is fading. */
function updateThreadPresence(thread: THREE.LineSegments, presence: Float32Array) {
  const geometry = thread.geometry;
  const ends = geometry.getAttribute("ends") as THREE.BufferAttribute;
  const attribute = geometry.getAttribute("presence") as THREE.BufferAttribute;
  for (let v = 0; v < attribute.count; v++) {
    attribute.setX(v, Math.min(presence[ends.getX(v)] ?? 1, presence[ends.getY(v)] ?? 1));
  }
  attribute.needsUpdate = true;
}

/** Particles a memory breaks into when it is erased. */
function eraseBurst() {
  const xyz = new Float32Array(BURST * 3);
  const direction = new Float32Array(BURST * 3);
  const seed = new Float32Array(BURST);
  for (let i = 0; i < BURST; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    v.toArray(direction, i * 3);
    seed[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
  geometry.setAttribute("direction", new THREE.BufferAttribute(direction, 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uStart: { value: -100 },
      uOrigin: { value: new THREE.Vector3() },
      uColour: { value: new THREE.Color() },
      uPixel: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 direction;
      attribute float seed;
      uniform float uTime;
      uniform float uStart;
      uniform vec3 uOrigin;
      uniform float uPixel;
      varying float vAlpha;
      void main() {
        float age = (uTime - uStart) / (1.2 + seed * 1.2);
        vAlpha = age < 0.0 || age > 1.0 ? 0.0 : (1.0 - age) * (1.0 - age);
        vec3 p = uOrigin + direction * (0.05 + seed * 0.5) * (1.0 - pow(1.0 - clamp(age, 0.0, 1.0), 3.0));
        p.y += age * age * 0.15;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uPixel * (2.0 + seed * 3.0) * (5.6 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (dot(c, c) > 0.25) discard;
        gl_FragColor = vec4(uColour * vAlpha * 0.9, 1.0);
      }
    `,
  });
  return new THREE.Points(geometry, material);
}

function fireBurst(burst: THREE.Points, at: THREE.Vector3, now: number, colour: THREE.Color) {
  const u = (burst.material as THREE.ShaderMaterial).uniforms;
  u.uStart!.value = now;
  (u.uOrigin!.value as THREE.Vector3).copy(at);
  (u.uColour!.value as THREE.Color).copy(colour);
}
