import { COMMON_KIT_ID, type StyleId } from "@hellovalley/shared";
import { type KitLoader, kitLoader } from "./kitLoader";
import { warmStyleLayer } from "./townMeshes";

/**
 * Load a town style before showing it (Settings, M34): its kit manifest and atlas, the common kit,
 * and every module variant the town's style layer uses, decoded and cached. Applying the style
 * afterwards rebuilds the style layer from memory.
 */
export async function preloadStyle(style: StyleId, loader: KitLoader = kitLoader): Promise<void> {
  const [kit, common] = await Promise.all([loader.loadStyle(style), loader.load(COMMON_KIT_ID)]);
  await warmStyleLayer(kit, common);
}
