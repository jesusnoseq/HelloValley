import type { Vec3 } from "../buildings/assemble";
import { BUILDING_RECIPE_IDS, type BuildingRecipeId } from "../buildings/schema";
import { ITEM_IDS, itemLabelKey } from "../data/items";
import { getNpc, NPC_IDS, type NpcId } from "../data/npcs";
import type { StyleId } from "../data/styles";
import { recipeCardLabels } from "../food/recipeCard";
import { questCardLabels } from "../quests/cardWords";
import { dressTownProp } from "./dressing";
import { INTERIOR_FURNITURE, interiorLayout, type FurnitureModuleId, type InteriorPiece, pieceArea } from "./interiors";
import { NPC_PICK_HALF_M, NPC_PICK_HEIGHT_M, type NpcLocator, npcsInSpace } from "./npcPosts";
import { rayBox, type SpaceId, spaceDoors } from "./player";
import { type Rect, TOWN_PROPS, type TownPropModuleId } from "./props";
import { type Area, difficultySigns, rectToTown, TOWN_PROPS_LAYOUT } from "./town";

/**
 * World labels (GDD §6.5, build plan M25). Every interactable or labelled thing has a `labelKey`;
 * hovering it shows the word in the player's target language with its reading, and a click on
 * the label plays the word and saves it to the notebook (`object:<labelKey>`).
 *
 * The registry maps each key to an English source word (what the label generator translates).
 * The words themselves are generated once per language by the admin seeding tool into
 * `cache/labels/{lang}` (architecture §6.3); on a miss the client generates the missing ones in
 * the cloud for that player only (hybrid task `worldLabels`) and keeps them in its IndexedDB.
 */

/** A label key: the notebook `object:` source allows `[a-z0-9_.-]{1,64}`. */
export const LABEL_KEY_PATTERN = /^[a-z0-9_.-]{1,64}$/;

/** Bump when the registry's English words change, so cached generations are not reused. */
export const LABELS_VERSION = 1;

const humanize = (id: string) => id.replace(/[._]/g, " ").trim();

const BUILDING_WORDS: Readonly<Record<BuildingRecipeId, string>> = {
  apartment_block: "apartment building",
  bakery: "bakery",
  farm: "farm",
  general_store: "general store",
  clinic: "clinic",
  cafe: "café",
  gossip_house: "house",
  town_hall: "town hall",
  library: "library",
  elder_cottage: "cottage",
};

const PROP_WORDS: Readonly<Record<TownPropModuleId, string>> = {
  bench: "bench",
  lamp: "street lamp",
  fence: "fence",
  stair: "stairs",
  fountain: "fountain",
  notice_board: "notice board",
  market_stall: "market stall",
  crate: "crate",
  barrel: "barrel",
  basket: "basket",
  rock: "rock",
  bush: "bush",
  flowers: "flowers",
  "tree.deciduous": "tree",
  "tree.conifer": "fir tree",
  "tree.cypress": "cypress",
  "bridge.stone": "bridge",
  "dock.fishing": "dock",
  "tree.sakura": "cherry tree",
  "tree.olive": "olive tree",
  "tree.palm": "palm tree",
  "tree.lemon": "lemon tree",
  pergola: "pergola",
  bougainvillea: "bougainvillea",
  "pot.terracotta": "flower pot",
  "tree.date_palm": "date palm",
  "fountain.courtyard": "fountain",
  "lantern.brass": "lantern",
  arcade: "arcade",
  "lantern.stone": "stone lantern",
  "tree.pine": "pine tree",
  "tree.maple": "maple tree",
  "bridge.wooden": "bridge",
};

const FURNITURE_WORDS: Readonly<Record<FurnitureModuleId, string>> = {
  bed: "bed",
  table: "table",
  chair: "chair",
  sofa: "sofa",
  wardrobe: "wardrobe",
  mirror: "mirror",
  "kitchen.nook": "kitchen",
  shelf: "shelf",
  "plant.potted": "plant",
  rug: "rug",
  "lamp.floor": "lamp",
  "lamp.table": "lamp",
  painting: "painting",
  "bakery.counter": "counter",
  "bakery.oven": "oven",
  "store.shelf": "shelf",
  "cafe.bar": "bar counter",
  "clinic.desk": "desk",
  "library.shelf": "bookshelf",
  "townhall.desk": "desk",
  "barn.stall": "stall",
  "barn.hay": "hay",
};

