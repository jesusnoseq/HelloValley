import {
  type ApprovedAction,
  canTalkTo,
  type NpcLocator,
  type ConversationTelemetry,
  emptyTelemetry,
  getNpc,
  type ItemId,
  type LostItemId,
  type InputMethod,
  type NpcAppliedMessage,
  type NpcId,
  type NpcPlayerInfo,
  type NpcTurnReply,
  requestedSuggestions,
  type SpaceId,
  starterSuggestions,
  type SuggestedReply,
  suggestionStyle,
  type Vec2,
  walkedAway,
} from "@hellovalley/shared";
import { type InputHelpers, loadInputHelpers, loadNpcAi } from "../../ai/client";
import { type NpcAi, NpcConversation, NpcRefusedError, type NpcRoom } from "../../net/npcConversation";
import { liveNpcLocator, townSession } from "../../net/townSession";
import { avatarStore } from "../../state/avatarStore";
import { type Toast, toastStore } from "../../state/toastStore";
import {
  type Card,
  conversationStore,
  type ConversationStore,
  IDLE_CONVERSATION,
  type LogEntry,
} from "../../state/conversationStore";

/**
 * The conversation controller (build plan M23, GDD §6.2, §8.1, architecture §5.3). It drives one
 * `NpcConversation` (net/npcConversation.ts) and keeps the panel's state in `conversationStore`:
 *
 * - start: `npc:start` → context → the cached opener (personalised on-device when possible), with
 *   starter suggestions until the first model turn brings its own;
 * - each player line: unless it was a suggested reply, a quick on-device check first: language
 *   detection (a line in the native language is sent anyway and gently redirected: the NPC
 *   answers in the target language and teaches the phrase) and grammar feedback (a soft
 *   "✨ … sounds more natural" chip; the player can send the original anyway). Both are skipped
 *   silently when on-device AI is unavailable or slow;
 * - the model turn, the server's verdict (`npc:applied`) and its cards: trades wait for Buy / No
 *   (`npc:confirm`, the server settles them), gifts, quests and recipes are shown;
 * - gifts from the NPC profile card (`npc:gift`, build plan M24), and lost items handed back to
 *   their owner (`npc:return`, build plan M28);
 * - goodbye, or walking away (`updatePosition`), sends `npc:end` at once; then, in the
 *   background, the compaction (on-device first, AI Logic cloud fallback) goes to the server as
 *   `npc:memory` with the panel's telemetry (suggested vs free replies, translations opened,
 *   corrections), and a ½-step level change shows a toast (GDD §6.4, build plan M24).
 */

export interface ConversationDeps {
  room(): NpcRoom | null;
  ai(): Promise<NpcAi>;
  /** On-device input helpers; null (or a failure) skips the check. */
  helpers(): Promise<InputHelpers | null>;
  player(): NpcPlayerInfo | null;
  /** How long the pre-send check may take before the line goes out unchecked (ms). */
  checkTimeoutMs?: number;
  /** Shows a toast (defaults to the game's toast store). */
  toast?: (toast: Omit<Toast, "id">) => void;
  /** Where the villagers are (build plan M31: the room's live positions; defaults to `liveNpcLocator`). */
  locate?: NpcLocator;
}

/** The pre-send check never holds a line longer than this (my number: it must feel instant). */
export const CHECK_TIMEOUT_MS = 1500;

export type SubmitResult = "sent" | "checked" | "ignored";

const baseLang = (lang: string) => lang.split("-")[0]!.toLowerCase();

function timeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export class ConversationController {
  private conversation: NpcConversation | null = null;
  /** Bumped on every start and end, so late answers of an old conversation are dropped. */
  private generation = 0;
  private nextId = 1;
  /** This conversation's level telemetry (GDD §6.4), sent with its memory. */
  private telemetry: ConversationTelemetry = emptyTelemetry();
  private translations = new Set<string>();

  constructor(
    private readonly deps: ConversationDeps,
    readonly store: ConversationStore = conversationStore,
  ) {}

  private get locate(): NpcLocator {
    return this.deps.locate ?? liveNpcLocator;
  }

  private get state() {
    return this.store.getState();
  }

  private set(patch: Partial<ReturnType<ConversationStore["getState"]>>) {
    this.store.setState(patch);
  }

  private id(): number {
    return this.nextId++;
  }

  get active(): boolean {
    return this.state.phase !== "idle";
  }

  /** F or a click next to an NPC (GDD §8.1 step 1). */
  async open(npcId: NpcId): Promise<void> {
    if (this.active && this.state.npcId === npcId) return;
    if (this.active) this.end();
    const generation = ++this.generation;
    this.telemetry = emptyTelemetry();
    this.translations = new Set();
    this.set({ ...IDLE_CONVERSATION, phase: "starting", npcId, pendingTalk: null });
    const room = this.deps.room();
    const player = this.deps.player();
    if (!room || !player) {
      this.set({ phase: "unavailable", notice: { kind: "offline" } });
      return;
    }
    let conversation: NpcConversation;
    try {
      const ai = await this.deps.ai();
      if (generation !== this.generation) return;
      conversation = await NpcConversation.start(room, ai, player, npcId);
    } catch (error) {
      if (generation !== this.generation) return;
      const reason = error instanceof NpcRefusedError ? error.reason : "unavailable";
      this.set({ phase: "unavailable", notice: { kind: "refused", reason } });
      return;
    }
    if (generation !== this.generation) {
      conversation.end();
      return;
    }
    this.conversation = conversation;
    const ctx = conversation.context;
    this.set({
      context: ctx,
      coins: ctx.coins,
      style: suggestionStyle(ctx.effectiveLevel),
      suggestions: starterSuggestions(npcId, ctx.lang, ctx.nativeLang, ctx.effectiveLevel),
      extraHint: ctx.extraHints > 0 ? "available" : "none",
    });
    const opener = await conversation.opener();
    if (generation !== this.generation) return;
    if (opener) this.telemetry.npcLines++;
    this.set({
      phase: "open",
      log: opener ? [{ id: this.id(), kind: "npc", line: opener, seeded: true }] : [],
    });
  }

  /**
   * A click on an NPC (build plan M23): talk at once when within reach, otherwise remember it
   * while the scene walks the player over (`updatePosition` starts it on arrival).
   */
  requestTalk(npcId: NpcId, space: SpaceId, pos: Vec2): void {
    if (canTalkTo(npcId, space, pos, 0, this.locate)) {
      void this.open(npcId);
      return;
    }
    this.set({ pendingTalk: npcId });
  }

  cancelPending(): void {
    if (this.state.pendingTalk) this.set({ pendingTalk: null });
  }

  /**
   * The scene reports the player's position each frame: walking away ends the conversation
   * (GDD §8.1 step 4), and arriving at a clicked NPC starts one.
   */
  updatePosition(space: SpaceId, pos: Vec2): void {
    const { npcId, pendingTalk } = this.state;
    if (this.active && npcId && walkedAway(npcId, space, pos, this.locate)) this.end();
    if (pendingTalk && canTalkTo(pendingTalk, space, pos, 0, this.locate)) void this.open(pendingTalk);
  }

  /**
   * A player line. Suggested replies go out at once; typed and spoken lines get the on-device
   * check first, which may stop at a suggestion chip ("checked").
   */
  async submit(raw: string, method: InputMethod): Promise<SubmitResult> {
    const text = raw.trim();
    if (!text || this.state.phase !== "open" || !this.conversation) return "ignored";
    if (method === "suggested") {
      void this.send(text, method, false);
      return "sent";
    }
    const generation = this.generation;
    this.set({ check: { status: "checking", text } });
    const verdict = await this.check(text);
    if (generation !== this.generation || this.state.phase !== "open") return "ignored";
    if (verdict.feedback) {
      this.telemetry.corrections++;
      this.set({ check: { status: "suggest", text, method, better: verdict.feedback.better, ...(verdict.feedback.note ? { note: verdict.feedback.note } : {}) } });
      return "checked";
    }
    this.set({ check: { status: "idle" } });
    void this.send(text, method, verdict.native);
    return "sent";
  }

  /** The chip's "send mine anyway". */
  sendAnyway(): void {
    const check = this.state.check;
    if (check.status !== "suggest") return;
    this.set({ check: { status: "idle" } });
    void this.send(check.text, check.method, false);
  }

  /** The chip's "use this": the better version goes out instead. */
  useBetter(): void {
    const check = this.state.check;
    if (check.status !== "suggest") return;
    this.set({ check: { status: "idle" } });
    void this.send(check.better, check.method, false);
  }

  /** The player edits the line again: the chip goes. */
  clearCheck(): void {
    if (this.state.check.status !== "idle") this.set({ check: { status: "idle" } });
  }

  /** C1+: the 💡 reveals the one reply the model was asked for. */
  revealHint(): void {
    this.set({ hintShown: true });
  }

  /** The coffee's extra hint (build plan M29): one more suggested reply, for this turn only, once per conversation. */
  revealExtraHint(): void {
    if (this.state.extraHint === "available") this.set({ extraHint: "shown", hintShown: true });
  }

  private async check(text: string): Promise<{ native: boolean; feedback: { better: string; note?: string } | null }> {
    const none = { native: false, feedback: null };
    const ctx = this.state.context;
    if (!ctx) return none;
    const ms = this.deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
    const helpers = await timeout(this.deps.helpers(), ms);
    if (!helpers) return none;
    const listener = `the ${getNpc(ctx.npcId).englishName.toLowerCase()}`;
    const [detected, grammar] = await Promise.all([
      timeout(helpers.detectLanguage(text), ms),
      timeout(helpers.grammarFeedback({ text, nativeLang: ctx.nativeLang, targetLang: ctx.lang, level: ctx.playerLevel, listener }), ms),
    ]);
    const native = baseLang(ctx.nativeLang) !== baseLang(ctx.lang) && detected?.ok === true && baseLang(detected.value.lang) === baseLang(ctx.nativeLang);
    // A native-language line is not graded: the NPC shows how to say it instead.
    if (native) return { native: true, feedback: null };
    if (grammar?.ok && !grammar.value.ok && grammar.value.better.trim() && grammar.value.better.trim() !== text) {
      return { native: false, feedback: { better: grammar.value.better.trim(), ...(grammar.value.note ? { note: grammar.value.note } : {}) } };
    }
    return none;
  }

  private async send(text: string, method: InputMethod, native: boolean): Promise<void> {
    const conversation = this.conversation;
    if (!conversation || this.state.phase !== "open") return;
    const generation = this.generation;
    const entry: LogEntry = { id: this.id(), kind: "player", text, method, ...(native ? { native: true } : {}) };
    if (method === "suggested") this.telemetry.suggested++;
    else this.telemetry.free++;
    this.set({
      phase: "thinking",
      log: [...this.state.log, entry],
      streaming: [],
      notice: native ? { kind: "native" } : null,
      hintShown: false,
      extraHint: this.state.extraHint === "shown" ? "used" : this.state.extraHint,
    });
    const result = await conversation.say(text, method, (lines) => {
      if (generation === this.generation) this.set({ streaming: lines });
    });
    if (generation !== this.generation) return;
    if (!result.ok) {
      const log = result.line ? [...this.state.log, { id: this.id(), kind: "npc" as const, line: result.line }] : this.state.log;
      const busy = !result.retry || !conversation.canTalk;
      this.set({
        log,
        streaming: [],
        phase: busy ? "ended" : "open",
        notice: result.line ? this.state.notice : { kind: busy ? "busy" : "retry" },
      });
      return;
    }
    this.applyTurn(result.reply, result.applied, entry.id, conversation.canTalk);
  }

  private applyTurn(reply: NpcTurnReply, applied: NpcAppliedMessage, playerEntryId: number, canTalk: boolean): void {
    const ctx = this.state.context!;
    this.telemetry.npcLines += reply.lines.length;
    if (reply.correction?.better) this.telemetry.corrections++;
    const log = this.state.log.map((e) => (e.id === playerEntryId && e.kind === "player" && reply.correction ? { ...e, correction: reply.correction } : e));
    reply.lines.forEach((line, i) => {
      // The phrase the NPC teaches goes with its last line.
      const teach = i === reply.lines.length - 1 ? reply.teach : undefined;
      log.push({ id: this.id(), kind: "npc", line, ...(teach ? { teach } : {}) });
    });
    const cards: Card[] = [...this.state.cards];
    for (const trade of applied.trades) cards.push({ id: this.id(), kind: "trade", trade, status: "open" });
    for (const action of applied.accepted) {
      const card = this.infoCard(action);
      if (card) cards.push(card);
    }
    // The coffee's extra hint (build plan M29) asked the model for one more; the panel holds it back until revealed.
    const suggestions: SuggestedReply[] = reply.suggestedReplies.slice(0, requestedSuggestions(ctx.effectiveLevel) + Math.min(1, ctx.extraHints));
    this.set({
      log,
      cards,
      suggestions,
      streaming: [],
      context: this.conversation?.context ?? ctx,
      phase: applied.ended || !canTalk ? "ended" : "open",
    });
  }

  private infoCard(action: ApprovedAction): Card | null {
    if (action.type === "give") return { id: this.id(), kind: "gift", itemId: action.itemId };
    if (action.type === "giveQuest") return { id: this.id(), kind: "quest", questId: action.questId };
    if (action.type === "teachRecipe") return { id: this.id(), kind: "recipe", recipeId: action.recipeId };
    return null;
  }

  /** Buy / No (or Sell / No) on a trade card; the server settles it. */
  async confirm(cardId: number, accept: boolean): Promise<void> {
    const conversation = this.conversation;
    const card = this.state.cards.find((c) => c.id === cardId);
    if (!conversation || !card || card.kind !== "trade" || card.status !== "open") return;
    const generation = this.generation;
    const update = (patch: Partial<Extract<Card, { kind: "trade" }>>) =>
      this.set({ cards: this.state.cards.map((c) => (c.id === cardId && c.kind === "trade" ? { ...c, ...patch } : c)) });
    update({ status: "sending" });
    try {
      const trade = await conversation.confirm(card.trade.tradeId, accept);
      if (generation !== this.generation) return;
      this.set({ coins: trade.coins, context: conversation.context });
      if (trade.ok) update({ status: "done" });
      else if (trade.reason === "declined") update({ status: "declined" });
      else update({ status: "failed", reason: trade.reason ?? "unavailable" });
    } catch (error) {
      if (generation !== this.generation) return;
      update({ status: "failed", reason: error instanceof NpcRefusedError ? error.reason : "unavailable" });
    }
  }

  /** The player opened the translation of an NPC line (hover or 🌐): counted once per line. */
  noteTranslation(text: string): void {
    if (!this.conversation || this.translations.has(text)) return;
    this.translations.add(text);
    this.telemetry.translationsShown++;
  }

  /** The profile card's Give (build plan M24): one item to the NPC; the server rules on it. */
  async gift(itemId: ItemId): Promise<void> {
    const conversation = this.conversation;
    if (!conversation || this.state.gifting) return;
    const generation = this.generation;
    this.set({ gifting: itemId });
    let card: Card;
    try {
      const gifted = await conversation.gift(itemId);
      if (generation !== this.generation) return;
      card = gifted.ok && gifted.reaction
        ? { id: this.id(), kind: "given", itemId, reaction: gifted.reaction, delta: gifted.delta }
        : { id: this.id(), kind: "giftFailed", itemId, reason: gifted.reason ?? "unavailable" };
    } catch {
      if (generation !== this.generation) return;
      card = { id: this.id(), kind: "giftFailed", itemId, reason: "unavailable" };
    }
    this.set({ gifting: null, cards: [...this.state.cards, card], context: conversation.context });
  }

  /** The profile card's Return (build plan M28): a lost item goes back to its owner for hearts. */
  async returnLost(itemId: LostItemId): Promise<void> {
    const conversation = this.conversation;
    if (!conversation || this.state.gifting) return;
    const generation = this.generation;
    this.set({ gifting: itemId });
    let card: Card;
    try {
      const returned = await conversation.returnLost(itemId);
      if (generation !== this.generation) return;
      card = returned.ok
        ? { id: this.id(), kind: "returned", itemId, delta: returned.delta }
        : { id: this.id(), kind: "returnFailed", itemId, reason: returned.reason ?? "unavailable" };
    } catch {
      if (generation !== this.generation) return;
      card = { id: this.id(), kind: "returnFailed", itemId, reason: "unavailable" };
    }
    this.set({ gifting: null, cards: [...this.state.cards, card], context: conversation.context });
  }

  /** Goodbye, Escape, walking away, or the panel's Close: the conversation is over. */
  end(): void {
    this.generation++;
    const conversation = this.conversation;
    const telemetry = { ...this.telemetry };
    conversation?.end();
    this.conversation = null;
    this.set({ ...IDLE_CONVERSATION });
    if (conversation) void this.remember(conversation, telemetry);
  }

  /** In the background after the end: the compaction and the level toast. */
  private async remember(conversation: NpcConversation, telemetry: ConversationTelemetry): Promise<void> {
    const result = await conversation.remember(telemetry).catch(() => null);
    if (!result || result.levelChange === 0) return;
    const toast = this.deps.toast ?? ((t: Omit<Toast, "id">) => void toastStore.push(t));
    toast({ kind: "level", npcId: result.npcId, direction: result.levelChange });
  }
}

/** The game's conversation, wired to the TownRoom, the lazy AI runtime and the profile. */
export const conversation = new ConversationController({
  room: () => {
    const room = townSession.getState().room;
    return room?.connection.isOpen ? room : null;
  },
  ai: loadNpcAi,
  helpers: () => loadInputHelpers().catch(() => null),
  player: () => {
    const profile = avatarStore.getState().profile;
    return profile ? { name: profile.name, animal: profile.animal, apartmentId: profile.apartmentId } : null;
  },
});
