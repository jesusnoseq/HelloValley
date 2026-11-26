// Type-only imports: this module stays free of zod so the client's entry chunk can use it.
import type { FurnitureEdit, FurnitureEditRejection } from "../apartment/layout";
import type { Emote } from "../avatar/animation";
import type { ItemId } from "../data/items";
import type { NpcId } from "../data/npcs";
import type { Level } from "../data/difficulty";
import type { PlaceId, TimeOfDay, Weather } from "../data/world";
import type { ActionRejectReason, ApprovedAction, NpcActionInput, NpcActionType, TradeFailure, TradeProposal } from "../npc/actions";
import type { GiftReaction, GiftRefusal } from "../npc/friendship";
import type { MoveSlotRefusal, SlotEntry } from "../npc/inventory";
import type { ConversationTelemetryInput } from "../npc/memory";
import type { FishId, FishingSpot } from "../data/fish";
import type { Rarity } from "../data/rarity";
import type { FishCastRefusal, FishReelRefusal } from "../fishing/cast";
import type { FishLog, FishLogEntry } from "../fishing/log";
import type { FishShadow } from "../fishing/roll";
import type { AlbumEntry, ForageAlbum } from "../forage/album";
import type { LostItemHint, LostReturnRefusal } from "../forage/lost";
import type { CollectibleId, ForagePickRefusal, SpawnKind } from "../forage/spawns";
import type { LostItemId } from "../data/forage";
import type { Motion, SpaceId } from "../world/player";
import type { BuffKind } from "../data/items";
import type { RecipeId, RecipeIngredient } from "../data/recipes";
import type { EatRefusal } from "../food/eating";
import type { SitRefusal } from "../food/seats";
import type { CookRefusal, IngredientUse, RecipeBook } from "../food/cooking";
import type { QuestAcceptRefusal, NpcQuestBrief, QuestSettleRefusal } from "../quests/progress";
import type { QuestReward } from "../quests/templates";
import type { QuestView } from "../quests/view";
import type { AmbientBark } from "../npc/ambient";

/** Colyseus room names registered by the server (architecture §7.1). */
export const RoomName = {
  Town: "town",
  /** One private ApartmentRoom per owner (filtered by the `owner` join option, build plan M17). */
  Apartment: "apartment",
} as const;
export type RoomName = (typeof RoomName)[keyof typeof RoomName];

/** Messages the client sends to a room. Payload schemas are in `schemas.ts`. */
export const ClientMessage = {
  /**
   * Where the client's predicted walker is (build plan M16): the server validates the report
   * (speed cap, walkability, doors) and corrects the client when it rejects one.
   */
  PlayerMove: "player:move",
  /** Play an emote (keys 1–5). */
  Emote: "player:emote",
  /** Clock sync probe: the server answers with its wall time. */
  TimeSync: "time:sync",
  /** A proximity chat line typed by the player (build plan M18). */
  Chat: "chat:send",
  /** Mute or unmute a player's chat for this session (server-enforced). */
  ChatMute: "chat:mute",
  /** Block a player: no chat either way and no visit requests, kept across sessions. */
  ChatBlock: "chat:block",
  /** Lift a block, by uid (the blocked player may be offline). */
  ChatUnblock: "chat:unblock",
  /** Report a player (and optionally one of their lines) to moderators. Also mutes them. */
  ChatReport: "chat:report",
  /** Talk to an NPC or use a world object (F / click). */
  Interact: "interact:request",
  /** TownRoom, at the lobby intercom: list the players online (build plan M17). */
  IntercomList: "intercom:list",
  /** TownRoom, at the lobby intercom: ring a player's apartment to ask for a visit. */
  VisitRequest: "visit:request",
  /** TownRoom, from the owner: accept or decline a visit request. */
  VisitAnswer: "visit:answer",
  /** ApartmentRoom, owner only: one placement-mode edit (move, rotate, store, place). */
  FurnitureEdit: "furniture:edit",
  /** Start talking to an NPC (architecture §5.3): the server answers with `npc:context`. */
  NpcStart: "npc:start",
  /** The NPC turn the client got from the model: an untrusted proposal of actions (architecture §6.1). */
  NpcReply: "npc:reply",
  /** The player's answer to a trade the server accepted (the M23 confirmation card). */
  NpcConfirm: "npc:confirm",
  /**
   * The conversation is over (walk-away or goodbye). Sent at once; the compaction follows as
   * `npc:memory` (build plan M24), so the chatting indicator and the next conversation never
   * wait for the model.
   */
  NpcEnd: "npc:end",
  /** After `npc:end`: the client's compaction of the conversation (summary, facts, level signals, telemetry). */
  NpcMemory: "npc:memory",
  /** During a conversation: give the NPC one item from the inventory (build plan M24). */
  NpcGift: "npc:gift",
  /** Drag a stack from one inventory slot to another (bag or hotbar, build plan M26). The server answers with `inventory:state`. */
  InventoryMove: "inventory:move",
  /**
   * Cast the line (build plan M27) with the rod in a hotbar slot, at a charge (0–1, the hold-to-cast
   * distance) and heading. The server checks the rod, the spot and the water and rolls the fish.
   */
  FishCast: "fish:cast",
  /** How the cast ended: the mini-game landed the fish, or it got away (or the player gave up). */
  FishReel: "fish:reel",
  /** Pick up a forage spawn (or a lost item) the player stands next to (build plan M28). */
  ForagePick: "forage:pick",
  /** During a conversation: hand a lost item back to its owner (build plan M28). */
  NpcReturn: "npc:return",
  /** Eat or drink the food in a hotbar slot (build plan M29). The server answers with `food:eaten`. */
  FoodEat: "food:eat",
  /** Sit on a bench or café chair the player stands next to (build plan M29). */
  SeatSit: "seat:sit",
  /** Stand up again (walking off does it too). */
  SeatStand: "seat:stand",
  /** At the apartment kitchen: cook a learned recipe (build plan M29). The server answers with `cook:result`. */
  CookMake: "cook:make",
  /** At the Town Hall notice board: take one of today's requests (build plan M30). The server answers with `quest:result`. */
  QuestAccept: "quest:accept",
  /** During a conversation: hand a delivery or a fetch over to this NPC (the "Hand over" card). */
  QuestTurnIn: "quest:handover",
  /** Whether the Gossip and the Elder may name the player in village news (build plan M31, GDD §8.2 opt-out). */
  VillagePrivacy: "village:privacy",
  /** The client's AI usage since its last report (build plan M36): untrusted numbers for the server metrics. */
  AiUsage: "ai:usage",
} as const;
export type ClientMessage = (typeof ClientMessage)[keyof typeof ClientMessage];