export const buildingLabelKey = (id: BuildingRecipeId) => `building.${id}`;
export const propLabelKey = (id: TownPropModuleId) => `prop.${id}`;
export const furnitureLabelKey = (id: FurnitureModuleId) => `furniture.${id}`;
export const npcLabelKey = (id: NpcId) => `npc.${id}`;
export const INTERCOM_LABEL_KEY = "object.intercom";
export const DOOR_LABEL_KEY = "object.door";
export const SIGN_LABEL_KEY = "object.sign";
/** The apartment mirror names the clothes it edits (build plan M15 / M25). */
export const CLOTHING_LABEL_KEYS = { shirt: "clothing.shirt", trousers: "clothing.trousers" } as const;

function buildRegistry(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ITEM_IDS) out[itemLabelKey(id)] = humanize(id);
  for (const id of NPC_IDS) out[npcLabelKey(id)] = getNpc(id).englishName.toLowerCase();
  for (const id of BUILDING_RECIPE_IDS) out[buildingLabelKey(id)] = BUILDING_WORDS[id];
  for (const id of Object.keys(TOWN_PROPS) as TownPropModuleId[]) out[propLabelKey(id)] = PROP_WORDS[id];
  for (const id of Object.keys(INTERIOR_FURNITURE) as FurnitureModuleId[]) out[furnitureLabelKey(id)] = FURNITURE_WORDS[id];
  out[INTERCOM_LABEL_KEY] = "intercom";
  out[DOOR_LABEL_KEY] = "door";
  out[SIGN_LABEL_KEY] = "sign";
  out[CLOTHING_LABEL_KEYS.shirt] = "shirt";
  out[CLOTHING_LABEL_KEYS.trousers] = "trousers";
  // Build plan M29: the words of recipe cards (headings, cooking verbs, "any fish" groups).
  Object.assign(out, recipeCardLabels());
  // Build plan M30: the words of quest cards (the kinds' verbs, "reward", "before", "today").
  Object.assign(out, questCardLabels());
  return out;
}

/** labelKey → English source word. */
export const LABEL_REGISTRY: Readonly<Record<string, string>> = buildRegistry();
export const LABEL_KEYS: readonly string[] = Object.keys(LABEL_REGISTRY).sort();

export function isLabelKey(key: string): boolean {
  return Object.hasOwn(LABEL_REGISTRY, key);
}

/** The English source word of a key (also the fallback label), or the humanized key. */
export function labelEnglish(key: string): string {
  return LABEL_REGISTRY[key] ?? humanize(key.replace(/^[a-z]+\./, ""));
}

// ---------------------------------------------------------------------------------------------
// Labelled objects in a space

export interface LabelledObject {
  /** Unique within the space. */
  id: string;
  labelKey: string;
  /** Pick box (min, max corners). */
  min: Vec3;
  max: Vec3;
  /** Where the hover label floats (top centre of the box). */
  anchor: Vec3;
}

const box = (id: string, labelKey: string, area: Area, y0: number, y1: number): LabelledObject => {
  const [x0, z0, x1, z1] = area;
  const min: Vec3 = [Math.min(x0, x1), y0, Math.min(z0, z1)];
  const max: Vec3 = [Math.max(x0, x1), y1, Math.max(z0, z1)];
  return { id, labelKey, min, max, anchor: [(min[0] + max[0]) / 2, y1 + 0.25, (min[2] + max[2]) / 2] };
};

/** Rough heights of the town props (metres, my numbers: pick boxes, not collision). */
const PROP_HEIGHT: Partial<Record<TownPropModuleId, number>> = {
  lamp: 3,
  "tree.deciduous": 4.5,
  "tree.conifer": 5,
  "tree.cypress": 4.5,
  fountain: 1.6,
  notice_board: 2,
  market_stall: 2.4,
  stair: 0.6,
  flowers: 0.4,
  rock: 0.6,
  bush: 0.9,
  "bridge.stone": 0.8,
  "dock.fishing": 0.4,
  fence: 1,
  "tree.sakura": 3.6,
  "tree.olive": 3,
  "tree.palm": 4.4,
  "tree.lemon": 3.2,
  "tree.date_palm": 4.8,
  "tree.pine": 4,
  "tree.maple": 3.6,
  pergola: 2.8,
  bougainvillea: 2.5,
  "pot.terracotta": 1.3,
  "fountain.courtyard": 1.2,
  "lantern.brass": 1.3,
  "lantern.stone": 1.6,
  arcade: 3,
  "bridge.wooden": 1,
};

