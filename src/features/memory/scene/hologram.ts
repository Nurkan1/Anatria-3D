import * as THREE from "three";

/**
 * The look of the hologram, gathered so it can be tuned without reading GLSL.
 *
 * Small numbers on purpose. The brain is a hundred-odd overlapping shells drawn
 * with added light, so every value is paid once per layer the eye looks
 * through — what is gentle on one surface is white on forty. Anatria3D's idle
 * screen learned that first; these start from its numbers.
 */
export const LOOK = {
  cyan: new THREE.Color("#3fd8ff"),
  deep: new THREE.Color("#1b6cff"),
  amber: new THREE.Color("#ffb347"),
  /** Strength of the whole surface. */
  opacity: 0.1,
  /** How tight the lit edge is. Higher keeps the inside clear. */
  rimSharpness: 4.6,
  /** A mapped region's own glow, on top of its rim. */
  regionGlow: 0.3,
  /** The scan line where the plane crosses the surface. */
  scanStrength: 0.22,
  scanWidth: 0.008,
  /**
   * The folds: the outline of every gyrus where it turns edge-on to the eye,
   * drawn as a thin line. It is what makes the cortex read as a brain and not
   * a glowing cloud. Measured from the viewing angle rather than from how fast
   * the normal turns: this atlas's triangles are smaller than a pixel, and a
   * derivative-based line lit the whole surface white.
   */
  contourSharpness: 14,
  contourStrength: 1.4,
  /** The bright edge of the dissolve as the surface materialises. */
  edgeStrength: 0.12,
  /**
   * How fast a shell's light falls off with distance behind the front of the
   * brain, per unit of depth.
   *
   * Added light has no idea how much of it is already there. Turned to a
   * certain angle, dozens of folds line up edge-on, their contours land on the
   * same pixels and the middle of the brain goes to white — burying the memory
   * points, which are the thing being looked at. Fading the far side, the way
   * anything seen through haze fades, keeps every line visible while removing
   * most of what piles up: it is depth the eye reads, not dimness.
   */
  depthFade: 0.85,
} as const;

/** Per-region light, one texel each, written by the scene every frame. */
export class RegionLight {
  readonly texture: THREE.DataTexture;
  readonly size: number;
  private readonly data: Float32Array;

