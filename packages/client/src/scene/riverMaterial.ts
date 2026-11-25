import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RedFormat, RepeatWrapping, RGBAFormat, type Texture, UnsignedByteType, Vector2, Vector4, type WebGLProgramParametersWithUniforms } from "three";
import { encodeShoreField, type ShoreField, townShoreField } from "@hellovalley/shared";
import { worldUniforms } from "./worldFx";

/**
 * The stylized river (GDD §7.1, build plan M12): one MeshStandardMaterial patched with
 * onBeforeCompile, so it keeps the scene's lights, shadows and fog. On top of the standard
 * shading it adds
 * - two scrolling layers of a procedural tileable normal map (plus rain rings when it rains),
 * - a depth tint from shallow teal at the banks to deep blue mid-stream, and edge foam, both read
 *   from the shared shore distance field (an R8 texture over the town),
 * - a soft fresnel reflection of the current sky colour.
 * Water far from the river (the fountain basin) is treated as a shallow pool without foam.
 */

const TAU = Math.PI * 2;

/** Integer-frequency waves (so the height field tiles): [fx, fy, amplitude, phase]. */
const WAVES: readonly [number, number, number, number][] = [
  [1, 2, 0.5, 0.3],
  [3, -1, 0.32, 1.7],
  [-2, 3, 0.25, 4.1],
  [5, 2, 0.14, 2.2],
  [-4, -5, 0.1, 5.3],
  [7, -3, 0.07, 0.9],
];

/**
 * RGBA bytes of a `size` x `size` tileable normal map (tangent space, z up, encoded 0–255),
 * from a sum of integer-frequency sine waves with analytic gradients.
 */
export function waterNormalTexels(size = 64, strength = 0.9): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let dx = 0;
      let dy = 0;
      for (const [fx, fy, a, p] of WAVES) {
        const c = Math.cos(TAU * (fx * u + fy * v) + p) * a * TAU;
        dx += c * fx;
        dy += c * fy;
      }
      const nx = (-dx * strength) / 24;
      const ny = (-dy * strength) / 24;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      out[o] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

