// @vitest-environment jsdom
import type { Room } from "@colyseus/sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  baseQuestReward,
  ClientMessage,
  getQuestTemplate,
  type NpcContextMessage,
  type PlayerProfile,
  type QuestNotice,
  type QuestStateMessage,
  type QuestView,
  ServerMessage,
} from "@hellovalley/shared";
import { I18nProvider } from "../../i18n/I18nProvider";
import { labelStore, setLabelLoader } from "../../labels/labelStore";
import { attachQuests, sendAccept, sendHandOver } from "../../net/questSession";
import { avatarStore } from "../../state/avatarStore";
import { type ConversationStore, createConversationStore } from "../../state/conversationStore";
import { createInventoryStore, type InventoryStore } from "../../state/inventoryStore";
import { createQuestStore, type QuestStore } from "../../state/questStore";
import { worldStore } from "../../state/worldStore";
import { QuestLayer } from "./QuestLayer";

/**
 * Build plan M30: the notice board shows today's three requests with their notice in the target
 * language (and the quest card in world labels when there is none), Accept sends `quest:accept`,
 * the log (J) shows what the player took on with its progress, the "Hand over" card appears in a
 * conversation with the right villager, and the server's answers show as a notice.
 */

const profile = { name: "Lia", targetLangs: ["es"], nativeLang: "en" } as unknown as PlayerProfile;
const view = (templateId: string, over: Partial<QuestView> = {}): QuestView => {
  const t = getQuestTemplate(templateId)!;
  const turnIn = t.target.kind === "deliver" ? t.target.to : t.target.kind === "fetch" ? t.giver : null;
  return { questId: `q7-${templateId}`, templateId, source: "board", giver: t.giver, target: t.target, reward: baseQuestReward(t), status: "open", progress: 0, turnIn, ...over };
};
const EGGS_NOTICE: QuestNotice = {
  title: { text: "¡Aviso importante!", translation: "Important notice!" },
  body: [{ text: "La granjera necesita 3 huevos en la panadería antes de las 12:00.", translation: "The farmer needs 3 eggs at the bakery before 12:00." }],
};

let store: QuestStore;
let convo: ConversationStore;
let inventory: InventoryStore;

beforeEach(() => {
  store = createQuestStore();
  convo = createConversationStore();
  inventory = createInventoryStore();
  labelStore.setState({ byLang: {}, status: {} });
  setLabelLoader(async () => ({
    labels: { "item.egg": { word: "huevo" }, "quest.kind.deliver": { word: "entregar" }, "npc.baker": { word: "panadera" }, "item.wild_herb": { word: "hierba silvestre" } },
    complete: true,
  }));
  avatarStore.setState({ profile });
  worldStore.setState({ space: "town", nearby: null });
});
afterEach(() => {
  cleanup();
  avatarStore.setState({ profile: null });
  worldStore.setState({ nearby: null });
});

const ui = (props: Partial<Parameters<typeof QuestLayer>[0]> = {}) => {
  const accept = vi.fn(() => true);
  const handOver = vi.fn(() => true);
  const notice = vi.fn(async ({ templateId }: { templateId: string }) => (templateId === "eggs_to_bakery" ? EGGS_NOTICE : null));
  render(
    <I18nProvider locale="en">
      <QuestLayer store={store} conversation={convo} inventory={inventory} notice={notice} accept={accept} handOver={handOver} {...props} />
    </I18nProvider>,
  );
  return { accept, handOver, notice };
};

