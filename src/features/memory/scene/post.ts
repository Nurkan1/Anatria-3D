import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** The film look, after bloom: vignette, grain and a touch of lens fringing. */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: 0.0016 },
    uGrain: { value: 0.045 },
    uVignette: { value: 1.15 },
    /**
     * Where added light stops getting brighter and starts only getting wider.
     *
     * Without it the sum of many glowing shells clips flat at white and takes
     * the memory points with it. This rolls the top off instead: below it
     * nothing changes, above it everything keeps its colour and its order.
     */
    uWhite: { value: 1.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uWhite;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 fromCentre = vUv - 0.5;
      vec2 shift = fromCentre * uAberration * 2.0;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + shift).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - shift).b;
      // Extended Reinhard: linear in the dark half, gently compressed at the top.
      c = c * (1.0 + c / (uWhite * uWhite)) / (1.0 + c);
      float vignette = 1.0 - dot(fromCentre, fromCentre) * uVignette;
      // Grain changes every frame but never as a whole-screen change in
      // brightness: it is per pixel, averaging out, so it cannot flicker.
      float grain = (rand(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain;
      gl_FragColor = vec4(c * vignette + grain, 1.0);
    }
  `,
};

export interface Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  film: ShaderPass;
  setSize(width: number, height: number): void;
  /** The glow's resolution as a share of the screen's; takes effect on the next setSize. */
  setBloomScale(scale: number): void;
  /**
   * The film texture on or off: the moving grain over the whole picture and
   * the colour fringing at its edges. Off, the hologram is exactly as vivid —
   * the vignette, the glow and every animation stay — just without the veil.
   */
  setFilm(on: boolean): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Threshold well above the surface's own glow, so the lines bloom and the
  // body of the brain does not: at a low threshold hundreds of faint layers
  // bloomed together into one white ball.
  const bloom = new UnrealBloomPass(size, 0.75, 0.55, 0.16);
  composer.addPass(bloom);
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);
  composer.addPass(new OutputPass());
  let bloomScale = 1;
  return {
    composer,
    bloom,
    film,
    setSize(width, height) {
      composer.setSize(width, height);
      bloom.setSize(Math.max(1, Math.round(width * bloomScale)), Math.max(1, Math.round(height * bloomScale)));
    },
    setBloomScale(scale) {
      bloomScale = scale;
    },
    setFilm(on) {
      film.uniforms.uGrain!.value = on ? FilmShader.uniforms.uGrain.value : 0;
      film.uniforms.uAberration!.value = on ? FilmShader.uniforms.uAberration.value : 0;
    },
    dispose() {
      composer.dispose();
      bloom.dispose();
    },
  };
}