/** Messages the server sends to clients. */
export const ServerMessage = {
  /** Sent once after a join: the verified uid, the shard and where the server placed the player. */
  Welcome: "session:welcome",
  /** A position report was rejected: the client snaps back to this point. */
  MoveCorrection: "move:correct",
  /** Another player in the same space played an emote. */
  Emote: "player:emote",
  /** Answer to `ClientMessage.TimeSync`. */
  TimeSync: "time:sync",
  /** Answer to `ClientMessage.IntercomList`. */
  IntercomList: "intercom:list",
  /** To an owner: someone at the intercom asks to visit. */
  VisitIncoming: "visit:incoming",
  /** To an owner: a request they were shown is no longer open (expired, withdrawn, visitor left). */
  VisitClosed: "visit:closed",
  /** To a visitor: what happened to their request. */
  VisitStatus: "visit:status",
  /** ApartmentRoom: the answer to one `furniture:edit`. */
  FurnitureResult: "furniture:result",
  /** A chat line that passed the server checks, to everyone in range (and back to its sender). */
  ChatMessage: "chat:message",
  /** To a sender: their line was not delivered. */
  ChatRejected: "chat:rejected",
  /** The player's own mute and block lists (on join and after every change). */
  ChatSafety: "chat:safety",
  /** The answer to a `chat:report`. */
  ChatReported: "chat:reported",
  /** Answer to `npc:start`: what the NPC knows for this conversation, and the first turn id. */
  NpcContext: "npc:context",
  /** Answer to `npc:reply`: which proposed actions the server accepted (with its own prices). */
  NpcApplied: "npc:applied",
  /** Answer to `npc:confirm`: the trade happened (or why not), with the new coins and items. */
  NpcTrade: "npc:trade",
  /** An NPC message was refused (rate or turn limits, unknown turn, store down). */
  NpcRefused: "npc:refused",
  /** Answer to `npc:memory`: the memory was stored; the new hearts and level (with a ½-step change, if any). */
  NpcRemembered: "npc:remembered",
  /** Answer to `npc:gift`: how the NPC took it, or why not. */
  NpcGifted: "npc:gifted",
  /**
   * The player's coins and inventory slots, from the server's records (build plan M26): after the
   * join, after every trade, gift or move, and as the answer to `inventory:move`.
   */
  InventoryState: "inventory:state",
  /** Answer to `fish:cast`: where the bobber landed, when the fish bites and how hard it pulls, or why not. */
  FishCast: "fish:cast",
  /** Answer to `fish:reel`: the fish (when caught), whether it went into the bag, and the encyclopedia entry. */
  FishResult: "fish:result",
  /** The player's fish encyclopedia (after the join and after every catch). */
  FishLog: "fish:log",
  /** Answer to `forage:pick`: what went into the bag, or why not (build plan M28). */
  ForageResult: "forage:result",
  /** The player's forage album (after the join, every pick-up and every return). */
  ForageAlbum: "forage:album",
  /** Answer to `npc:return`: the owner took the lost item back (and the hearts it earned), or why not. */
  NpcReturned: "npc:returned",
  /** Answer to `food:eat`: what was eaten and the buff it gave, or why not (build plan M29). */
  FoodEaten: "food:eaten",
  /** The player's running buffs (after the join, every bite, and when one runs out). */
  Buffs: "buffs:state",
  /** Where the player sits now (answer to `seat:sit` / `seat:stand`, and after walking off). */
  SeatState: "seat:state",
  /** Answer to `cook:make`: the dish that went into the bag, or why not. */
  CookResult: "cook:result",
  /** The player's recipe book (after the join, after an NPC teaches a recipe, after cooking). */
  RecipeBook: "recipes:book",
  /** Today's board and the player's quest log (after the join, every change, and at a new in-game day; build plan M30). */
  QuestState: "quests:state",
  /** A request was taken or completed (or why not): board, `giveQuest`, hand-over, `completeQuest` or automatic. */
  QuestResult: "quest:result",
  /**
   * An ambient bark (build plan M31): a villager's line, or a two-line exchange between two related
   * villagers, to the players near them. The client shows it in its own target language (seeded
   * `cache/lines`, else its own generation).
   */
  NpcBark: "npc:bark",
  /** A villager played an idle emote (build plan M31), to the players in its space. */
  NpcEmote: "npc:emote",
  /** The player's village news setting (after the join and as the answer to `village:privacy`). */
  VillagePrivacy: "village:privacy",
} as const;
export type ServerMessage = (typeof ServerMessage)[keyof typeof ServerMessage];

