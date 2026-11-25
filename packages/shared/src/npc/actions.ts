import { z } from "zod";
import { getItem, type ItemId, isItemId, npcBuys, npcSells, SHOPS } from "../data/items";
import type { NpcId } from "../data/npcs";
import { getRecipe } from "../data/recipes";
import { MAX_HEARTS } from "../firestore/schemas";
import { clampHearts, QUEST_COMPLETION_HEARTS } from "./friendship";

/**
 * NPC turn actions (GDD §8.1, docs/prompts/npc-runtime.md §1.3) and the game server's check of
 * them (architecture §6.1). The model proposes; the server decides:
 *
 * | Proposal | Server rule |
 * |---|---|
 * | `offer` / `buy` | the item is on this NPC's sell / buy list; the proposed price is ignored and recomputed |
 * | `priceAdjustment` | Shopkeeper only, clamped to −30..+10 %, discounts scaled by friendship, once per item per conversation |
 * | `friendshipDelta` | clamped to −1..+1; at most +1 per conversation and +2 per NPC per in-game day |
 * | `give` | only from the NPC's gift table, at most one gift per NPC per in-game day |
 * | `giveQuest` / `completeQuest` | only quests the server offers / whose conditions hold (TODO(M30)); a completed one adds QUEST_COMPLETION_HEARTS |
 * | `teachRecipe` | only the NPC's own recipes, at or above their heart threshold |
 * | `endConversation` | always |
 *
 * A forged reply can therefore get at most what a perfect conversation gets. Everything here is
 * pure: the caller passes the current state and stores the returned ledgers.
 */

export const NPC_ACTION_TYPES = [
  "offer",
  "buy",
  "give",
  "giveQuest",
  "completeQuest",
  "teachRecipe",
  "priceAdjustment",
  "friendshipDelta",
  "endConversation",
] as const;
export type NpcActionType = (typeof NPC_ACTION_TYPES)[number];

/** Price adjustment bounds in percent (GDD §5.1). */
export const PRICE_ADJUSTMENT_MIN_PCT = -30;
export const PRICE_ADJUSTMENT_MAX_PCT = 10;
/** Most items in one offer or sale (my number). */
export const MAX_TRADE_QTY = 10;
/** Most actions the server looks at in one turn (my number); the rest are rejected. */
export const MAX_ACTIONS_PER_TURN = 6;
/** Offers and sales allowed in one turn (one per item, at most this many). */
export const MAX_TRADES_PER_TURN = 3;
/** friendshipDelta caps (architecture §6.1). */
export const FRIENDSHIP_UP_PER_CONVERSATION = 1;
export const FRIENDSHIP_UP_PER_DAY = 2;
export const FRIENDSHIP_DOWN_PER_CONVERSATION = 1;
/** Hearts per friendship point (my number; GDD §8.2 gives 0–10 hearts). The other heart sources are in npc/friendship.ts. */
export const HEARTS_PER_FRIENDSHIP_POINT = 0.5;
/** Gifts per NPC per in-game day (architecture §6.1). */
export const GIFTS_PER_DAY = 1;
/**
 * The default gift table (my rule until per-NPC tables exist): an NPC may give one of the cheap
 * things it sells (base price ≤ this). TODO(M26): real gift tables, including the residents. (Gifts from the player are npc/friendship.ts.)
 */
export const GIFT_MAX_BASE_PRICE = 5;
/** What NPCs pay for what they buy, as a fraction of the base price. TODO(M26): tune, haggling on sales. */
export const NPC_BUY_BACK_RATE = 0.5;
/** The Shopkeeper buys anything, at a lowball price (persona). */
export const SHOPKEEPER_BUY_BACK_RATE = 0.3;

// ---------------------------------------------------------------------------------------------
// Proposal schema (lenient: unknown types and malformed actions are dropped, not fatal)

const id = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const int = z
  .number()
  .finite()
  .transform((n) => Math.round(n));
const qty = int.optional().transform((n) => (n === undefined ? 1 : n));