  constructor(count: number) {
    this.size = Math.max(1, count);
    this.data = new Float32Array(this.size * 4);
    this.texture = new THREE.DataTexture(this.data, this.size, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  /** `level` is how lit, `current` 1 for the region being mapped now. */
  set(index: number, level: number, current: boolean): void {
    this.data[index * 4] = level;
    this.data[index * 4 + 1] = current ? 1 : 0;
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

const NOISE = /* glsl */ `
float nmHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float nmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nmHash(i), nmHash(i + vec3(1,0,0)), f.x),
                 mix(nmHash(i + vec3(0,1,0)), nmHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(nmHash(i + vec3(0,0,1)), nmHash(i + vec3(1,0,1)), f.x),
                 mix(nmHash(i + vec3(0,1,1)), nmHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

export function brainMaterial(regions: RegionLight): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uScanY: { value: -10 },
      uScanOn: { value: 0 },
      uFade: { value: 1 },
      uRegions: { value: regions.texture },
      uRegionCount: { value: regions.size },
      uCyan: { value: LOOK.cyan },
      uDeep: { value: LOOK.deep },
      uAmber: { value: LOOK.amber },
      /** Distance from the camera to the middle of the hologram. */
      uCentre: { value: 1000 },
    },
    vertexShader: /* glsl */ `
      attribute float region;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      varying float vRegion;
      varying float vDepth;
      void main() {
        vPos = position;
        vRegion = region;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uReveal;
      uniform float uScanY;
      uniform float uScanOn;
      uniform float uFade;
      uniform sampler2D uRegions;
      uniform float uRegionCount;
      uniform vec3 uCyan;
      uniform vec3 uDeep;
      uniform vec3 uAmber;
      uniform float uCentre;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      varying float vRegion;
      varying float vDepth;
      ${NOISE}
      void main() {
        // Materialising: a noisy threshold sweeps up through the surface.
        float n = nmNoise(vPos * 7.0) * 0.55 + (vPos.y + 1.0) * 0.225;
        float threshold = uReveal * 1.25 - 0.1;
        if (n > threshold) discard;
        float edge = smoothstep(0.06, 0.0, threshold - n) * step(uReveal, 0.999);

        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float rim = pow(1.0 - facing, ${LOOK.rimSharpness.toFixed(2)});

        vec4 light = texture2D(uRegions, vec2((vRegion + 0.5) / uRegionCount, 0.5));
        float level = light.r;
        float current = light.g;

        // Fine horizontal hologram lines, drifting slowly.
        float lines = 0.8 + 0.2 * sin(vPos.y * 180.0 - uTime * 1.5);

        float scan = uScanOn * exp(-pow((vPos.y - uScanY) / ${LOOK.scanWidth.toFixed(3)}, 2.0));
        float scanned = uScanOn * step(vPos.y, uScanY) * 0.15;

        vec3 base = mix(uDeep, uCyan, rim);
        // Mapped regions keep a warm tint; only the current one turns fully amber.
        vec3 colour = mix(base, uAmber, clamp(level * mix(0.9, 1.6, current), 0.0, 1.0));
        // Only the region being mapped adds real light. Mapped ones mostly shift
        // colour: a glow paid on every one of a hundred layers is a white brain.
        float glow = level * ${LOOK.regionGlow.toFixed(2)} * (0.4 + rim) * mix(0.25, 2.0, current);
        float contour = pow(1.0 - facing, ${LOOK.contourSharpness.toFixed(1)});
        // Haze: everything past the middle of the hologram gives less light,
        // so a hundred far shells cannot add up to the front one.
        float haze = exp(-max(0.0, vDepth - uCentre) * ${LOOK.depthFade.toFixed(2)});
        float alpha = ${LOOK.opacity.toFixed(3)} * (rim * (2.4 + scanned) * lines + glow + contour * ${LOOK.contourStrength.toFixed(2)}) * haze;
        vec3 outColour = colour * alpha
          + uCyan * scan * ${LOOK.scanStrength.toFixed(2)} * (0.25 + rim)
          + uCyan * edge * ${LOOK.edgeStrength.toFixed(2)} * rim;
        gl_FragColor = vec4(outColour * uFade, 1.0);
      }
    `,
  });
}

/**
 * The points the brain gathers from: each starts in a ring around the
 * projector and flies to a vertex of the brain, and scatters outward again at
 * the end.
 */
export function brainPoints(
  geometry: THREE.BufferGeometry,
  count: number,
  seed = 7,
): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const region = geometry.getAttribute("region") as THREE.BufferAttribute;
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const target = new Float32Array(count * 3);
  const start = new Float32Array(count * 3);
  const extra = new Float32Array(count * 3); // delay, twinkle phase, region
  for (let i = 0; i < count; i++) {
    const v = Math.floor(random() * position.count);
    target[i * 3] = position.getX(v);
    target[i * 3 + 1] = position.getY(v);
    target[i * 3 + 2] = position.getZ(v);
    // Rising from a ring on the projector below the brain.
    const angle = random() * Math.PI * 2;
    const radius = 1.2 + random() * 1.4;
    start[i * 3] = Math.cos(angle) * radius;
    start[i * 3 + 1] = -1.9 + random() * 0.2;
    start[i * 3 + 2] = Math.sin(angle) * radius;
    extra[i * 3] = random();
    extra[i * 3 + 1] = random() * Math.PI * 2;
    extra[i * 3 + 2] = region.getX(v);
  }

  const points = new THREE.BufferGeometry();
  points.setAttribute("position", new THREE.BufferAttribute(target, 3));
  points.setAttribute("start", new THREE.BufferAttribute(start, 3));
  points.setAttribute("extra", new THREE.BufferAttribute(extra, 3));
  points.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uAssemble: { value: 0 },
      uDisperse: { value: 0 },
      uDust: { value: 1 },
      uPixel: { value: 1 },
      uRegions: { value: null as THREE.Texture | null },
      uRegionCount: { value: 1 },
      uCyan: { value: LOOK.cyan },
      uAmber: { value: LOOK.amber },
    },
    vertexShader: /* glsl */ `
      attribute vec3 start;
      attribute vec3 extra;
      uniform float uTime;
      uniform float uAssemble;
      uniform float uDisperse;
      uniform float uPixel;
      uniform sampler2D uRegions;
      uniform float uRegionCount;
      varying float vAlpha;
      varying float vLevel;
      void main() {
        float delay = extra.x * 0.55;
        float t = clamp((uAssemble - delay) / 0.45, 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);
        // A spiral on the way up, so they arrive swirling rather than in lines.
        float swirl = (1.0 - t) * 2.2;
        vec3 from = vec3(start.x * cos(swirl) - start.z * sin(swirl), start.y, start.x * sin(swirl) + start.z * cos(swirl));
        vec3 p = mix(from, position, t);
        vec3 away = normalize(position + vec3(0.0001)) * (1.5 + extra.x * 2.5);
        p += away * uDisperse * uDisperse;

        vLevel = texture2D(uRegions, vec2((extra.z + 0.5) / uRegionCount, 0.5)).r;
        float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + extra.y);
        vAlpha = twinkle * (0.35 + 0.65 * t) * step(0.001, uAssemble) * (1.0 - uDisperse);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uPixel * (1.4 + vLevel * 1.2) * (3.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCyan;
      uniform vec3 uAmber;
      uniform float uDust;
      varying float vAlpha;
      varying float vLevel;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float soft = 1.0 - d * 4.0;
        vec3 colour = mix(uCyan, uAmber, clamp(vLevel * 1.5, 0.0, 1.0));
        gl_FragColor = vec4(colour * soft * vAlpha * 0.2 * uDust, 1.0);
      }
    `,
  });
  return new THREE.Points(points, material);
}