/** Close code when a newer session of the same uid (another tab) replaced this one. Do not rejoin. */
export const SESSION_REPLACED_CODE = 4801;

/** ApartmentRoom close code for a visitor whose visit ended (they left through the door). */
export const VISIT_ENDED_CODE = 4802;

/** Close code for a client that flooded the room with messages (build plan M36). It may rejoin. */
export const FLOOD_KICKED_CODE = 4803;

/** A point in one space, as sent on the wire. */
export interface WireSpacePoint {
  space: SpaceId;
  x: number;
  z: number;
  heading: number;
}

/** Payload of `ServerMessage.Welcome`. */
export interface WelcomeMessage {
  uid: string;
  /** Shard number ("Valley #1"). */
  shard: number;
  /** Where the server placed the player; the client starts its walker there. */
  spawn: WireSpacePoint;
}

/** Payload of `ClientMessage.PlayerMove`. */
export interface PlayerMoveMessage extends WireSpacePoint {
  /** Increases with every report. Reports with a seq at or below the last one are ignored. */
  seq: number;
  /** The last correction epoch the client applied. Reports from an older epoch are ignored. */
  epoch: number;
  motion: Motion;
}

/**
 * Why the server moved the walker: a rejected report (`speed`, `blocked`, `space`) or a server
 * teleport (`visit`: an accepted visit puts the visitor inside the host's apartment).
 */
export type MoveRejectReason = "speed" | "blocked" | "space" | "visit";

/** Payload of `ServerMessage.MoveCorrection`. */
export interface MoveCorrectionMessage extends WireSpacePoint {
  epoch: number;
  reason: MoveRejectReason;
}

/** Payload of `ClientMessage.Emote`. */
export interface EmoteRequest {
  emote: Emote;
}

/** Payload of `ServerMessage.Emote`. */
export interface EmoteBroadcast {
  sessionId: string;
  emote: Emote;
}

/** Payload of `ClientMessage.TimeSync`: the client's clock when it sent the probe. */
export interface TimeSyncRequest {
  t: number;
}

/** Payload of `ServerMessage.TimeSync`: the probe's `t` plus the server's wall clock. */
export interface TimeSyncReply {
  t: number;
  server: number;
}

/**
 * Fields of one player in the synced TownRoom state (the server's `TownPlayer` schema matches
 * this). The appearance is the profile's `{animal, colors}` as JSON (AvatarAppearanceSchema).
 */
