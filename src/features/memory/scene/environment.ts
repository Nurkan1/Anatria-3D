import * as THREE from "three";

import { LOOK } from "./hologram";

/** Height of the projector's base, in brain radii. */
export const BASE_Y = -1.55;

/** The floor: a grid that fades into the dark. */
export function floorGrid(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uFade: { value: 0 }, uTime: { value: 0 }, uCyan: { value: LOOK.deep } },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vXZ = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      uniform float uTime;
      uniform vec3 uCyan;
      varying vec2 vXZ;
      float line(float v, float width) {
        float d = abs(fract(v - 0.5) - 0.5) / fwidth(v);
        return 1.0 - min(d / width, 1.0);
      }
      void main() {
        vec2 g = vXZ * 2.0;
        float minor = max(line(g.x, 1.0), line(g.y, 1.0)) * 0.25;
        float major = max(line(g.x / 5.0, 1.2), line(g.y / 5.0, 1.2)) * 0.55;
        float r = length(vXZ);
        float falloff = exp(-r * 0.32);
        // A ring of light spreading out from the projector, slowly.
        float ripple = exp(-pow((r - mod(uTime * 0.6, 14.0)) * 2.0, 2.0)) * 0.35;
        float a = (minor + major + ripple) * falloff * uFade * 0.5;
        gl_FragColor = vec4(uCyan * a, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = BASE_Y - 0.02;
  return mesh;
}

/**
 * The projector: concentric rings with tick marks on the floor, and a cone of
 * light rising from them to the brain.
 */
export function projector(): THREE.Group {
  const group = new THREE.Group();
  group.position.y = BASE_Y;

  const discMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uFade: { value: 0 }, uTime: { value: 0 }, uCyan: { value: LOOK.cyan }, uAmber: { value: LOOK.amber } },
    vertexShader: /* glsl */ `
      varying vec2 vUv2;
      void main() {
        vUv2 = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      uniform float uTime;
      uniform vec3 uCyan;
      uniform vec3 uAmber;
      varying vec2 vUv2;
      float ring(float r, float at, float w) { return exp(-pow((r - at) / w, 2.0)); }
      void main() {
        float r = length(vUv2);
        float a = atan(vUv2.y, vUv2.x);
        float rings = ring(r, 0.55, 0.01) + ring(r, 0.95, 0.008) * 0.8 + ring(r, 1.35, 0.012) + ring(r, 1.7, 0.006) * 0.6;
        // Tick marks on the outer ring, turning.
        float ticks = step(0.5, fract((a + uTime * 0.08) / 6.2831853 * 120.0)) * smoothstep(1.28, 1.3, r) * smoothstep(1.42, 1.4, r);
        // A sweeping arc on the middle ring, like a radar.
        float sweep = pow(max(0.0, cos(a - uTime * 0.9)), 18.0) * ring(r, 0.95, 0.05);
        float arc = step(0.0, sin(a * 3.0 - uTime * 0.4)) * ring(r, 1.55, 0.01);
        float glow = exp(-r * 2.2) * 0.35;
        vec3 c = uCyan * (rings * 0.3 + ticks * 0.18 + arc * 0.2 + glow * 0.45) + uAmber * sweep * 0.3;
        gl_FragColor = vec4(c * uFade, 1.0);
      }
    `,
  });
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), discMaterial);
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  const coneMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uFade: { value: 0 }, uTime: { value: 0 }, uCyan: { value: LOOK.cyan } },
    vertexShader: /* glsl */ `
      varying float vHeight;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAngle;
      void main() {
        vHeight = uv.y;
        vAngle = uv.x;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      uniform float uTime;
      uniform vec3 uCyan;
      varying float vHeight;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAngle;
      void main() {
        float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.5);
        float streaks = 0.6 + 0.4 * sin(vAngle * 90.0 + uTime * 0.7) * sin(vAngle * 23.0 - uTime * 0.4);
        float rise = 0.75 + 0.25 * sin(vHeight * 30.0 - uTime * 2.0);
        float a = (1.0 - vHeight) * (1.0 - vHeight) * edge * streaks * rise * 0.06 * uFade;
        gl_FragColor = vec4(uCyan * a, 1.0);
      }
    `,
  });
  // Open cone, wide at the top where the brain floats.
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.55, 1.5, 96, 1, true), coneMaterial);
  cone.position.y = 0.75;
  group.add(cone);

  return group;
}