export const NpcActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("offer"), itemId: id, qty, price: int.optional() }),
  z.object({ type: z.literal("buy"), itemId: id, qty, price: int.optional() }),
  z.object({ type: z.literal("give"), itemId: id }),
  z.object({ type: z.literal("giveQuest"), questId: id }),
  z.object({ type: z.literal("completeQuest"), questId: id }),
  z.object({ type: z.literal("teachRecipe"), recipeId: id }),
  // The doc's `priceAdjustment(pct)`; an `itemId` scopes it (once per item per conversation).
  z.object({ type: z.literal("priceAdjustment"), pct: int, itemId: id.optional() }),
  z.object({ type: z.literal("friendshipDelta"), delta: int }),
  z.object({ type: z.literal("endConversation") }),
]);
export type NpcAction = z.output<typeof NpcActionSchema>;
export type NpcActionInput = z.input<typeof NpcActionSchema>;

/** Most raw actions accepted in a reply before filtering (anything longer is a broken answer). */
export const MAX_RAW_ACTIONS = 16;

const dropNulls = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) : v;

/** The `actions` list of a reply: well-formed actions of a known type, in order. */
export const NpcActionListSchema = z
  .array(z.unknown())
  .max(MAX_RAW_ACTIONS)
  .transform((list) =>
    list.flatMap((raw) => {
      const parsed = NpcActionSchema.safeParse(dropNulls(raw));
      return parsed.success ? [parsed.data] : [];
    }),
  );

// ---------------------------------------------------------------------------------------------
// Prices

const roundCoins = (n: number) => Math.max(1, Math.round(n));

/** What the NPC charges for one item with a price adjustment (percent). */
export function adjustedUnitPrice(itemId: ItemId, pct = 0): number {
  const base = getItem(itemId)?.basePrice ?? 0;
  return roundCoins(base * (1 + pct / 100));
}

/** What an NPC pays the player for one item. */
export function npcBuyUnitPrice(npcId: NpcId, itemId: ItemId): number {
  const base = getItem(itemId)?.basePrice ?? 0;
  const rate = npcId === "shopkeeper" ? SHOPKEEPER_BUY_BACK_RATE : NPC_BUY_BACK_RATE;
  return Math.max(1, Math.floor(base * rate));
}

/**
 * The model's haggle, made safe: rounded, clamped to −30..+10 %, and discounts scaled by
 * friendship (half the discount at 0 hearts, all of it at 10).
 */
export function clampPriceAdjustment(pct: number, hearts: number): number {
  const clamped = Math.min(PRICE_ADJUSTMENT_MAX_PCT, Math.max(PRICE_ADJUSTMENT_MIN_PCT, Math.round(Number.isFinite(pct) ? pct : 0)));
  if (clamped >= 0) return clamped;
  const h = Math.min(MAX_HEARTS, Math.max(0, hearts));
  const scaled = Math.round(clamped * (0.5 + h / (2 * MAX_HEARTS)));
  return scaled === 0 ? 0 : scaled;
}

/** The NPC's gift table (see GIFT_MAX_BASE_PRICE). */
export function npcGiftTable(npcId: NpcId): ItemId[] {
  return (SHOPS[npcId]?.sells ?? []).filter((i) => (getItem(i)?.basePrice ?? Infinity) <= GIFT_MAX_BASE_PRICE);
}

// ---------------------------------------------------------------------------------------------
// Validation

/** What the server remembers per conversation. */
export interface ConversationLedger {
  friendshipUp: number;
  friendshipDown: number;
  /** Price adjustments made in this conversation: itemId (or "*" for the whole shop) → percent. */
  adjustments: Record<string, number>;
}

/** What the server remembers per player × NPC × in-game day. */
export interface DailyLedger {
  friendshipUp: number;
  gifts: number;
}

export const emptyConversationLedger = (): ConversationLedger => ({ friendshipUp: 0, friendshipDown: 0, adjustments: {} });
export const emptyDailyLedger = (): DailyLedger => ({ friendshipUp: 0, gifts: 0 });