export interface TownPlayerView {
  name: string;
  appearance: string;
  space: SpaceId;
  x: number;
  z: number;
  heading: number;
  motion: Motion;
  /**
   * The NPC the player is talking to, or "" (build plan M23): bystanders see a "chatting"
   * indicator over the pair. Set by the server on `npc:start`, cleared on `npc:end`, on walking
   * away and on leaving.
   */
  talkingTo: string;
  /**
   * What the player is doing in place (build plan M27): "" or "fishing" (cast, wait, bite) or
   * "reeling", or (build plan M29) "eating" for a moment after a bite. Remote avatars play the
   * fish_cast / fish_reel / eat clips from it.
   */
  activity: string;
  /** The seat the player sits on (food/seats.ts id), or "" (build plan M29): drawn seated there. */
  seat: string;
}

/**
 * One forage spawn or lost item lying in the town today (the server's `TownForageSpawn` schema,
 * keyed by spawn id in the synced `forage` map; build plan M28). Picked ones leave the map.
 */
export interface TownForageView {
  itemId: CollectibleId;
  kind: SpawnKind;
  x: number;
  z: number;
}

/**
 * One villager in the synced TownRoom state (build plan M31, the server's `TownNpc` schema), keyed
 * by NPC id: where it is, whether it walks, and its activity clip ("" / "fishing" / "eating").
 */
export interface TownNpcView {
  space: SpaceId;
  x: number;
  z: number;
  heading: number;
  motion: Motion;
  activity: string;
}

/** Payload of `ServerMessage.NpcBark`. */
export type NpcBarkMessage = AmbientBark & { id: string };

/** Payload of `ServerMessage.NpcEmote`. */
export interface NpcEmoteMessage {
  npcId: NpcId;
  emote: Emote;
}

/** Payload of `ClientMessage.VillagePrivacy` and `ServerMessage.VillagePrivacy`. */
export interface VillagePrivacyMessage {
  /** True: village news may use the player's display name; false: "someone". */
  named: boolean;
}

/** The synced world clock and weather (the server's `TownWorld` schema). */
export interface TownWorldView {
  /** Server wall time (ms) at the last clock tick (once a second). */
  serverTime: number;
  /** In-game day index (world/clock.ts). */
  day: number;
  weather: Weather;
  previousWeather: Weather;
  /** Server wall time (ms) when the current weather slot began. */
  weatherSince: number;
}

/** One player the lobby intercom lists (build plan M17). */
export interface IntercomEntry {
  /** TownRoom session id: what `visit:request` names. */
  sessionId: string;
  name: string;
  apartmentId: string;
  /** In their apartment right now. */
  home: boolean;
}

/** Payload of `ServerMessage.IntercomList`. */
export interface IntercomListMessage {
  players: IntercomEntry[];
}

/** Payload of `ClientMessage.VisitRequest`. */
export interface VisitRequestMessage {
  sessionId: string;
}

/** Payload of `ServerMessage.VisitIncoming`. */
export interface VisitIncomingMessage {
  requestId: string;
  fromName: string;
  fromApartment: string;
}

/** Payload of `ServerMessage.VisitClosed`. */
export interface VisitClosedMessage {
  requestId: string;
}

/** Payload of `ClientMessage.VisitAnswer`. */
export interface VisitAnswerMessage {
  requestId: string;
  accept: boolean;
}

/**
 * Where a visit request stands: `pending` (ringing), `accepted`, `declined`, `expired` (no
 * answer in time), `unavailable` (the owner left, or the visitor is no longer at the intercom).
 */
export type VisitState = "pending" | "accepted" | "declined" | "expired" | "unavailable";

/** Payload of `ServerMessage.VisitStatus`. */
export interface VisitStatusMessage {
  requestId: string;
  state: VisitState;
  ownerName: string;
  apartmentId: string;
  /** With `accepted`: the owner's uid, to join their ApartmentRoom (`owner` join option). */
  host?: string;
}

/** Payload of `ClientMessage.FurnitureEdit`. */
export type FurnitureEditMessage = FurnitureEdit & {
  /** Client counter echoed in the result. */
  editId: number;
};

/** Payload of `ServerMessage.FurnitureResult`. */
export interface FurnitureResultMessage {
  editId: number;
  ok: boolean;
  reason?: FurnitureEditRejection | "not_owner";
  /** With `invalid`: what the placement rules objected to. */
  problems?: string[];
}

/** One person in an apartment (the ApartmentRoom's synced `occupants`, keyed by its session id). */
export interface ApartmentOccupantView {
  name: string;
  /** Their TownRoom session id: their avatar's position is in the TownRoom state. */
  townSession: string;
  owner: boolean;
}

