import { characterAnimalFile } from "@hellovalley/shared";
import { type CharacterAssets, loadCharacterAssets, loadCharacterGlb } from "./characterGlb";

/**
 * One copy of the character set per page (build plan M15): the manifest and body load once, and
 * each animal GLB (8–25 kB) loads the first time an avatar or preview needs it. The player
 * avatar, the onboarding preview and the mirror share it, so switching animals in the mirror
 * reuses what the preview already fetched.
 */
const BASE_URL = `${import.meta.env.BASE_URL}assets/characters`;

let base: Promise<CharacterAssets> | null = null;
const animalLoads = new Map<string, Promise<void>>();

/** The shared character assets with at least `animals` loaded (the object is shared and grows). */
export async function characterAssetsWith(animals: readonly string[]): Promise<CharacterAssets> {
  if (!base) {
    const p = loadCharacterAssets(BASE_URL, { animals: [], outfits: [] });
    base = p;
    p.catch(() => {
      if (base === p) base = null;
    });
  }
  const assets = await base;
  await Promise.all(
    animals.map((id) => {
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
  );
  return assets;
}
