import type { DrawItem } from "./drawCalls";

/**
 * Most meshes one assembled character may have (body slots + head, tail and optional parts;
 * hidden optional parts draw nothing). A test checks every animal's avatar against it.
 */
export const CHARACTER_MESHES_MAX = 9;

/** What the local player adds to a scene's draw calls: the avatar (with shadows), its name tag and the click marker. */
export function playerDrawItems(meshes = CHARACTER_MESHES_MAX): DrawItem[] {
  return [
    ...Array.from({ length: meshes }, (_, k) => ({ label: `player mesh ${k}`, castShadow: true })),
    { label: "name tag", castShadow: false },
    { label: "click marker", castShadow: false },
  ];
}
