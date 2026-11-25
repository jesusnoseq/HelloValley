import { describe, expect, it } from "vitest";
import { ClientMessage, NPC_POSTS, NPC_WALK_AWAY_M, type NpcContextMessage, type NpcMemoryMessage } from "@hellovalley/shared";
import { npcContextFixture } from "../../../../shared/src/npc/fixtures";
import type { InputHelpers } from "../../ai/client";
import { createConversationStore } from "../../state/conversationStore";
import type { Toast } from "../../state/toastStore";
import { ConversationController, type ConversationDeps } from "./controller";
import { fakeNpcAi, fakeNpcServer } from "./fakeNpc";

const flush = () => new Promise((r) => setTimeout(r, 5));
const player = { name: "Lia", animal: "fox", apartmentId: "3B" };

function make(
  o: { level?: "A1" | "B1" | "C1"; helpers?: InputHelpers | null; refuse?: boolean; checkTimeoutMs?: number; room?: boolean; levelChange?: -1 | 0 | 1; inventory?: NpcContextMessage["inventory"] } = {},
) {
  const ctx = { ...npcContextFixture({ lang: "es", playerLevel: o.level ?? "A1" }), inventory: o.inventory ?? [] };
  const server = fakeNpcServer(ctx, { ...(o.refuse ? { refuse: "baker" as const } : {}), levelChange: o.levelChange ?? 0 });
  const toasts: Omit<Toast, "id">[] = [];
  const ai = fakeNpcAi();
  const deps: ConversationDeps = {
    room: () => (o.room === false ? null : server.room),
    ai: async () => ai,
    helpers: async () => o.helpers ?? null,
    player: () => player,
    checkTimeoutMs: o.checkTimeoutMs ?? 50,
    toast: (t) => void toasts.push(t),
  };
  const store = createConversationStore();
  return { controller: new ConversationController(deps, store), store, server, ai, toasts };
}

