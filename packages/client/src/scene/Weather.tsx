import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Fog, LineSegments, type OrthographicCamera, ShaderMaterial, SRGBColorSpace, Vector3 } from "three";
import { easeWeatherWeights, weatherAt, WORLD_WEATHER_SEED } from "@hellovalley/shared";
import { townLive } from "../net/townSession";
import { dioramaStore } from "../state/dioramaStore";
import { worldStore } from "../state/worldStore";
import { CAMERA_DISTANCE } from "./cameraMath";
import { lightingAt } from "./dayNight";
import { fogRange, overcastColor, weatherLook, windVector } from "./weatherLook";
import { TIME_WRAP_SECONDS, weatherRuntime, worldUniforms } from "./worldFx";

/**
 * Drives the cosmetic weather (build plan M12) once per frame: eases the weather weights towards
 * the world-state weather (the shared schedule, or the store's pinned weather), then updates the
 * scene fog, the shared shader uniforms (time, wind, rain, sky colour) and `weatherRuntime`, which
 * DayNightLights reads to dim and grey the light. The fog object stays on the scene for the whole
 * session (cleared far away in sunshine) so toggling the weather never recompiles shaders.
 */
export function WeatherDriver() {
  const get = useThree((st) => st.get);
  const fog = useRef<Fog | null>(null);
  const first = useRef(true);
  const sky = useRef(new Color());

  useEffect(() => {
    const created = new Fog("#ffffff", 1e5, 1e5 + 1);
    fog.current = created;
    get().scene.fog = created;
    return () => {
      const scene = get().scene;
      if (scene.fog === created) scene.fog = null;
      fog.current = null;
    };
  }, [get]);

  useFrame((_, dt) => {
    const store = dioramaStore.getState();
    // Online the TownRoom's broadcast weather wins; offline (dev pages) the same schedule runs locally.
    const scheduled = () => townLive.serverWeather() ?? weatherAt(townLive.serverNow() ?? Date.now(), WORLD_WEATHER_SEED).weather;
    const target = store.weatherAuto ? scheduled() : store.weather;
    // Start in the current weather rather than fading in from sunshine.
    weatherRuntime.weights = easeWeatherWeights(weatherRuntime.weights, target, first.current ? 1e6 : dt);
    first.current = false;
    const look = weatherLook(weatherRuntime.weights);
    weatherRuntime.look = look;

    const light = lightingAt(store.worldTime);
    const f = fog.current;
    if (f) {
      // No fog indoors (build plan M13): the room is lit by the same sky but sheltered.
      const indoors = worldStore.getState().space !== "town";
      const { near, far } = fogRange(indoors ? 0 : look.fog, CAMERA_DISTANCE);
      f.near = near;
      f.far = far;
      f.color.setRGB(...overcastColor(light.background, look.overcast), SRGBColorSpace);
    }

    worldUniforms.uHvTime.value = (worldUniforms.uHvTime.value + Math.min(dt, 0.1)) % TIME_WRAP_SECONDS;
    worldUniforms.uHvWind.value.set(...windVector(look));
    worldUniforms.uHvRain.value = look.ripples;
    sky.current.setRGB(...overcastColor(light.skyColor, look.overcast), SRGBColorSpace);
    worldUniforms.uHvSky.value.copy(sky.current);
  }, -10);

  return null;
}

// ---------------------------------------------------------------------------------------------
// Rain

export const RAIN_STREAKS = 1600;
/** Height of the rain volume above the ground, metres. */
export const RAIN_HEIGHT = 14;
export const RAIN_STREAK_LENGTH = 0.55;
export const RAIN_SPEED = 11;

/**
 * Per-vertex seeds of the rain streaks: two vertices per streak sharing a random point of the
 * unit cube (xyz) with w = 0 at the bottom end and 1 at the top. Deterministic.
 */