/**
 * The synced ApartmentRoom state (the server's `ApartmentState`). The layout is JSON of the
 * shared `ApartmentLayoutData`; `revision` counts accepted edits.
 */
export interface ApartmentStateView {
  owner: string;
  ownerName: string;
  apartmentId: string;
  layout: string;
  revision: number;
}

/** Longest chat line a player can send, in characters (after trimming). */
export const CHAT_MAX_LENGTH = 200;

/** Payload of `ClientMessage.Chat`. */
export interface ChatSendMessage {
  text: string;
  /**
   * The language the line is written in, as the sender's client says (an untrusted claim; it only
   * decides how readers translate it). Missing: the sender's target language.
   * The sender picks it with the chat input's language toggle (M18). Build plan M20 adds on-device
   * detection (`detectLanguage`), used for the NPC native-language redirect (M23 conversation panel), not here.
   */
  lang?: string;
}

/** Payload of `ServerMessage.ChatMessage` (build plan M18, GDD §6.6). */
export interface ChatBroadcast {
  /** Server-issued id: translations are cached per message id, reports name it. */
  id: string;
  /** The sender's TownRoom session id. */
  from: string;
  name: string;
  /** The text as written (it passed the server's moderation check). */
  text: string;
  /** The language it is written in. */
  lang: string;
  /** Server wall time (ms). */
  ts: number;
}

/**
 * Why a line was not delivered: `moderation` (the server check refused it), `rate` (too many lines
 * too fast), `muted` (the sender is muted shard-wide after repeated offences, build plan M36).
 */
export type ChatRejectReason = "moderation" | "rate" | "muted";

/** Payload of `ServerMessage.ChatRejected`. */
export interface ChatRejectedMessage {
  reason: ChatRejectReason;
  /** With `muted`: when the shard-wide mute ends (server wall time, ms). */
  until?: number;
}

/** Payload of `ClientMessage.ChatMute`. */
export interface ChatMuteMessage {
  sessionId: string;
  muted: boolean;
}

/** Payload of `ClientMessage.ChatBlock`. */
export interface ChatBlockMessage {
  sessionId: string;
}

/** Payload of `ClientMessage.ChatUnblock`. */
export interface ChatUnblockMessage {
  uid: string;
}

export const CHAT_REPORT_REASONS = ["spam", "harassment", "inappropriate", "other"] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

/** Payload of `ClientMessage.ChatReport`. */
export interface ChatReportMessage {
  /** The reported player's session id (as the line's `from` names it). */
  sessionId: string;
  /** The reported line, when the report is about one. */
  messageId?: string;
  reason: ChatReportReason;
}

/** Payload of `ServerMessage.ChatReported`. */
export interface ChatReportedMessage {
  ok: boolean;
}

/** A player on someone's block list. */
export interface BlockedPlayer {
  uid: string;
  name: string;
}

/** Payload of `ServerMessage.ChatSafety`. */
export interface ChatSafetyMessage {
  /** Session ids in this shard whose chat the player muted. */
  muted: string[];
  /** Everyone the player blocked (online or not). */
  blocked: BlockedPlayer[];
}

// ---------------------------------------------------------------------------------------------
// NPC conversations (build plan M21, architecture §5.3, §6.1)

/** Payload of `ClientMessage.NpcStart`. */
export interface NpcStartMessage {
  npcId: NpcId;
}

/** An item with the server's price (coins). */
export interface NpcPriceEntry {
  itemId: ItemId;
  price: number;
}

export interface InventoryEntry {
  itemId: ItemId;
  qty: number;
}

/**
 * Payload of `ServerMessage.NpcContext`: the context the client fills the `npc-turn` template
 * with (shared `buildNpcTurnVariables`). Everything here comes from the server's own records.
 */