export function createWaterNormalTexture(size = 64): DataTexture {
  const tex = new DataTexture(waterNormalTexels(size), size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createShoreTexture(field: ShoreField = townShoreField()): DataTexture {
  const tex = new DataTexture(encodeShoreField(field), field.w, field.d, RedFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** River palette (sRGB): teal shallows, blue depths, cream foam. */
export const RIVER_COLORS = { shallow: "#5aaea8", deep: "#2a6a8e", foam: "#f3faf4" } as const;

const PARS_VERTEX = /* glsl */ `
  varying vec3 vHvWorld;
`;

const WORLD_VERTEX = /* glsl */ `
  vHvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const PARS_FRAGMENT = /* glsl */ `
  varying vec3 vHvWorld;
  uniform float uHvTime;
  uniform float uHvRain;
  uniform vec3 uHvSky;
  uniform sampler2D uHvNormal;
  uniform sampler2D uHvShore;
  uniform vec4 uHvShoreRect;
  uniform vec2 uHvShoreRange;
  uniform vec3 uHvShallow;
  uniform vec3 uHvDeep;
  uniform vec3 uHvFoam;
  float hvHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // Rain rings: one expanding ring per 0.8 m cell with its own phase; returns a slope.
  vec2 hvRipples(vec2 p, float t) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float h = hvHash(cell);
    vec2 c = vec2(hvHash(cell + 7.1), hvHash(cell + 3.7)) * 0.6 + 0.2;
    float phase = fract(t * 0.8 + h);
    vec2 d = f - c;
    float r = length(d) + 1e-4;
    float ring = r - phase * 0.45;
    float amp = (1.0 - phase) * exp(-ring * ring * 900.0);
    return d / r * amp * sin(ring * 90.0) * 0.6;
  }
`;

const DEPTH_FRAGMENT = /* glsl */ `
  vec2 hvShoreUv = (vHvWorld.xz - uHvShoreRect.xy) * uHvShoreRect.zw;
  float hvSd = texture2D(uHvShore, hvShoreUv).r * (uHvShoreRange.x + uHvShoreRange.y) - uHvShoreRange.x;
  // Far inland (the fountain) is a pool: fixed shallow depth, no river foam.
  float hvPool = 1.0 - smoothstep(-1.6, -1.2, hvSd);
  float hvDepth = mix(clamp(hvSd, 0.0, 4.0), 0.5, hvPool);
  float hvNoise = texture2D(uHvNormal, vHvWorld.xz * 0.5 + vec2(uHvTime * 0.04, uHvTime * 0.01)).r;
  float hvFoam = 1.0 - smoothstep(0.06, 0.32 + 0.22 * hvNoise, hvSd);
  float hvBand = 0.45 + 0.12 * sin(uHvTime * 1.1 + vHvWorld.x * 1.3 + vHvWorld.z * 0.7);
  hvFoam = max(hvFoam, 0.45 * (1.0 - smoothstep(0.0, 0.07 + 0.05 * hvNoise, abs(hvSd - hvBand))));
  hvFoam *= 1.0 - hvPool;
  diffuseColor.rgb = mix(uHvShallow, uHvDeep, smoothstep(0.05, 1.9, hvDepth));
  diffuseColor.rgb = mix(diffuseColor.rgb, uHvFoam, clamp(hvFoam, 0.0, 1.0) * 0.9);
`;

const NORMAL_FRAGMENT = /* glsl */ `
  {
    vec2 hvP = vHvWorld.xz;
    // The river flows west to east (+x); two layers drift at different speeds and angles.
    vec3 hvA = texture2D(uHvNormal, hvP * 0.21 + vec2(uHvTime * 0.045, uHvTime * 0.008)).xyz * 2.0 - 1.0;
    vec3 hvB = texture2D(uHvNormal, vec2(hvP.y, -hvP.x) * 0.33 + vec2(uHvTime * 0.012, -uHvTime * 0.03)).xyz * 2.0 - 1.0;
    vec2 hvSlope = (hvA.xy + vec2(-hvB.y, hvB.x)) * mix(0.45, 0.25, hvPool);
    hvSlope += hvRipples(hvP * 1.25, uHvTime) * uHvRain;
    hvSlope *= 1.0 - clamp(hvFoam, 0.0, 1.0) * 0.7;
    vec3 hvN = normalize(vec3(hvSlope.x, 1.0, hvSlope.y));
    normal = normalize((viewMatrix * vec4(hvN, 0.0)).xyz);
  }
`;

const REFLECT_FRAGMENT = /* glsl */ `
  {
    vec3 hvView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
    float hvFres = pow(1.0 - clamp(dot(normal, hvView), 0.0, 1.0), 3.0);
    float hvReflect = clamp(0.1 + hvFres * 0.9, 0.0, 0.55) * (1.0 - clamp(hvFoam, 0.0, 1.0));
    outgoingLight = mix(outgoingLight, uHvSky * 0.9, hvReflect);
  }
`;

export interface RiverMaterialOptions {
  field?: ShoreField;
  normalMap?: Texture;
  shoreTexture?: Texture;
}

/** One-line check that every hook the patch relies on is in the standard shader. */
export const RIVER_SHADER_HOOKS = {
  vertex: ["#include <common>", "#include <project_vertex>"],
  fragment: ["#include <common>", "#include <color_fragment>", "#include <normal_fragment_maps>", "#include <opaque_fragment>"],
} as const;

/** Apply the river patch to standard-material shader sources (exported for tests). */
export function patchRiverShader(shader: Pick<WebGLProgramParametersWithUniforms, "vertexShader" | "fragmentShader">): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${PARS_VERTEX}`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${WORLD_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${PARS_FRAGMENT}`)
    .replace("#include <color_fragment>", `#include <color_fragment>\n${DEPTH_FRAGMENT}`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${NORMAL_FRAGMENT}`)
    .replace("#include <opaque_fragment>", `${REFLECT_FRAGMENT}\n#include <opaque_fragment>`);
}

/** The river material. Dispose its textures with `disposeRiverMaterial`. */
export function createRiverMaterial(options: RiverMaterialOptions = {}): MeshStandardMaterial {
  const field = options.field ?? townShoreField();
  const normalMap = options.normalMap ?? createWaterNormalTexture();
  const shore = options.shoreTexture ?? createShoreTexture(field);
  const material = new MeshStandardMaterial({ name: "river", color: "#ffffff", roughness: 0.28, metalness: 0 });
  const uniforms = {
    uHvNormal: { value: normalMap },
    uHvShore: { value: shore },
    uHvShoreRect: { value: new Vector4(0, 0, 1 / (field.w * field.cell), 1 / (field.d * field.cell)) },
    uHvShoreRange: { value: new Vector2(field.landRange, field.waterRange) },
    uHvShallow: { value: new Color(RIVER_COLORS.shallow) },
    uHvDeep: { value: new Color(RIVER_COLORS.deep) },
    uHvFoam: { value: new Color(RIVER_COLORS.foam) },
  };
  material.userData.riverTextures = [normalMap, shore];
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uHvTime: worldUniforms.uHvTime, uHvRain: worldUniforms.uHvRain, uHvSky: worldUniforms.uHvSky });
    patchRiverShader(shader);
  };
  material.customProgramCacheKey = () => "hv-river";
  return material;
}

export function disposeRiverMaterial(material: MeshStandardMaterial): void {
  for (const t of (material.userData.riverTextures as Texture[] | undefined) ?? []) t.dispose();
  material.dispose();
}