describe("quest layer (build plan M30)", () => {
  it("opens the notice board at the board with today's requests in the target language, and accepts one", async () => {
    store.setState({ day: 7, level: "A2", board: [view("eggs_to_bakery"), view("two_fish_for_elder"), view("find_flowers", { status: "active" })] });
    worldStore.setState({ nearby: { id: "town:notice_board", kind: "notice_board" } });
    const { accept, notice } = ui();
    fireEvent.click(screen.getByRole("button", { name: "📋 Read the notice board (F)" }));
    expect(store.getState().boardOpen).toBe(true);
    expect(screen.getByRole("dialog", { name: "📋 Town Hall notice board" })).toBeTruthy();
    // The Mayor's notice, with its translation on hover; the notice is asked at the player's level.
    const title = await screen.findByText("¡Aviso importante!");
    expect(title.getAttribute("title")).toBe("Important notice!");
    expect(notice).toHaveBeenCalledWith({ templateId: "eggs_to_bakery", targetLang: "es", nativeLang: "en", level: "A2" });
    // The details as world labels, the deadline and the reward.
    expect(screen.getByText("entregar")).toBeTruthy();
    expect(screen.getByText("panadera")).toBeTruthy();
    expect(screen.getAllByText("Before 12:00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Reward: 14 coins, \+1 ♥ with the Farmer/)).toBeTruthy();
    // No notice for the fish request: the quest card still carries the details.
    expect((await screen.findAllByText("The notice can't be read right now. The details are below.")).length).toBe(2);
    // Accept only on open requests.
    const buttons = screen.getAllByRole("button", { name: "Accept" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(accept).toHaveBeenCalledWith("q7-eggs_to_bakery");
    expect(screen.getByText("In progress")).toBeTruthy();
    // Walking away closes the board.
    act(() => worldStore.setState({ nearby: null }));
    expect(store.getState().boardOpen).toBe(false);
  });

  it("shows the log with progress (J), and the server's answers", async () => {
    store.setState({ day: 7, level: "A1", log: [view("two_fish_for_elder", { status: "active", progress: 1 }), view("bake_bread", { status: "completed", progress: 1 })] });
    ui();
    expect(screen.getByRole("button", { name: /Requests/ }).textContent).toContain("1");
    fireEvent.keyDown(window, { code: "KeyJ" });
    expect(screen.getByRole("dialog", { name: "📜 Requests" })).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    fireEvent.keyDown(window, { code: "Escape" });
    expect(store.getState().logOpen).toBe(false);

    act(() => store.setState({ last: { questId: "q7-bake_bread", action: "complete", ok: true, via: "auto", reward: { coins: 12, hearts: 1 }, coins: 30, hearts: 2 } }));
    expect(screen.getByText("Request done! +12 coins, +1 ♥ with the Baker")).toBeTruthy();
    act(() => store.setState({ last: { questId: "q7-eggs_to_bakery", action: "accept", ok: false, reason: "too_far" } }));
    expect(screen.getByText("Walk up to the notice board.")).toBeTruthy();
  });

  it("offers the hand-over in a conversation with the right villager, only with the items", async () => {
    store.setState({ day: 7, log: [view("eggs_to_bakery", { status: "active" }), view("herbs_for_doctor", { status: "active" })] });
    convo.setState({ phase: "open", npcId: "baker", context: { conversationId: "c-1" } as NpcContextMessage });
    inventory.setState({ slots: [{ slot: 0, itemId: "egg", qty: 2 }] });
    const { handOver } = ui();
    const short = (await screen.findByRole("button", { name: /You need 3 × huevo/ })) as HTMLButtonElement;
    expect(short.disabled).toBe(true);
    // Not the Doctor's errand here.
    expect(screen.queryByRole("button", { name: /Wild herb/ })).toBeNull();
    act(() => inventory.setState({ slots: [{ slot: 0, itemId: "egg", qty: 3 }] }));
    fireEvent.click(screen.getByRole("button", { name: /Hand over 3 × huevo/ }));
    expect(handOver).toHaveBeenCalledWith("c-1", "q7-eggs_to_bakery");
  });

  it("mirrors quests:state and quest:result, and sends one request at a time", () => {
    const handlers = new Map<string, (m: unknown) => void>();
    const sent: { type: string; payload: unknown }[] = [];
    const room = {
      connection: { isOpen: true },
      onMessage: (type: string, cb: (m: unknown) => void) => {
        handlers.set(type, cb);
        return () => handlers.delete(type);
      },
      send: (type: string, payload: unknown) => sent.push({ type, payload }),
    } as unknown as Room;
    const off = attachQuests(room, store);
    const state: QuestStateMessage = { day: 9, level: "B1", board: [view("eggs_to_bakery")], log: [] };
    handlers.get(ServerMessage.QuestState)!(state);
    expect(store.getState()).toMatchObject({ day: 9, level: "B1", board: state.board });
    expect(sendAccept("q9-eggs_to_bakery", store, room)).toBe(true);
    expect(sendAccept("q9-other", store, room)).toBe(false);
    handlers.get(ServerMessage.QuestResult)!({ questId: "q9-eggs_to_bakery", action: "accept", ok: true, via: "board" });
    expect(store.getState().sending).toBeNull();
    expect(sendHandOver("c-1", "q9-eggs_to_bakery", store, room)).toBe(true);
    expect(sent).toEqual([
      { type: ClientMessage.QuestAccept, payload: { questId: "q9-eggs_to_bakery" } },
      { type: ClientMessage.QuestTurnIn, payload: { conversationId: "c-1", questId: "q9-eggs_to_bakery" } },
    ]);
    off();
    expect(store.getState().day).toBeNull();
  });
});