/** Thin rings orbiting the brain at different tilts, with a bright travelling mark. */
export function orbitRings(): THREE.Group {
  const group = new THREE.Group();
  const specs = [
    { radius: 1.32, tilt: 0.35, spin: 0.12, strength: 0.5 },
    { radius: 1.45, tilt: -0.6, spin: -0.08, strength: 0.35 },
    { radius: 1.6, tilt: 1.2, spin: 0.05, strength: 0.25 },
  ];
  for (const spec of specs) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uFade: { value: 0 }, uTime: { value: 0 }, uSpin: { value: spec.spin }, uStrength: { value: spec.strength }, uCyan: { value: LOOK.cyan } },
      vertexShader: /* glsl */ `
        varying float vAngle;
        void main() {
          vAngle = atan(position.y, position.x);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFade;
        uniform float uTime;
        uniform float uSpin;
        uniform float uStrength;
        uniform vec3 uCyan;
        varying float vAngle;
        void main() {
          float head = pow(max(0.0, cos(vAngle - uTime * uSpin * 6.0)), 40.0);
          float dashes = step(0.35, fract(vAngle * 12.0 / 6.2831853));
          float a = (0.12 * dashes + head * 0.9) * uStrength * uFade;
          gl_FragColor = vec4(uCyan * a, 1.0);
        }
      `,
    });
    const curve = new THREE.EllipseCurve(0, 0, spec.radius, spec.radius, 0, Math.PI * 2);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(256));
    const line = new THREE.LineLoop(geometry, material);
    line.rotation.x = Math.PI / 2 + spec.tilt;
    line.userData.spin = spec.spin;
    group.add(line);
  }
  return group;
}

/**
 * Signals travelling between regions: arcs that light up from one end to the
 * other, drawn from a fixed pool so nothing is allocated while it runs.
 */
export class Impulses {
  readonly object: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly timing: Float32Array;
  private readonly slots: number;
  private readonly segments = 40;
  private next = 0;

  constructor(slots = 28) {
    this.slots = slots;
    const vertices = slots * this.segments * 2;
    this.positions = new Float32Array(vertices * 3);
    const along = new Float32Array(vertices);
    this.timing = new Float32Array(vertices * 2);
    for (let s = 0; s < slots; s++) {
      for (let k = 0; k < this.segments; k++) {
        const base = (s * this.segments + k) * 2;
        along[base] = k / this.segments;
        along[base + 1] = (k + 1) / this.segments;
      }
    }
    // Every slot starts spent, far in the past.
    for (let i = 0; i < vertices; i++) {
      this.timing[i * 2] = -100;
      this.timing[i * 2 + 1] = 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("along", new THREE.BufferAttribute(along, 1));
    geometry.setAttribute("timing", new THREE.BufferAttribute(this.timing, 2));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uAmber: { value: LOOK.amber }, uCyan: { value: LOOK.cyan } },
      vertexShader: /* glsl */ `
        attribute float along;
        attribute vec2 timing;
        uniform float uTime;
        varying float vAlong;
        varying float vHead;
        void main() {
          vAlong = along;
          vHead = (uTime - timing.x) / timing.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFade;
        uniform vec3 uAmber;
        uniform vec3 uCyan;
        varying float vAlong;
        varying float vHead;
        void main() {
          if (vHead < 0.0 || vHead > 1.6) discard;
          float behind = vHead - vAlong;
          if (behind < 0.0) discard;
          float head = exp(-behind * behind * 900.0);
          float trail = exp(-behind * 6.0) * 0.25;
          float a = (head + trail) * uFade;
          gl_FragColor = vec4(mix(uCyan, uAmber, head) * a, 1.0);
        }
      `,
    });
    this.object = new THREE.LineSegments(geometry, material);
  }

  /** Send a signal from `a` to `b`, arcing outward, starting `now` and taking `seconds`. */
  fire(a: THREE.Vector3, b: THREE.Vector3, now: number, seconds: number): void {
    const slot = this.next;
    this.next = (this.next + 1) % this.slots;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const lift = mid.clone().normalize().multiplyScalar(0.35 + a.distanceTo(b) * 0.35);
    const curve = new THREE.QuadraticBezierCurve3(a, mid.add(lift), b);
    const point = new THREE.Vector3();
    for (let k = 0; k < this.segments; k++) {
      const base = (slot * this.segments + k) * 2;
      curve.getPoint(k / this.segments, point).toArray(this.positions, base * 3);
      curve.getPoint((k + 1) / this.segments, point).toArray(this.positions, (base + 1) * 3);
      this.timing[base * 2] = now;
      this.timing[base * 2 + 1] = seconds;
      this.timing[(base + 1) * 2] = now;
      this.timing[(base + 1) * 2 + 1] = seconds;
    }
    const geometry = this.object.geometry;
    (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("timing") as THREE.BufferAttribute).needsUpdate = true;
  }
}