describe("ConversationController", () => {
  it("starts with the opener and starter suggestions by level", async () => {
    const a1 = make();
    await a1.controller.open("baker");
    expect(a1.store.getState()).toMatchObject({ phase: "open", npcId: "baker", style: "replies", coins: 50 });
    expect(a1.store.getState().log).toHaveLength(1);
    expect(a1.store.getState().suggestions.map((s) => s.text)).toEqual(["¡Hola!", "¿Qué tienes hoy?", "¡Adiós!"]);
    // B1 at the Baker is effective A2 (still three); the B1 rule shows at a 0-offset NPC in the shared tests.
    const c1 = make({ level: "C1" });
    await c1.controller.open("baker");
    expect(c1.store.getState()).toMatchObject({ style: "starter" });
    expect(c1.store.getState().suggestions).toHaveLength(1);
  });

  it("explains why a conversation could not start", async () => {
    const offline = make({ room: false });
    await offline.controller.open("baker");
    expect(offline.store.getState()).toMatchObject({ phase: "unavailable", notice: { kind: "offline" } });
    const far = make({ refuse: true });
    await far.controller.open("baker");
    expect(far.store.getState()).toMatchObject({ phase: "unavailable", notice: { kind: "refused", reason: "too_far" } });
    far.controller.end();
    expect(far.store.getState().phase).toBe("idle");
  });

  it("ends when the player walks away or leaves the room", async () => {
    const { controller, store, server } = make();
    const { pos, space } = NPC_POSTS.baker;
    await controller.open("baker");
    controller.updatePosition(space, [pos[0], pos[1] + NPC_WALK_AWAY_M - 0.2]);
    expect(store.getState().phase).toBe("open");
    controller.updatePosition(space, [pos[0], pos[1] + NPC_WALK_AWAY_M + 0.2]);
    expect(store.getState().phase).toBe("idle");
    expect(server.sent.at(-1)?.type).toBe(ClientMessage.NpcEnd);

    await controller.open("baker");
    controller.updatePosition("town", [0, 0]);
    expect(store.getState().phase).toBe("idle");
  });

  it("walks to a clicked NPC first and talks on arrival; walking off cancels", async () => {
    const { controller, store, server } = make();
    const { space, talkSpot } = NPC_POSTS.baker;
    controller.requestTalk("baker", space, [talkSpot[0], 4.8]);
    expect(store.getState()).toMatchObject({ phase: "idle", pendingTalk: "baker" });
    controller.updatePosition(space, [talkSpot[0], 4.6]);
    expect(store.getState().phase).toBe("idle");
    controller.updatePosition(space, talkSpot);
    await flush();
    expect(store.getState()).toMatchObject({ phase: "open", pendingTalk: null });
    expect(server.sent[0]?.type).toBe(ClientMessage.NpcStart);

    const other = make();
    other.controller.requestTalk("baker", space, [talkSpot[0], 4.8]);
    other.controller.cancelPending();
    other.controller.updatePosition(space, talkSpot);
    expect(other.store.getState()).toMatchObject({ phase: "idle", pendingTalk: null });
  });

  it("sends unchecked when the on-device check is unavailable or too slow", async () => {
    const never = new Promise<never>(() => undefined);
    const slow: InputHelpers = { detectLanguage: () => never, grammarFeedback: () => never };
    for (const helpers of [null, slow]) {
      const { controller, ai } = make({ helpers, checkTimeoutMs: 20 });
      await controller.open("baker");
      expect(await controller.submit("Quiero pan", "typed")).toBe("sent");
      await flush();
      expect(ai.calls).toEqual(["Quiero pan"]);
    }
  });

  it("offers the better version, or sends the original anyway", async () => {
    const helpers: InputHelpers = {
      detectLanguage: async () => ({ ok: true, value: { lang: "es" }, source: "on-device" }),
      grammarFeedback: async () => ({ ok: true, value: { ok: false, better: "Quiero pan, por favor." }, source: "on-device" }),
    };
    const { controller, store, ai } = make({ helpers });
    await controller.open("baker");
    expect(await controller.submit("Quiero pan", "typed")).toBe("checked");
    expect(store.getState().check).toMatchObject({ status: "suggest", better: "Quiero pan, por favor." });
    controller.sendAnyway();
    await flush();
    expect(ai.calls).toEqual(["Quiero pan"]);
    expect(store.getState().cards).toEqual([expect.objectContaining({ kind: "trade", status: "open" })]);
    // Suggested replies skip the check.
    expect(await controller.submit("Sí, por favor.", "suggested")).toBe("sent");
  });

  it("settles trades through the server and ignores answers after goodbye", async () => {
    const { controller, store, server } = make();
    await controller.open("baker");
    await controller.submit("Quiero pan", "suggested");
    await flush();
    const card = store.getState().cards[0]!;
    await controller.confirm(card.id, true);
    expect(store.getState()).toMatchObject({ coins: 45, cards: [{ status: "done" }] });
    // A second line, then goodbye before the answer lands: the late answer is dropped.
    void controller.submit("¿Tienes pan?", "suggested");
    controller.end();
    await flush();
    expect(store.getState()).toMatchObject({ phase: "idle", log: [], cards: [] });
    // npc:end at once, then the compaction of the finished turn (build plan M24).
    expect(server.sent.slice(-2).map((m) => m.type)).toEqual([ClientMessage.NpcEnd, ClientMessage.NpcMemory]);
  });

  it("sends the compaction with the telemetry after goodbye, and toasts a level change (M24)", async () => {
    const { controller, server, toasts } = make({ levelChange: 1 });
    await controller.open("baker");
    controller.noteTranslation("¡Hola, cariño! ¿Qué quieres hoy?");
    controller.noteTranslation("¡Hola, cariño! ¿Qué quieres hoy?");
    await controller.submit("Quiero pan", "suggested");
    await flush();
    await controller.submit("¿Tienes pan?", "typed");
    await flush();
    controller.end();
    await flush();
    const memory = server.sent.find((m) => m.type === ClientMessage.NpcMemory)?.payload as NpcMemoryMessage;
    expect(memory).toMatchObject({ conversationId: "conv-1", summary: "Lia likes bread.", facts: ["Lia likes bread"] });
    expect(memory.telemetry).toEqual({ suggested: 1, free: 1, npcLines: 3, translationsShown: 1, corrections: 0 });
    expect(toasts).toEqual([{ kind: "level", npcId: "baker", direction: 1 }]);
  });

  it("sends no memory for a conversation without a player turn, and no toast without a level change", async () => {
    const silent = make({ levelChange: 1 });
    await silent.controller.open("baker");
    silent.controller.end();
    await flush();
    expect(silent.server.sent.map((m) => m.type)).toEqual([ClientMessage.NpcStart, ClientMessage.NpcEnd]);
    expect(silent.toasts).toEqual([]);

    const steady = make();
    await steady.controller.open("baker");
    await steady.controller.submit("Quiero pan", "suggested");
    await flush();
    steady.controller.end();
    await flush();
    expect(steady.server.sent.at(-1)?.type).toBe(ClientMessage.NpcMemory);
    expect(steady.toasts).toEqual([]);
  });

  it("gives a gift from the profile card and shows how the NPC took it (M24)", async () => {
    const { controller, store } = make({ inventory: [{ itemId: "butter", qty: 1 }, { itemId: "carp", qty: 1 }] });
    await controller.open("baker");
    await controller.gift("butter");
    expect(store.getState().cards.at(-1)).toMatchObject({ kind: "given", itemId: "butter", reaction: "liked", delta: 1 });
    expect(store.getState().context).toMatchObject({ hearts: 1, giftedToday: true, inventory: [{ itemId: "carp", qty: 1 }] });
    expect(store.getState().gifting).toBeNull();
    await controller.gift("carp");
    expect(store.getState().cards.at(-1)).toMatchObject({ kind: "giftFailed", itemId: "carp", reason: "gift_cap" });
  });
});