export interface NpcContextMessage {
  conversationId: string;
  /** The id the next `npc:reply` must carry (one per turn, issued by the server). */
  turnId: string;
  npcId: NpcId;
  /** Target language of the conversation. */
  lang: string;
  nativeLang: string;
  playerLevel: Level;
  /** clamp(playerLevel + NPC tier offset) (GDD §6.4). */
  effectiveLevel: Level;
  /** The offset went below A1 and was absorbed: simplify further. */
  simplified: boolean;
  /** Hearts with this NPC, after this contact's decay and daily greeting (build plan M24). */
  hearts: number;
  /** What this contact did to the hearts: the daily greeting (≥ 0) and decay after 7 days away (≤ 0). */
  contact: { greeting: number; decay: number };
  /** The NPC already accepted a gift from the player this in-game day. */
  giftedToday: boolean;
  /** When the player last talked to this NPC before now (ms), or null for a first meeting. */
  lastSeen: number | null;
  coins: number;
  memory: { summary: string; facts: string[] } | null;
  /** Up to 5 words the player is learning (notebook). */
  learningWords: string[];
  /** What the NPC sells, at the server's current price (including this conversation's haggle). */
  stock: NpcPriceEntry[];
  /** The player's items this NPC would buy, at the server's price. */
  buys: NpcPriceEntry[];
  inventory: InventoryEntry[];
  /** The NPC's recipes, with the hearts each needs. */
  recipes: { recipeId: string; heartsRequired: number; known: boolean }[];
  /** Today's requests involving this NPC (build plan M30): offered (giveQuest), active, done; and which can be completed now. */
  quests: NpcQuestBrief[];
  /**
   * Extra context: the lost items the player carries (build plan M28, forage/lost.ts
   * `lostItemFlags`) and what the player ate today (build plan M29, food/eating.ts `eatingFlags`).
   */
  flags: string[];
  /**
   * Extra suggested-reply hints for this conversation (build plan M29: the coffee buff, GDD §5.4):
   * the model is asked for this many more suggestions, and the panel offers one more, once.
   */
  extraHints: number;
  /** The Gossip only (build plan M28): the lost items still lying in the shard today and where. */
  hints: LostItemHint[];
  /**
   * Village news (build plan M31; Gossip and Elder only): English seeds from the server's batch of
   * public events (village/events.ts), rumours for the Gossip and legends for the Elder.
   */
  news: string[];
  world: { timeOfDay: TimeOfDay; weather: Weather; location: PlaceId; minutes: number };
  /** Turns left in this conversation (server limit). */
  turnsLeft: number;
}

/** Payload of `ClientMessage.NpcReply`: the model's proposed actions for one turn. */
export interface NpcReplyMessage {
  conversationId: string;
  turnId: string;
  actions: NpcActionInput[];
}

/** A trade the server accepted, waiting for the player's confirmation. */
export interface PendingTrade extends TradeProposal {
  tradeId: string;
}

/** Payload of `ServerMessage.NpcApplied`. */
export interface NpcAppliedMessage {
  conversationId: string;
  turnId: string;
  accepted: ApprovedAction[];
  rejected: { type: NpcActionType; reason: ActionRejectReason }[];
  trades: PendingTrade[];
  /** The id for the next turn, or null when the conversation ended or hit its limit. */
  nextTurnId: string | null;
  ended: boolean;
  hearts: number;
  /** Prices after this turn (a haggle changes them). */
  stock: NpcPriceEntry[];
  /** Items handed over at once (gifts). */
  inventory: InventoryEntry[];
}

/** Payload of `ClientMessage.NpcConfirm`. */
export interface NpcConfirmMessage {
  conversationId: string;
  tradeId: string;
  accept: boolean;
}

export type NpcTradeFailure = TradeFailure | "unknown_trade" | "declined" | "unavailable";

/** Payload of `ServerMessage.NpcTrade`. */
export interface NpcTradeMessage {
  tradeId: string;
  ok: boolean;
  reason?: NpcTradeFailure;
  coins: number;
  inventory: InventoryEntry[];
}

/** Payload of `ClientMessage.NpcEnd`. */
export interface NpcEndMessage {
  conversationId: string;
}

/**
 * Payload of `ClientMessage.NpcMemory` (build plan M24, architecture §5.3, §6.1): the compaction
 * (npc-runtime.md §7) of a conversation that just ended, plus the panel's telemetry. Model output
 * relayed by the client: the server sanitises and caps it, and counts the turns itself.
 */
export interface NpcMemoryMessage {
  conversationId: string;
  summary: string;
  facts: string[];
  signals: { comprehension: number; expression: number; usedNativeLanguage: boolean; struggles: string[] };
  telemetry: ConversationTelemetryInput;
}

/** Payload of `ServerMessage.NpcRemembered`. */
export interface NpcRememberedMessage {
  conversationId: string;
  npcId: NpcId;
  /** The player's level after this conversation. */
  level: Level;
  /** +1 / −1 when the level moved ½ step (the client shows a toast), else 0. */
  levelChange: -1 | 0 | 1;
}

/** Payload of `ClientMessage.NpcGift`. */
export interface NpcGiftMessage {
  conversationId: string;
  itemId: ItemId;
}

export type NpcGiftFailure = GiftRefusal | "not_owned";

