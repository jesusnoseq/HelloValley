import { describe, expect, it } from "vitest";
import { getItem, ITEMS, type ItemId, NPC_GIFTS, npcSells } from "../data/items";
import { NPC_IDS } from "../data/npcs";
import { InventorySlotSchema } from "../firestore/schemas";
import { parseClientMessage } from "../protocol/schemas";
import { ClientMessage } from "../protocol/messages";
import {
  type ActionContext,
  adjustedUnitPrice,
  clampPriceAdjustment,
  emptyConversationLedger,
  emptyDailyLedger,
  FIND_BUY_BACK_RATE,
  type NpcAction,
  NpcActionListSchema,
  npcBuyBackRate,
  npcBuyUnitPrice,
  npcGiftTable,
  npcSellUnitPrice,
  openingAdjustment,
  PRICE_ADJUSTMENT_MAX_PCT,
  PRICE_ADJUSTMENT_MIN_PCT,
  settleTrade,
  SHOPKEEPER_OPENING_PCT,
  validateNpcActions,
} from "./actions";
import { applyItemDeltas, HOTBAR_FIRST_SLOT, HOTBAR_SLOT_INDEXES, isHotbarSlot, MAX_STACK, moveSlot, type SlotEntry, TOTAL_SLOTS } from "./inventory";

/** Build plan M26: prices, haggling, buy-back, gift tables and inventory moves (all pure). */

const ctxFor = (over: Partial<ActionContext> = {}): ActionContext => ({
  npcId: "shopkeeper",
  hearts: 0,
  inventory: {},
  knownRecipes: [],
  questsOffered: [],
  questsCompletable: [],
  conversation: emptyConversationLedger(),
  daily: emptyDailyLedger(),
  ...over,
});
const actions = (list: unknown[]): NpcAction[] => NpcActionListSchema.parse(list);

describe("shop prices", () => {
  it("lets the Shopkeeper open with inflated prices and the others at the base price", () => {
    expect(SHOPKEEPER_OPENING_PCT).toBe(PRICE_ADJUSTMENT_MAX_PCT);
    expect(openingAdjustment("shopkeeper")).toBe(10);
    expect(openingAdjustment("baker")).toBe(0);
    expect(npcSellUnitPrice("shopkeeper", "fishing_rod")).toBe(55);
    expect(npcSellUnitPrice("baker", "bread")).toBe(5);
    // Never below one coin.
    expect(adjustedUnitPrice("flour", -100)).toBe(1);
  });

  it("pays full price for finds at the shop that wants them and lowballs at the general store", () => {
    expect(npcBuyBackRate("farmer", "chanterelle")).toBe(FIND_BUY_BACK_RATE);
    expect(npcBuyUnitPrice("farmer", "chanterelle")).toBe(8);
    expect(npcBuyUnitPrice("doctor", "mint")).toBe(4);
    expect(npcBuyUnitPrice("librarian", "old_letter")).toBe(20);
    expect(npcBuyUnitPrice("shopkeeper", "chanterelle")).toBe(2);
    // Shop goods bought back at half price.
    expect(npcBuyUnitPrice("baker", "egg")).toBe(1);
    // Selling never pays more than buying the same item costs anywhere.
    for (const npcId of NPC_IDS) {
      for (const itemId of Object.keys(ITEMS) as ItemId[]) {
        if (!npcSells(npcId, itemId)) continue;
        for (const buyer of NPC_IDS) expect(npcBuyUnitPrice(buyer, itemId)).toBeLessThanOrEqual(npcSellUnitPrice(npcId, itemId, { friendshipUp: 0, friendshipDown: 0, adjustments: { "*": PRICE_ADJUSTMENT_MIN_PCT } }));
      }
    }
  });
});

