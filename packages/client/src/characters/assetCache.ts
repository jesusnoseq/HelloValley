import { characterAnimalFile, characterOutfitFile } from "@hellovalley/shared";
import { type CharacterAssets, loadCharacterAssets, loadCharacterGlb } from "./characterGlb";

/**
 * One copy of the character set per page (build plan M15): the manifest and body load once, and
 * each animal GLB (8–25 kB) loads the first time an avatar or preview needs it. The player
 * avatar, the onboarding preview and the mirror share it, so switching animals in the mirror
 * reuses what the preview already fetched. NPC outfits (build plan M23: the villagers in the
 * scene) load the same way, the first time an NPC needs one.
 */
const BASE_URL = `${import.meta.env.BASE_URL}assets/characters`;

let base: Promise<CharacterAssets> | null = null;
const animalLoads = new Map<string, Promise<void>>();
const outfitLoads = new Map<string, Promise<void>>();

/** The shared character assets with at least `animals` (and `outfits`) loaded (the object is shared and grows). */
export async function characterAssetsWith(animals: readonly string[], outfits: readonly string[] = []): Promise<CharacterAssets> {
  if (!base) {
    const p = loadCharacterAssets(BASE_URL, { animals: [], outfits: [] });
    base = p;
    p.catch(() => {
      if (base === p) base = null;
    });
  }
  const assets = await base;
  await Promise.all([
    ...animals.map((id) => {
      if (assets.animals.has(id)) return undefined;
      let load = animalLoads.get(id);
      if (!load) {
        load = loadCharacterGlb(BASE_URL, characterAnimalFile(id)).then((gltf) => {
          assets.animals.set(id, gltf);
        });
        load.catch(() => animalLoads.delete(id));
        animalLoads.set(id, load);
      }
      return load;
    }),
    ...outfits.map((id) => {
      if (assets.outfits.has(id)) return undefined;
      let load = outfitLoads.get(id);
      if (!load) {
        load = loadCharacterGlb(BASE_URL, characterOutfitFile(id)).then((gltf) => {
          assets.outfits.set(id, gltf);
        });
        load.catch(() => outfitLoads.delete(id));
        outfitLoads.set(id, load);
      }
      return load;
    }),
  ]);
  return assets;
}