/** Payload of `ServerMessage.NpcGifted`. */
export interface NpcGiftedMessage {
  conversationId: string;
  itemId: ItemId;
  ok: boolean;
  reason?: NpcGiftFailure;
  reaction?: GiftReaction;
  /** Hearts change from this gift (0 when refused). */
  delta: number;
  hearts: number;
  inventory: InventoryEntry[];
}

/**
 * Why an NPC message was refused: `rate` (too fast), `daily_limit` / `turn_limit` (turn caps,
 * architecture §9), `unknown_turn` (no such turn id, or already used), `no_conversation`,
 * `unavailable` (the server could not read or write the player's records), `too_far` (the
 * player is not standing next to the NPC, build plan M23).
 */
/** `budget`: the player's NPC turns for the last 10 minutes are used up (build plan M36, GDD §9.2: 30 per 10 min). */
export type NpcRefusal = "rate" | "daily_limit" | "budget" | "turn_limit" | "unknown_turn" | "no_conversation" | "unavailable" | "too_far";

/** Payload of `ServerMessage.NpcRefused`. */
export interface NpcRefusedMessage {
  reason: NpcRefusal;
  npcId?: NpcId;
  conversationId?: string;
  turnId?: string;
}

// ---------------------------------------------------------------------------------------------
// Inventory (build plan M26, GDD §5.6)

/** Payload of `ClientMessage.InventoryMove`: slot indexes 0–29 (24 bag slots, then the 6 hotbar slots). */
export interface InventoryMoveMessage {
  from: number;
  to: number;
  /** Client counter echoed in the answer. */
  moveId: number;
}

/** Why a move was refused: `bad_slot` / `empty_slot` (npc/inventory.ts `moveSlot`), `rate`, `unavailable` (the store failed). */
export type InventoryMoveRefusal = MoveSlotRefusal | "rate" | "unavailable";

/** Payload of `ServerMessage.InventoryState`. */
export interface InventoryStateMessage {
  /** The target language whose coins these are (coins live in `users/{uid}/langs/{lang}`). */
  lang: string;
  coins: number;
  /** The filled slots, by slot index. */
  slots: SlotEntry[];
  /** With an answer to `inventory:move`: its `moveId`. */
  moveId?: number;
  /** With `moveId`: why the move did not happen (the slots are then unchanged). */
  refused?: InventoryMoveRefusal;
}

// ---------------------------------------------------------------------------------------------
// Fishing (build plan M27, GDD §5.2)

/** Payload of `ClientMessage.FishCast`. */
export interface FishCastMessage {
  /** The hotbar slot holding the rod (24–29). */
  slot: number;
  /** Hold-to-cast charge, 0–1 (shared `castCharge`). */
  charge: number;
  heading: number;
}

/** Payload of `ClientMessage.FishReel`. */
export interface FishReelMessage {
  castId: string;
  outcome: "caught" | "escaped";
}

/** Payload of `ServerMessage.FishCast`. */
export type FishCastResultMessage =
  | {
      ok: true;
      castId: string;
      spot: FishingSpot;
      /** Where the bobber landed (town frame). */
      bobber: { x: number; z: number };
      /** The landed cast distance in metres. */
      distance: number;
      /** From now until the bite. */
      biteInMs: number;
      /** How hard the fish pulls: the mini-game's parameters follow from it (shared REEL_PARAMS). */
      rarity: Rarity;
      shadow: FishShadow;
      /** Seeds the reel zone (shared `zoneCentre`). */
      reelSeed: number;
    }
  | { ok: false; reason: FishCastRefusal };

/** Payload of `ServerMessage.FishResult`. */
export type FishResultMessage =
  | { castId: string; outcome: "escaped" }
  | {
      castId: string;
      outcome: "caught";
      fishId: FishId;
      rarity: Rarity;
      /** A species the encyclopedia did not have yet. */
      first: boolean;
      /** It went into the bag (false: the bag was full and the fish was released). */
      kept: boolean;
      entry: FishLogEntry;
      /** The Elder is on the dock nearby and comments on the catch (a cached bark, client side). */
      elderNearby: boolean;
    }
  | { castId: string; outcome: "refused"; reason: FishReelRefusal | "unavailable" };

/** Payload of `ServerMessage.FishLog`. */
export interface FishLogMessage {
  species: FishLog;
}

// ---------------------------------------------------------------------------------------------
// Foraging and lost items (build plan M28, GDD §5.3)

/** Payload of `ClientMessage.ForagePick`. */
export interface ForagePickMessage {
  spawnId: string;
}