export interface ActionContext {
  npcId: NpcId;
  /** The player's hearts with this NPC (0–10). */
  hearts: number;
  /** How many of each item the player holds. */
  inventory: Readonly<Partial<Record<string, number>>>;
  /** Recipes the player already knows. TODO(M29): learned-recipe storage. */
  knownRecipes: readonly string[];
  /** Quests this NPC offers this player today. TODO(M30): daily requests. */
  questsOffered: readonly string[];
  /** Quests whose server-side conditions hold right now. TODO(M30). */
  questsCompletable: readonly string[];
  conversation: ConversationLedger;
  daily: DailyLedger;
}

/** A trade the player still has to confirm (the M23 confirmation card), with the server's price. */
export interface TradeProposal {
  /** `offer`: the NPC sells to the player; `buy`: the NPC buys from the player. */
  kind: "offer" | "buy";
  itemId: ItemId;
  qty: number;
  unitPrice: number;
  /** Total in coins: unitPrice × qty. */
  price: number;
}

export type ApprovedAction =
  | ({ type: "offer" } & Omit<TradeProposal, "kind">)
  | ({ type: "buy" } & Omit<TradeProposal, "kind">)
  | { type: "give"; itemId: ItemId; qty: 1 }
  | { type: "giveQuest"; questId: string }
  | { type: "completeQuest"; questId: string }
  | { type: "teachRecipe"; recipeId: string }
  | { type: "priceAdjustment"; itemId: ItemId | null; pct: number }
  | { type: "friendshipDelta"; delta: number; hearts: number }
  | { type: "endConversation" };

export const ACTION_REJECT_REASONS = [
  "unknown_item",
  "not_sold_here",
  "not_bought_here",
  "not_owned",
  "bad_qty",
  "not_shopkeeper",
  "already_adjusted",
  "friendship_cap",
  "not_in_gift_table",
  "gift_cap",
  "inventory_full",
  "unknown_recipe",
  "not_teacher",
  "hearts_required",
  "already_known",
  "unknown_quest",
  "conditions_not_met",
  "duplicate",
  "too_many_actions",
] as const;
export type ActionRejectReason = (typeof ACTION_REJECT_REASONS)[number];

export interface RejectedAction {
  type: NpcActionType;
  reason: ActionRejectReason;
}

/** Changes that happen at once (trades wait for the player's confirmation). */
export interface ImmediateEffects {
  /** Hearts change with this NPC (already clamped so hearts stay in 0..10). */
  hearts: number;
  /** Items handed to the player (gifts). */
  items: { itemId: ItemId; qty: number }[];
  recipes: string[];
  questsGiven: string[];
  questsCompleted: string[];
}

export interface ActionVerdict {
  accepted: ApprovedAction[];
  rejected: RejectedAction[];
  /** The trades among `accepted`, in order. */
  trades: TradeProposal[];
  effects: ImmediateEffects;
  ended: boolean;
  conversation: ConversationLedger;
  daily: DailyLedger;
}

/** Price adjustments go first, so an offer in the same turn already has the haggled price. */
const ORDER: Record<NpcActionType, number> = {
  priceAdjustment: 0,
  offer: 1,
  buy: 1,
  give: 2,
  giveQuest: 2,
  completeQuest: 2,
  teachRecipe: 2,
  friendshipDelta: 3,
  endConversation: 4,
};

/** The adjustment in effect for an item in this conversation (item-specific, else shop-wide). */
export function adjustmentFor(ledger: ConversationLedger, itemId: string): number {
  return ledger.adjustments[itemId] ?? ledger.adjustments["*"] ?? 0;
}