describe("haggling (GDD §5.1, architecture §6.1)", () => {
  it("clamps the model's adjustment to −30..+10 % and scales discounts by friendship", () => {
    expect(clampPriceAdjustment(-30, 0)).toBe(-15);
    expect(clampPriceAdjustment(-30, 5)).toBe(-22); // −22.5 rounds towards the opening price
    expect(clampPriceAdjustment(-30, 10)).toBe(-30);
    expect(clampPriceAdjustment(-1000, 10)).toBe(-30);
    expect(clampPriceAdjustment(1000, 0)).toBe(10);
    expect(clampPriceAdjustment(5, 0)).toBe(5);
    expect(clampPriceAdjustment(-20, 99)).toBe(-20);
    expect(clampPriceAdjustment(-20, -5)).toBe(-10);
    expect(clampPriceAdjustment(Number.POSITIVE_INFINITY, 3)).toBe(0);
    // More hearts never mean a worse price.
    for (let h = 0; h < 10; h++) expect(clampPriceAdjustment(-30, h + 1)).toBeLessThanOrEqual(clampPriceAdjustment(-30, h));
  });

  it("haggles a fishing rod down at the store, once, and never below the floor", () => {
    const friend = ctxFor({ hearts: 10 });
    const v = validateNpcActions(actions([{ type: "priceAdjustment", itemId: "fishing_rod", pct: -25 }, { type: "offer", itemId: "fishing_rod", price: 1 }]), friend);
    expect(v.trades).toEqual([{ kind: "offer", itemId: "fishing_rod", qty: 1, unitPrice: 38, price: 38 }]);
    const stranger = validateNpcActions(actions([{ type: "priceAdjustment", pct: -90 }, { type: "offer", itemId: "fishing_rod" }]), ctxFor());
    expect(stranger.trades[0]?.unitPrice).toBe(adjustedUnitPrice("fishing_rod", -15));
    // A second haggle on the same item in the conversation is refused; the price holds.
    const again = validateNpcActions(actions([{ type: "priceAdjustment", itemId: "fishing_rod", pct: -30 }, { type: "offer", itemId: "fishing_rod" }]), { ...friend, conversation: v.conversation });
    expect(again.rejected).toEqual([{ type: "priceAdjustment", reason: "already_adjusted" }]);
    expect(again.trades[0]?.unitPrice).toBe(38);
    // Without a haggle the opening (inflated) price applies.
    expect(validateNpcActions(actions([{ type: "offer", itemId: "flour" }]), ctxFor()).trades[0]?.unitPrice).toBe(adjustedUnitPrice("flour", 10));
  });

  it("does not let other NPCs haggle", () => {
    const v = validateNpcActions(actions([{ type: "priceAdjustment", pct: -30 }, { type: "offer", itemId: "bread" }]), ctxFor({ npcId: "baker", hearts: 10 }));
    expect(v.rejected).toEqual([{ type: "priceAdjustment", reason: "not_shopkeeper" }]);
    expect(v.trades[0]?.unitPrice).toBe(5);
  });
});

describe("trades", () => {
  it("never lets coins go negative and needs the items to sell", () => {
    const offer = { kind: "offer" as const, itemId: "cake" as const, qty: 2, unitPrice: 15, price: 30 };
    expect(settleTrade(offer, { coins: 29, held: 0 })).toEqual({ ok: false, reason: "insufficient_coins" });
    expect(settleTrade(offer, { coins: 30, held: 0 })).toEqual({ ok: true, coins: -30, items: 2 });
    const sale = { kind: "buy" as const, itemId: "daisy" as const, qty: 3, unitPrice: 2, price: 6 };
    expect(settleTrade(sale, { coins: 0, held: 2 })).toEqual({ ok: false, reason: "not_owned" });
    expect(settleTrade(sale, { coins: 0, held: 3 })).toEqual({ ok: true, coins: 6, items: -3 });
  });
});

describe("gift tables", () => {
  it("lists cheap, sellable items for every villager, residents included", () => {
    for (const npcId of NPC_IDS) {
      expect(NPC_GIFTS[npcId].length).toBeGreaterThan(0);
      expect(npcGiftTable(npcId)).toEqual([...NPC_GIFTS[npcId]]);
      for (const itemId of NPC_GIFTS[npcId]) {
        const item = getItem(itemId)!;
        expect(item.sellable).toBe(true);
        expect(item.basePrice).toBeLessThanOrEqual(6);
      }
    }
    const v = validateNpcActions(actions([{ type: "give", itemId: "fishing_rod" }]), ctxFor());
    expect(v.rejected).toEqual([{ type: "give", reason: "not_in_gift_table" }]);
    expect(validateNpcActions(actions([{ type: "give", itemId: "tea" }]), ctxFor({ npcId: "elder" })).effects.items).toEqual([{ itemId: "tea", qty: 1 }]);
  });
});