/** Payload of `ServerMessage.ForageResult`. */
export type ForageResultMessage =
  | {
      spawnId: string;
      ok: true;
      itemId: CollectibleId;
      kind: SpawnKind;
      /** New to the album. */
      first: boolean;
      entry: AlbumEntry;
    }
  | { spawnId: string; ok: false; reason: ForagePickRefusal };

/** Payload of `ServerMessage.ForageAlbum`. */
export interface ForageAlbumMessage {
  album: ForageAlbum;
}

/** Payload of `ClientMessage.NpcReturn`. */
export interface NpcReturnMessage {
  conversationId: string;
  itemId: LostItemId;
}

export type NpcReturnFailure = LostReturnRefusal | "not_owned" | "unavailable";

/** Payload of `ServerMessage.NpcReturned`. */
export interface NpcReturnedMessage {
  conversationId: string;
  itemId: LostItemId;
  ok: boolean;
  reason?: NpcReturnFailure;
  /** Hearts gained (0 when refused, or when this item already went back today). */
  delta: number;
  hearts: number;
  inventory: InventoryEntry[];
}

// ---------------------------------------------------------------------------------------------
// Eating, sitting and cooking (build plan M29, GDD §5.4)

/** How long the synced "eating" activity lasts after a bite (the eat clip, M07). */
export const EATING_ACTIVITY_MS = 1800;

/** Payload of `ClientMessage.FoodEat`. */
export interface FoodEatMessage {
  /** The hotbar slot (24–29) holding the food or drink. */
  slot: number;
}

/** A running buff as sent to its owner (times relative to the server's clock at send time). */
export interface WireBuff {
  kind: BuffKind;
  amount: number;
  itemId: ItemId;
  /** Left of the buff when the message was sent (ms). */
  remainingMs: number;
  /** Its full length (ms), for the HUD's ring. */
  durationMs: number;
}

/** Payload of `ServerMessage.FoodEaten`. */
export type FoodEatenMessage =
  | {
      slot: number;
      ok: true;
      itemId: ItemId;
      /** The buff this bite started or refreshed, if any. */
      buff: WireBuff | null;
      /** The emote it plays (the cake's happy cheer), if any. */
      emote: Emote | null;
    }
  | { slot: number; ok: false; reason: EatRefusal };

/** Payload of `ServerMessage.Buffs`. */
export interface BuffsMessage {
  buffs: WireBuff[];
}

/** Payload of `ClientMessage.SeatSit`. */
export interface SeatSitMessage {
  seatId: string;
}

/** Payload of `ServerMessage.SeatState`. */
export interface SeatStateMessage {
  /** The seat the player sits on now, or null. */
  seatId: string | null;
  /** Why the last `seat:sit` was refused. */
  refused?: SitRefusal;
}

/** Payload of `ClientMessage.CookMake`. */
export interface CookMakeMessage {
  recipeId: RecipeId;
}

/** Payload of `ServerMessage.CookResult`. */
export type CookResultMessage =
  | { recipeId: RecipeId; ok: true; itemId: ItemId; uses: IngredientUse[] }
  | { recipeId: RecipeId; ok: false; reason: CookRefusal; missing?: RecipeIngredient[] };

/** Payload of `ServerMessage.RecipeBook`. */
export interface RecipeBookMessage {
  book: RecipeBook;
}

export const CLIENT_MESSAGE_TYPES: readonly ClientMessage[] = Object.values(ClientMessage);

export function isClientMessage(type: unknown): type is ClientMessage {
  return typeof type === "string" && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(type);
}

/** Payload of `ClientMessage.QuestAccept` (build plan M30). */
export interface QuestAcceptMessage {
  questId: string;
}

/** Payload of `ClientMessage.QuestTurnIn`. */
export interface QuestTurnInMessage {
  conversationId: string;
  questId: string;
}

/** Payload of `ServerMessage.QuestState`: the board (today's three requests) and the log (what the player took on). */
export interface QuestStateMessage {
  day: number;
  /** The player's level in this language (the notices are written at its band), null when unknown. */
  level: Level | null;
  board: QuestView[];
  log: QuestView[];
}

/** How a quest change came about. */
export type QuestVia = "board" | "npc" | "hand_over" | "auto";

export type QuestRefusal = QuestAcceptRefusal | QuestSettleRefusal | "too_far" | "no_conversation" | "rate" | "unavailable";

/** Payload of `ServerMessage.QuestResult`. */
export type QuestResultMessage =
  | { questId: string; action: "accept"; ok: true; via: QuestVia }
  | { questId: string; action: "complete"; ok: true; via: QuestVia; reward: QuestReward; coins: number; hearts: number }
  | { questId: string; action: "accept" | "complete"; ok: false; reason: QuestRefusal };
