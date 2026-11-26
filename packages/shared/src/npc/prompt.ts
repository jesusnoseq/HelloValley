import { quotePlayerText, sanitizePlayerText, languageName, estimateTokens } from "../ai/prompts";
import type { TemplateVariables } from "../ai/dotprompt";
import { getLanguage } from "../data/languages";
import { getNpc, NPC_IDS, type NpcId } from "../data/npcs";
import type { NpcContextMessage } from "../protocol/messages";
import { BAND_LEVEL, cefrDescriptor, friendshipBandHint, type FriendshipBand, type LevelBand, maxWordsPerLine, type OpenerTimeBand, requestedSuggestions } from "./levels";
import { cefrOf } from "../data/difficulty";
import { getLostItem } from "../forage/lost";

/**
 * The NPC turn prompt builder (build plan M21, docs/prompts/npc-runtime.md §1). The persona and
 * the system prompt live in the `npc-turn` server prompt template (`ai/templates/npc-turn.prompt`);
 * the client fills only its declared variables from the server's `npc:context` plus its own
 * profile. Everything that came from a player (their name, notebook words, what they typed) goes
 * in as quoted data, never as instructions (CLAUDE.md, GDD §9.3).
 *
 * Token caps (per turn): the player's text is cut to PLAYER_TEXT_MAX_LENGTH characters, the
 * history to the last NPC_TURN_HISTORY_TURNS exchanges, and the whole input (variables, history
 * and message) is trimmed to NPC_TURN_INPUT_TOKEN_BUDGET, oldest history first. The output cap is
 * `maxOutputTokens` in the template frontmatter, and the client stops a stream past
 * NPC_TURN_MAX_OUTPUT_CHARS.
 */

/** The template chat keeps the last 8 turns (architecture §5.3). One turn = player line + NPC answer. */
export const NPC_TURN_HISTORY_TURNS = 8;
/** Longest player message sent to the model (characters, after trimming; my number). */
export const PLAYER_TEXT_MAX_LENGTH = 300;
/** Each remembered NPC answer in the history is cut to this many characters. */
export const HISTORY_NPC_MAX_LENGTH = 400;
/** Budget for the variable part of a turn's input (the template's own text comes on top; my number). */
export const NPC_TURN_INPUT_TOKEN_BUDGET = 2500;
/** Matches `maxOutputTokens` in npc-turn.prompt. */
export const NPC_TURN_MAX_OUTPUT_TOKENS = 2048;
/** The client aborts a streamed answer longer than this (≈ 4 characters per token, plus slack for CJK escapes). */
export const NPC_TURN_MAX_OUTPUT_CHARS = NPC_TURN_MAX_OUTPUT_TOKENS * 6;
/** Most learning words passed to the NPC (build plan M25: up to 5). */
export const LEARNING_WORDS_MAX = 5;
/** Memory summaries are ≤ 120 words; the prompt gets at most this many characters of it. */
export const MEMORY_SUMMARY_MAX_LENGTH = 900;

/** `{{npc_role}}`: what the NPC is in the village. */
export const NPC_ROLES: Readonly<Record<NpcId, string>> = {
  shopkeeper: "shopkeeper of the general store",
  baker: "baker at the bakery",
  barista: "barista at the café",
  farmer: "farmer at the farm",
  mayor: "mayor at the Town Hall",
  librarian: "librarian at the library",
  doctor: "doctor at the clinic",
  gossip: "village gossip (house on the square)",
  elder: "village elder (cottage on the hill)",
};

/** Text from the server's records (model-written memory, news): one line, no quote tags, bounded. */
function note(text: string, max: number): string {
  return sanitizePlayerText(text).replace(/\s+/g, " ").slice(0, max).trim();
}

/** `{{script_note}}`: whether lines and tokens need a reading. */
export function scriptNote(targetLang: string): string {
  const l = getLanguage(targetLang);
  if (!l || l.romanization === null) return "The script is Latin: leave every `reading` empty.";
  const scheme =
    l.romanization === "romaji"
      ? "Hepburn romaji for the line, and the hiragana reading for each token with kanji"
      : l.romanization === "pinyin"
        ? l.code === "yue"
          ? "Jyutping"
          : "pinyin with tone marks"
        : l.romanization === "rr"
          ? "Revised Romanization"
          : "a simple Latin transliteration";
  return `Give \`reading\` for every line and token (${scheme}); \`romanized\` on tokens is the romanization.`;
}