function townObjects(style: StyleId): LabelledObject[] {
  const out: LabelledObject[] = [];
  TOWN_PROPS_LAYOUT.forEach((p, i) => {
    // The prop as the player sees it: a stone lantern is labelled as one (dressing.ts, M34).
    const module = dressTownProp(p, style);
    if (!module) return;
    const def = TOWN_PROPS[module];
    // Trees: the crown is wider than the trunk blocker, so the whole footprint picks.
    const footprint: Rect = [0, -def.d, def.w, 0];
    const blocks = "blocks" in def ? (def.blocks as Rect) : undefined;
    const rect: Rect = module.startsWith("tree.") || !blocks ? footprint : blocks;
    out.push(box(`prop:${i}`, propLabelKey(module), rectToTown(p, rect), 0, PROP_HEIGHT[module] ?? 1));
  });
  for (const s of difficultySigns()) {
    const h = 0.35;
    out.push(box(`sign:${s.building}`, SIGN_LABEL_KEY, [s.position[0] - h, s.position[1] - h, s.position[0] + h, s.position[1] + h], 0, 1.9));
  }
  for (const door of spaceDoors("town")) {
    const building = door.id.split(":")[0] as BuildingRecipeId;
    out.push(box(`building:${door.id}`, buildingLabelKey(building), door.clickArea, 0, door.clickHeight));
  }
  return out;
}

/** Furniture pick heights by mount (metres; wall pieces hang between 1 and 2 m). */
function pieceBox(index: number, piece: InteriorPiece): LabelledObject {
  const f = INTERIOR_FURNITURE[piece.module];
  const y = piece.y ?? 0;
  const [y0, y1] = f.mount === "wall" ? [1, 2] : f.mount === "rug" ? [0, 0.05] : f.mount === "surface" ? [y, y + 0.45] : [0, piece.module === "wardrobe" || piece.module.endsWith("shelf") ? 2 : 1];
  return box(`furniture:${index}`, furnitureLabelKey(piece.module), pieceArea(piece), y0, y1);
}

/**
 * Everything with a label in a space: town props, difficulty signs and buildings; indoors the
 * furniture, the entrance door and the villagers. The apartment's pieces can be passed in (the
 * live ApartmentRoom layout, `apartmentInteriorLayout(...).furniture`); otherwise the
 * interior's default layout is used.
 */
export function labelledObjects(space: SpaceId, furniture?: readonly InteriorPiece[], locate?: NpcLocator, style: StyleId = "european"): LabelledObject[] {
  if (space === "town") {
    let town = townCache.get(style);
    if (!town) townCache.set(style, (town = townObjects(style)));
    // Build plan M31: villagers walk through town too; their boxes follow them.
    return locate ? [...town, ...npcBoxes(space, locate)] : town;
  }
  const pieces = furniture ?? interiorLayout(space).furniture;
  const out = pieces.map((p, i) => pieceBox(i, p));
  for (const door of spaceDoors(space)) {
    const [x0, z0, x1, z1] = door.clickArea;
    const shrink = 0.4;
    out.push(box(`door:${door.id}`, DOOR_LABEL_KEY, [x0 + shrink, z0 + shrink, x1 - shrink, z1 - shrink], 0, 2.2));
  }
  out.push(...npcBoxes(space, locate));
  return out;
}

/** Pick boxes of the villagers in a space (where `locate` has them, else at their posts). */
export function npcBoxes(space: SpaceId, locate?: NpcLocator): LabelledObject[] {
  const h = NPC_PICK_HALF_M;
  return npcsInSpace(space, locate).map((p) => box(`npc:${p.npcId}`, npcLabelKey(p.npcId), [p.pos[0] - h, p.pos[1] - h, p.pos[0] + h, p.pos[1] + h], 0, NPC_PICK_HEIGHT_M));
}
const townCache = new Map<StyleId, LabelledObject[]>();

/** The labelled object a ray (origin, direction) hits first, or null. */
export function pickLabel(objects: readonly LabelledObject[], origin: Vec3, dir: Vec3): LabelledObject | null {
  let best: { t: number; o: LabelledObject } | null = null;
  for (const o of objects) {
    const t = rayBox(origin, dir, o.min, o.max);
    if (t !== null && (!best || t < best.t)) best = { t, o };
  }
  return best?.o ?? null;
}
