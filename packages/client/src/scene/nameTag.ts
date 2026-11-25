import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from "three";

/**
 * The name tag above an avatar (GDD §3.3, build plan M15): a rounded cream pill with the name,
 * drawn once into a canvas texture and shown as a camera-facing sprite (one draw call). It ignores
 * depth, fog and tone mapping so it stays readable behind props and at night.
 */
export const NAME_TAG = {
  /** Text size and padding in canvas pixels (the canvas is drawn at 2× for crisp edges). */
  fontPx: 30,
  padX: 16,
  heightPx: 46,
  /** World metres per canvas pixel (before the 2× supersampling). */
  metresPerPx: 1 / 150,
  /** Gap between the top of the head (ears, hats) and the tag. */
  gapM: 0.16,
  maxWidthPx: 320,
  supersample: 2,
  font: '600 {px}px system-ui, "Segoe UI", sans-serif',
  background: "rgba(255, 250, 240, 0.88)",
  color: "#3d3a44",
} as const;

export interface NameTagLayout {
  /** Canvas size in pixels (supersampled). */
  canvas: [number, number];
  /** Sprite size in metres. */
  world: [number, number];
}

/** Canvas and sprite sizes for a name whose text measures `textWidthPx` (at `fontPx`). */
export function nameTagLayout(textWidthPx: number): NameTagLayout {
  const w = Number.isFinite(textWidthPx) ? Math.max(0, textWidthPx) : 0;
  const width = Math.min(NAME_TAG.maxWidthPx, Math.max(NAME_TAG.heightPx, Math.ceil(w) + NAME_TAG.padX * 2));
  const k = NAME_TAG.supersample;
  return {
    canvas: [width * k, NAME_TAG.heightPx * k],
    world: [width * NAME_TAG.metresPerPx, NAME_TAG.heightPx * NAME_TAG.metresPerPx],
  };
}

/** Builds the tag sprite (browser only: needs a 2D canvas). Dispose with `disposeNameTag`. */
export function createNameTag(name: string): Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = (px: number) => NAME_TAG.font.replace("{px}", String(px));
  let textWidth = name.length * NAME_TAG.fontPx * 0.6;
  if (ctx) {
    ctx.font = font(NAME_TAG.fontPx);
    textWidth = ctx.measureText(name).width;
  }
  const layout = nameTagLayout(textWidth);
  [canvas.width, canvas.height] = layout.canvas;
  if (ctx) {
    const k = NAME_TAG.supersample;
    const [w, h] = layout.canvas;
    ctx.fillStyle = NAME_TAG.background;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h / 2);
    ctx.fill();
    ctx.font = font(NAME_TAG.fontPx * k);
    ctx.fillStyle = NAME_TAG.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, w / 2, h / 2 + k, w - NAME_TAG.padX * k);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const sprite = new Sprite(material);
  sprite.name = "name-tag";
  sprite.scale.set(layout.world[0], layout.world[1], 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeNameTag(sprite: Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
