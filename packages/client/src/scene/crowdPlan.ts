import { CHARACTER_MESHES_MAX } from "./playerDraw";
import type { DrawItem } from "./drawCalls";

/**
 * Character level of detail for crowds (build plan M37, GDD §9.5): a full 40-player shard in one
 * place plus the villagers would cost ~10 draw calls per character (its meshes and name tag) and as
 * many again in the shadow pass. The local player is always drawn in full; every other character
 * (remote players and villagers) shares one draw-call budget, spent nearest-first around the
 * camera's focus:
 *
 * 1. full detail (meshes + name tag) for the nearest few within a radius, then
 * 2. real shadows for the nearest of those while the budget lasts.
 *
 * Everyone else is an impostor: one instanced, tinted body for all of them (one draw call). Every
 * character without a real shadow gets a soft blob shadow, again one instanced mesh for all.
 * Pinned characters (the villager the player talks to) come first. A small distance bonus for
 * characters already in full detail keeps two neighbours from flickering between levels.
 */

export interface CrowdMember {
  id: string;
  x: number;
  z: number;
  /** Always full detail first (the villager in the player's conversation). */
  pinned?: boolean;
}

export interface CrowdOptions {
  /** Most characters drawn in full detail. */
  fullMax: number;
  /** Only characters this close to the focus (metres) get full detail. */
  fullRadiusM: number;
  /** Draw calls (main + shadow pass) all non-local characters may use together. */
  drawBudget: number;
  /** Meshes of one full character. */
  meshes: number;
  /** Distance bonus (metres) for characters that were full detail in the previous plan. */
  hysteresisM: number;
}

export const CROWD_OPTIONS: CrowdOptions = {
  fullMax: 3,
  fullRadiusM: 14,
  drawBudget: 36,
  meshes: CHARACTER_MESHES_MAX,
  hysteresisM: 1.5,
};

export interface CrowdLod {
  full: boolean;
  shadow: boolean;
}

export interface CrowdPlan {
  /** Level of every member, by id. */
  lod: Map<string, CrowdLod>;
  /** Members drawn as instanced impostors. */
  impostors: string[];
  /** Members with a blob shadow (everyone without a real one). */
  blobs: string[];
  /** Draw calls the plan costs (main and shadow pass). */
  draws: number;
}

/** Draw calls of a plan with `full` detailed characters, `shadows` real shadows and the two batches. */
export function crowdDraws(full: number, shadows: number, impostors: number, blobs: number, meshes = CROWD_OPTIONS.meshes): number {
  return full * (meshes + 1) + shadows * meshes + (impostors > 0 ? 1 : 0) + (blobs > 0 ? 1 : 0);
}

export function planCrowd(focus: readonly [number, number], members: readonly CrowdMember[], previous: ReadonlyMap<string, CrowdLod> = new Map(), options: CrowdOptions = CROWD_OPTIONS): CrowdPlan {
  const ranked = members
    .map((m) => {
      const d = Math.hypot(m.x - focus[0], m.z - focus[1]);
      return { m, d, score: d - (previous.get(m.id)?.full ? options.hysteresisM : 0) };
    })
    .sort((a, b) => Number(b.m.pinned === true) - Number(a.m.pinned === true) || a.score - b.score || (a.m.id < b.m.id ? -1 : 1));
  const n = ranked.length;
  // Full detail, nearest first, while the budget (with both batches for the rest) allows.
  let full = 0;
  while (full < n && full < options.fullMax) {
    const next = ranked[full]!;
    if (!next.m.pinned && next.d > options.fullRadiusM) break;
    if (crowdDraws(full + 1, 0, n - full - 1, n, options.meshes) > options.drawBudget) break;
    full++;
  }
  // Real shadows for the nearest full ones; the blob batch goes once everyone has a real shadow.
  let shadows = 0;
  while (shadows < full && crowdDraws(full, shadows + 1, n - full, n - shadows - 1, options.meshes) <= options.drawBudget) shadows++;
  const lod = new Map<string, CrowdLod>();
  const impostors: string[] = [];
  const blobs: string[] = [];
  ranked.forEach(({ m }, i) => {
    const entry = { full: i < full, shadow: i < shadows };
    lod.set(m.id, entry);
    if (!entry.full) impostors.push(m.id);
    if (!entry.shadow) blobs.push(m.id);
  });
  return { lod, impostors, blobs, draws: crowdDraws(full, shadows, impostors.length, blobs.length, options.meshes) };
}

/** The plan's draw items, for the town draw-call estimate (scene/drawCalls). */
export function crowdDrawItems(plan: CrowdPlan, meshes = CROWD_OPTIONS.meshes): DrawItem[] {
  const items: DrawItem[] = [];
  for (const [id, lod] of plan.lod) {
    if (!lod.full) continue;
    for (let k = 0; k < meshes; k++) items.push({ label: `${id} mesh ${k}`, castShadow: lod.shadow });
    items.push({ label: `${id} name tag`, castShadow: false });
  }
  if (plan.impostors.length > 0) items.push({ label: "crowd impostors", castShadow: false });
  if (plan.blobs.length > 0) items.push({ label: "crowd blob shadows", castShadow: false });
  return items;
}

// ---------------------------------------------------------------------------------------------
// Live registry: the avatars report where they are each frame and read their level back.

export interface CrowdEntry extends CrowdMember {
  /** Body colour of the impostor (sRGB hex). */
  color: string;
  /** In the player's space and drawn at all. */
  visible: boolean;
  /** Last frame time (ms) it reported; stale entries drop out. */
  seen: number;
}

/** Shown in full until the first plan, so a lone character never blinks. */
const DEFAULT_LOD: CrowdLod = { full: true, shadow: true };

/** Plans at most this often (ms); between plans the levels hold. */
export const CROWD_PLAN_MS = 250;

export class CrowdRegistry {
  private readonly entries = new Map<string, CrowdEntry>();
  private plan: CrowdPlan = { lod: new Map(), impostors: [], blobs: [], draws: 0 };
  private plannedAt = -Infinity;

  report(entry: Omit<CrowdEntry, "seen">, now: number): void {
    this.entries.set(entry.id, { ...entry, seen: now });
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  lod(id: string): CrowdLod {
    return this.plan.lod.get(id) ?? DEFAULT_LOD;
  }

  /** The visible members, by id. */
  entry(id: string): CrowdEntry | undefined {
    return this.entries.get(id);
  }

  current(): CrowdPlan {
    return this.plan;
  }

  /** Re-plan around `focus` when the last plan is older than CROWD_PLAN_MS (or `force`). */
  update(focus: readonly [number, number], now: number, options: CrowdOptions = CROWD_OPTIONS, force = false): CrowdPlan {
    if (!force && now - this.plannedAt < CROWD_PLAN_MS) return this.plan;
    for (const [id, e] of this.entries) if (now - e.seen > 1000) this.entries.delete(id);
    const members = [...this.entries.values()].filter((e) => e.visible);
    this.plan = planCrowd(focus, members, this.plan.lod, options);
    this.plannedAt = now;
    return this.plan;
  }
}

export const crowd = new CrowdRegistry();