export function rainSeeds(count = RAIN_STREAKS, seed = 1): Float32Array {
  const out = new Float32Array(count * 8);
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  for (let k = 0; k < count; k++) {
    const x = rand();
    const y = rand();
    const z = rand();
    out.set([x, y, z, 0, x, y, z, 1], k * 8);
  }
  return out;
}

const RAIN_VERTEX = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uHvTime;
  uniform vec2 uHvWind;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform float uLength;
  uniform float uSpeed;
  varying float vEnd;
  varying float vFade;
  void main() {
    vec3 b = aSeed.xyz * uBox;
    float y = mod(b.y - uHvTime * uSpeed * (0.85 + 0.3 * aSeed.x), uBox.y);
    // Wrap in world space around the view centre, so streaks stay put while the camera moves.
    vec2 origin = uCenter.xz - uBox.xz * 0.5;
    vec2 xz = origin + mod(b.xz - origin, uBox.xz);
    vec3 fall = normalize(vec3(uHvWind.x * 8.0, -1.0, uHvWind.y * 8.0));
    vec3 p = vec3(xz.x, uCenter.y + y, xz.y) - fall * uLength * aSeed.w;
    vEnd = aSeed.w;
    vFade = smoothstep(0.0, 1.0, y) * (1.0 - smoothstep(uBox.y - 2.0, uBox.y, y));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vEnd;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * vFade * mix(0.25, 1.0, vEnd));
  }
`;

/**
 * Light rain: line-segment streaks falling through a box around the point the camera looks at,
 * all animated in the vertex shader (one draw call, no per-frame buffer updates). Hidden when
 * there is no rain.
 */
export function RainStreaks() {
  const ref = useRef<LineSegments<BufferGeometry, ShaderMaterial>>(null);
  const forward = useRef(new Vector3());
  const resources = useMemo(() => {
    const geometry = new BufferGeometry();
    const seeds = rainSeeds();
    geometry.setAttribute("aSeed", new BufferAttribute(seeds, 4));
    // Positions are computed in the shader; three still needs a position attribute to draw.
    geometry.setAttribute("position", new BufferAttribute(new Float32Array((seeds.length / 4) * 3), 3));
    const material = new ShaderMaterial({
      name: "rain",
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uHvTime: worldUniforms.uHvTime,
        uHvWind: worldUniforms.uHvWind,
        uCenter: { value: new Vector3() },
        uBox: { value: new Vector3(40, RAIN_HEIGHT, 40) },
        uLength: { value: RAIN_STREAK_LENGTH },
        uSpeed: { value: RAIN_SPEED },
        uColor: { value: new Color("#cfe0f2") },
        uOpacity: { value: 0 },
      },
    });
    return { geometry, material };
  }, []);

  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.material.dispose();
    },
    [resources],
  );

  useFrame(({ camera }) => {
    const lines = ref.current;
    if (!lines) return;
    const rain = weatherRuntime.look.rain;
    lines.visible = rain > 0.02 && worldStore.getState().space === "town";
    if (!lines.visible) return;
    const u = lines.material.uniforms;
    u.uOpacity!.value = 0.55 * rain;
    // The ground point under the middle of the screen.
    camera.getWorldDirection(forward.current);
    const t = forward.current.y < -1e-3 ? -camera.position.y / forward.current.y : 0;
    (u.uCenter!.value as Vector3).copy(camera.position).addScaledVector(forward.current, t).setY(0);
    const ortho = camera as OrthographicCamera;
    const viewHeight = ortho.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom : 20;
    const size = Math.max(28, viewHeight * 1.8);
    (u.uBox!.value as Vector3).set(size, RAIN_HEIGHT, size);
  });

  return <lineSegments ref={ref} name="rain" geometry={resources.geometry} material={resources.material} frustumCulled={false} renderOrder={10} visible={false} />;
}

/** The weather driver and its rain, for any diorama scene. */
export function Weather() {
  return (
    <>
      <WeatherDriver />
      <RainStreaks />
    </>
  );
}