const personaFlags = (npcId: NpcId): Record<string, boolean> => Object.fromEntries(NPC_IDS.map((id) => [`is_${id}`, id === npcId]));

const placeName = (place: string) => `the ${place.replace(/_/g, " ")}`;

export interface NpcPlayerInfo {
  name: string;
  animal: string;
  apartmentId: string;
}

/** The `npc-turn` template variables for one turn. */
export function buildNpcTurnVariables(ctx: NpcContextMessage, player: NpcPlayerInfo): TemplateVariables {
  const npc = getNpc(ctx.npcId);
  const words = ctx.learningWords
    .map((w) => sanitizePlayerText(w).replace(/\s+/g, " ").slice(0, 40))
    .filter(Boolean)
    .slice(0, LEARNING_WORDS_MAX);
  const gossipy = ctx.npcId === "gossip" || ctx.npcId === "elder";
  const inventory = ctx.inventory.filter((e) => e.qty > 0).map((e) => `${e.itemId}×${e.qty}`);
  const memory = ctx.memory ? note([ctx.memory.summary, ...ctx.memory.facts].filter(Boolean).join(" "), MEMORY_SUMMARY_MAX_LENGTH) : "";
  return {
    npc_name: npc.englishName,
    npc_role: NPC_ROLES[ctx.npcId],
    ...personaFlags(ctx.npcId),
    // The name passed moderation (M14) but is still player text: JSON-quoted, one line.
    player_name: JSON.stringify(sanitizePlayerText(player.name).replace(/\s+/g, " ").slice(0, 32)),
    player_animal: player.animal,
    apartment_id: player.apartmentId,
    native: languageName(ctx.nativeLang),
    target: languageName(ctx.lang),
    effective_level: cefrOf(ctx.effectiveLevel),
    cefr_descriptor: cefrDescriptor(ctx.effectiveLevel, ctx.simplified),
    max_words_per_line: maxWordsPerLine(ctx.effectiveLevel),
    // C1+ asks for one reply too: the panel hides it behind the 💡 button (GDD §6.2).
    // Build plan M29: the coffee buff asks for one more (the panel offers it once, as an extra hint).
    num_suggestions: requestedSuggestions(ctx.effectiveLevel) + Math.max(0, Math.min(1, Math.floor(ctx.extraHints))),
    script_note: scriptNote(ctx.lang),
    hearts: Math.round(ctx.hearts * 2) / 2,
    friendship_band_hint: friendshipBandHint(ctx.hearts),
    memory_summary: memory,
    // Notebook words are player-written: a JSON list of strings, data only.
    learning_words: words.length ? JSON.stringify(words) : "",
    time_of_day: ctx.world.timeOfDay,
    weather: ctx.world.weather,
    npc_location: placeName(ctx.world.location),
    stock_json: ctx.stock.length ? JSON.stringify(ctx.stock.map((s) => ({ itemId: s.itemId, price: s.price }))) : "",
    buys_json: ctx.buys.length ? JSON.stringify(ctx.buys.map((s) => ({ itemId: s.itemId, price: s.price }))) : "",
    recipes_json: ctx.recipes.length
      ? JSON.stringify(ctx.recipes.map((r) => ({ recipeId: r.recipeId, hearts: r.heartsRequired, ...(r.known ? { known: true } : {}) })))
      : "",
    player_inventory_brief: inventory.length ? inventory.join(", ") : "nothing",
    quests_json: ctx.quests.length ? JSON.stringify(ctx.quests) : "",
    village_news: gossipy && ctx.news.length ? JSON.stringify(ctx.news.map((n) => note(n, 200))) : "",
    context_flags: ctx.flags.length ? ctx.flags.map((f) => note(f, 120)).join("; ") : "",
    // Build plan M28: the Gossip's hint context, the lost items lying in town today and where.
    lost_item_hints: ctx.npcId === "gossip" && ctx.hints.length ? lostItemHintsJson(ctx.hints) : "",
  };
}

/** `{{lost_item_hints}}`: what is lost, whose it is, and the place it lies near (server data). */
export function lostItemHintsJson(hints: NpcContextMessage["hints"]): string {
  return JSON.stringify(
    hints.flatMap((h) => {
      const item = getLostItem(h.itemId);
      return item ? [{ item: item.englishName, owner: getNpc(h.owner).englishName, near: placeName(h.place) }] : [];
    }),
  );
}