describe("inventory slots (GDD §5.6)", () => {
  const bag: SlotEntry[] = [
    { slot: 0, itemId: "bread", qty: 3 },
    { slot: 1, itemId: "daisy", qty: 98 },
    { slot: 5, itemId: "daisy", qty: 4 },
  ];

  it("has 24 bag slots and a hotbar of 6 after them", () => {
    expect(TOTAL_SLOTS).toBe(30);
    expect(HOTBAR_FIRST_SLOT).toBe(24);
    expect(HOTBAR_SLOT_INDEXES).toEqual([24, 25, 26, 27, 28, 29]);
    expect(isHotbarSlot(23)).toBe(false);
    expect(isHotbarSlot(29)).toBe(true);
    expect(isHotbarSlot(30)).toBe(false);
  });

  it("moves into an empty slot, merges the same item and swaps different ones", () => {
    const moved = moveSlot(bag, 0, 24);
    expect(moved).toEqual({ ok: true, slots: [{ slot: 1, itemId: "daisy", qty: 98 }, { slot: 5, itemId: "daisy", qty: 4 }, { slot: 24, itemId: "bread", qty: 3 }], changed: [0, 24] });
    const merged = moveSlot(bag, 5, 1);
    expect(merged.ok && merged.slots).toEqual([{ slot: 0, itemId: "bread", qty: 3 }, { slot: 1, itemId: "daisy", qty: 99 }, { slot: 5, itemId: "daisy", qty: 3 }]);
    const swapped = moveSlot(bag, 0, 1);
    expect(swapped.ok && swapped.slots.slice(0, 2)).toEqual([{ slot: 0, itemId: "daisy", qty: 98 }, { slot: 1, itemId: "bread", qty: 3 }]);
    // A full stack onto the same item changes nothing.
    const full: SlotEntry[] = [{ slot: 0, itemId: "egg", qty: MAX_STACK }, { slot: 1, itemId: "egg", qty: 2 }];
    expect(moveSlot(full, 1, 0)).toEqual({ ok: true, slots: full, changed: [] });
    expect(moveSlot(bag, 2, 2)).toEqual({ ok: false, reason: "empty_slot" });
    expect(moveSlot(bag, 0, 0)).toEqual({ ok: true, slots: bag, changed: [] });
  });

  it("refuses slots out of range and never creates or loses items", () => {
    expect(moveSlot(bag, -1, 3)).toEqual({ ok: false, reason: "bad_slot" });
    expect(moveSlot(bag, 0, 30)).toEqual({ ok: false, reason: "bad_slot" });
    expect(moveSlot(bag, 0.5, 3)).toEqual({ ok: false, reason: "bad_slot" });
    const total = (slots: readonly SlotEntry[]) => slots.reduce((n, s) => n + s.qty, 0);
    for (let from = 0; from < 6; from++) {
      for (let to = 0; to < 6; to++) {
        const r = moveSlot(bag, from, to);
        if (r.ok) expect(total(r.slots)).toBe(total(bag));
      }
    }
  });

  it("fills the bag before the hotbar and stacks up to 99", () => {
    const r = applyItemDeltas([], [{ itemId: "daisy", qty: 120 }]);
    expect(r.ok && r.slots).toEqual([{ slot: 0, itemId: "daisy", qty: 99 }, { slot: 1, itemId: "daisy", qty: 21 }]);
    expect(InventorySlotSchema.safeParse({ itemId: "daisy", qty: 100 }).success).toBe(false);
    expect(InventorySlotSchema.safeParse({ itemId: "daisy", qty: 99 }).success).toBe(true);
  });

  it("validates inventory:move payloads", () => {
    expect(parseClientMessage(ClientMessage.InventoryMove, { from: 0, to: 29, moveId: 1 }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.InventoryMove, { from: 0, to: 30, moveId: 1 }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.InventoryMove, { from: 0, to: 1, moveId: 1, qty: 5 }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.InventoryMove, { from: "0", to: 1, moveId: 1 }).ok).toBe(false);
  });
});