/** Validates and clamps one turn's proposed actions (architecture §6.1). Pure. */
export function validateNpcActions(actions: readonly NpcAction[], ctx: ActionContext): ActionVerdict {
  const conversation: ConversationLedger = { ...ctx.conversation, adjustments: { ...ctx.conversation.adjustments } };
  const daily: DailyLedger = { ...ctx.daily };
  const accepted: ApprovedAction[] = [];
  const rejected: RejectedAction[] = [];
  const trades: TradeProposal[] = [];
  const effects: ImmediateEffects = { hearts: 0, items: [], recipes: [], questsGiven: [], questsCompleted: [] };
  const seen = new Set<string>();
  let hearts = Math.min(MAX_HEARTS, Math.max(0, ctx.hearts));
  let ended = false;
  const reject = (type: NpcActionType, reason: ActionRejectReason) => rejected.push({ type, reason });

  const ordered = actions
    .slice(0, MAX_ACTIONS_PER_TURN)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => ORDER[x.a.type] - ORDER[y.a.type] || x.i - y.i)
    .map(({ a }) => a);
  for (const extra of actions.slice(MAX_ACTIONS_PER_TURN)) reject(extra.type, "too_many_actions");

  for (const action of ordered) {
    // One action per type and target per turn; at most MAX_TRADES_PER_TURN trades.
    const key = `${action.type}:${"itemId" in action ? (action.itemId ?? "*") : ""}${"questId" in action ? action.questId : ""}${"recipeId" in action ? action.recipeId : ""}`;
    if (seen.has(key)) {
      reject(action.type, "duplicate");
      continue;
    }
    seen.add(key);

    switch (action.type) {
      case "offer":
      case "buy": {
        if (!isItemId(action.itemId)) {
          reject(action.type, "unknown_item");
          break;
        }
        if (action.qty < 1 || action.qty > MAX_TRADE_QTY) {
          reject(action.type, "bad_qty");
          break;
        }
        if (trades.length >= MAX_TRADES_PER_TURN) {
          reject(action.type, "too_many_actions");
          break;
        }
        if (action.type === "offer" && !npcSells(ctx.npcId, action.itemId)) {
          reject(action.type, "not_sold_here");
          break;
        }
        if (action.type === "buy") {
          if (!npcBuys(ctx.npcId, action.itemId)) {
            reject(action.type, "not_bought_here");
            break;
          }
          if ((ctx.inventory[action.itemId] ?? 0) < action.qty) {
            reject(action.type, "not_owned");
            break;
          }
        }
        // The proposed price is ignored: the server's own price, with this conversation's haggle.
        const unitPrice =
          action.type === "offer" ? adjustedUnitPrice(action.itemId, adjustmentFor(conversation, action.itemId)) : npcBuyUnitPrice(ctx.npcId, action.itemId);
        const trade: TradeProposal = { kind: action.type, itemId: action.itemId, qty: action.qty, unitPrice, price: unitPrice * action.qty };
        trades.push(trade);
        const { kind, ...terms } = trade;
        accepted.push(kind === "offer" ? { type: "offer", ...terms } : { type: "buy", ...terms });
        break;
      }
      case "priceAdjustment": {
        if (ctx.npcId !== "shopkeeper") {
          reject(action.type, "not_shopkeeper");
          break;
        }
        const target = action.itemId ?? "*";
        if (action.itemId !== undefined && !(isItemId(action.itemId) && npcSells(ctx.npcId, action.itemId))) {
          reject(action.type, isItemId(action.itemId) ? "not_sold_here" : "unknown_item");
          break;
        }
        if (Object.hasOwn(conversation.adjustments, target)) {
          reject(action.type, "already_adjusted");
          break;
        }
        const pct = clampPriceAdjustment(action.pct, hearts);
        conversation.adjustments[target] = pct;
        accepted.push({ type: "priceAdjustment", itemId: action.itemId !== undefined && isItemId(action.itemId) ? action.itemId : null, pct });
        break;
      }
      case "friendshipDelta": {
        const delta = Math.max(-1, Math.min(1, action.delta));
        if (delta === 0) break; // "Most turns are 0": nothing to accept or reject.
        if (delta > 0 && (conversation.friendshipUp >= FRIENDSHIP_UP_PER_CONVERSATION || daily.friendshipUp >= FRIENDSHIP_UP_PER_DAY)) {
          reject(action.type, "friendship_cap");
          break;
        }
        if (delta < 0 && conversation.friendshipDown >= FRIENDSHIP_DOWN_PER_CONVERSATION) {
          reject(action.type, "friendship_cap");
          break;
        }
        const next = Math.min(MAX_HEARTS, Math.max(0, hearts + delta * HEARTS_PER_FRIENDSHIP_POINT));
        const change = next - hearts;
        hearts = next;
        effects.hearts += change;
        if (delta > 0) {
          conversation.friendshipUp++;
          daily.friendshipUp++;
        } else conversation.friendshipDown++;
        accepted.push({ type: "friendshipDelta", delta, hearts: change });
        break;
      }
      case "give": {
        if (!isItemId(action.itemId)) {
          reject(action.type, "unknown_item");
          break;
        }
        if (!npcGiftTable(ctx.npcId).includes(action.itemId)) {
          reject(action.type, "not_in_gift_table");
          break;
        }
        if (daily.gifts >= GIFTS_PER_DAY) {
          reject(action.type, "gift_cap");
          break;
        }
        daily.gifts++;
        effects.items.push({ itemId: action.itemId, qty: 1 });
        accepted.push({ type: "give", itemId: action.itemId, qty: 1 });
        break;
      }
      case "teachRecipe": {
        const recipe = getRecipe(action.recipeId);
        if (!recipe) {
          reject(action.type, "unknown_recipe");
          break;
        }
        if (recipe.teacher !== ctx.npcId) {
          reject(action.type, "not_teacher");
          break;
        }
        if (hearts < recipe.heartsRequired) {
          reject(action.type, "hearts_required");
          break;
        }
        if (ctx.knownRecipes.includes(recipe.id)) {
          reject(action.type, "already_known");
          break;
        }
        effects.recipes.push(recipe.id);
        accepted.push({ type: "teachRecipe", recipeId: recipe.id });
        break;
      }
      case "giveQuest": {
        if (!ctx.questsOffered.includes(action.questId)) {
          reject(action.type, "unknown_quest");
          break;
        }
        effects.questsGiven.push(action.questId);
        accepted.push({ type: "giveQuest", questId: action.questId });
        break;
      }
      case "completeQuest": {
        // What the model says does not count: only the server's own conditions (TODO(M30)).
        if (!ctx.questsCompletable.includes(action.questId)) {
          reject(action.type, "conditions_not_met");
          break;
        }
        effects.questsCompleted.push(action.questId);
        // GDD §8.2: completed requests raise friendship (not capped by the friendshipDelta limits).
        const next = clampHearts(hearts + QUEST_COMPLETION_HEARTS);
        effects.hearts += next - hearts;
        hearts = next;
        accepted.push({ type: "completeQuest", questId: action.questId });
        break;
      }
      case "endConversation":
        ended = true;
        accepted.push({ type: "endConversation" });
        break;
    }
  }
  return { accepted, rejected, trades, effects, ended, conversation, daily };
}

// ---------------------------------------------------------------------------------------------
// Settling a confirmed trade

export type TradeFailure = "insufficient_coins" | "not_owned" | "inventory_full";

export interface Wallet {
  coins: number;
  /** How many of the trade's item the player holds. */
  held: number;
}

export type TradeSettlement = { ok: true; coins: number; items: number } | { ok: false; reason: TradeFailure };

/**
 * The coin and item change of a confirmed trade: buying from the NPC costs coins (never below 0),
 * selling needs the items. The inventory capacity is the store's check (`applyItemDeltas`).
 */
export function settleTrade(trade: TradeProposal, wallet: Wallet): TradeSettlement {
  if (trade.kind === "offer") {
    if (wallet.coins < trade.price) return { ok: false, reason: "insufficient_coins" };
    return { ok: true, coins: -trade.price, items: trade.qty };
  }
  if (wallet.held < trade.qty) return { ok: false, reason: "not_owned" };
  return { ok: true, coins: trade.price, items: -trade.qty };
}