export type InputMethod = "suggested" | "typed" | "spoken";
const INPUT_METHOD_TEXT: Record<InputMethod, string> = { suggested: "suggested reply", typed: "typed", spoken: "spoken" };

/** The player's text as it is sent: trimmed, one quote, at most PLAYER_TEXT_MAX_LENGTH characters. */
export const clampPlayerText = (text: string) => sanitizePlayerText(text).slice(0, PLAYER_TEXT_MAX_LENGTH).trim();

/**
 * The user message of a turn (npc-runtime.md §1.1). The conversation so far travels as the
 * template chat history (`{{history}}`), so it is not repeated here.
 */
export function npcTurnMessage(playerText: string, method: InputMethod): string {
  return `${quotePlayerText(clampPlayerText(playerText))}\nInput method: ${INPUT_METHOD_TEXT[method]}`;
}

/** A remembered exchange: what the player said ("" before an opener) and the NPC's lines (target-language text). */
export interface NpcHistoryTurn {
  player: string;
  npc: string;
}

export interface HistoryContent {
  role: "user" | "model";
  text: string;
}

/** The user turn before the NPC's opener (an empty `player` in the history). */
export const APPROACH_MESSAGE = "(The player walks up to you.)";

/** The last turns as template chat history (player text quoted, NPC lines cut). */
export function npcTurnHistory(turns: readonly NpcHistoryTurn[], maxTurns = NPC_TURN_HISTORY_TURNS): HistoryContent[] {
  return turns.slice(-maxTurns).flatMap((t): HistoryContent[] => [
    { role: "user", text: t.player.trim() ? quotePlayerText(clampPlayerText(t.player)) : APPROACH_MESSAGE },
    { role: "model", text: t.npc.replace(/\s+/g, " ").slice(0, HISTORY_NPC_MAX_LENGTH).trim() },
  ]);
}

export interface NpcTurnRequest {
  variables: TemplateVariables;
  history: HistoryContent[];
  message: string;
  /** Estimated input tokens of the variable part. */
  tokens: number;
}

const tokensOf = (vars: TemplateVariables, history: readonly HistoryContent[], message: string) =>
  estimateTokens(JSON.stringify(vars)) + history.reduce((n, h) => n + estimateTokens(h.text), 0) + estimateTokens(message);

/** Everything one turn sends, trimmed to the input budget (oldest history first, then the memory). */
export function buildNpcTurnRequest(
  ctx: NpcContextMessage,
  player: NpcPlayerInfo,
  turns: readonly NpcHistoryTurn[],
  playerText: string,
  method: InputMethod,
  budget = NPC_TURN_INPUT_TOKEN_BUDGET,
): NpcTurnRequest {
  const variables = buildNpcTurnVariables(ctx, player);
  const message = npcTurnMessage(playerText, method);
  let history = npcTurnHistory(turns);
  while (history.length > 0 && tokensOf(variables, history, message) > budget) history = history.slice(2);
  if (tokensOf(variables, history, message) > budget) variables.memory_summary = String(variables.memory_summary).slice(0, 200);
  return { variables, history, message, tokens: tokensOf(variables, history, message) };
}

// ---------------------------------------------------------------------------------------------
// Openers (npc-runtime.md §3)

export interface OpenerBands {
  npcId: NpcId;
  targetLang: string;
  nativeLang: string;
  level: LevelBand;
  time: OpenerTimeBand;
  friendship: FriendshipBand;
}

/** The `npc-opener` template variables for one band combination. */
export function buildOpenerVariables(b: OpenerBands): TemplateVariables {
  const level = BAND_LEVEL[b.level];
  return {
    npc_name: getNpc(b.npcId).englishName,
    ...personaFlags(b.npcId),
    native: languageName(b.nativeLang),
    target: languageName(b.targetLang),
    level: cefrOf(level),
    cefr_descriptor: cefrDescriptor(level),
    max_words_per_line: maxWordsPerLine(level),
    script_note: scriptNote(b.targetLang),
    time_band: b.time,
    friendship_band: b.friendship,
  };
}

/** The placeholder openers use for the player's name. */
export const NAME_PLACEHOLDER = "{NAME}";
