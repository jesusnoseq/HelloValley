import {
  buildNpcTurnRequest,
  type CannedKind,
  cannedLine,
  type HistoryContent,
  type InputMethod,
  type NpcContextMessage,
  type NpcHistoryTurn,
  type NpcLine,
  type NpcPlayerInfo,
  NPC_TURN_MAX_OUTPUT_CHARS,
  type NpcTurnReply,
  parseNpcTurnReply,
  PROMPT_TEMPLATE_IDS,
  streamedLineTexts,
  type TemplateVariables,
  estimateTokens,
} from "@hellovalley/shared";
import type { AiBudget } from "./budget";

/**
 * NPC dialogue turns (build plan M21, architecture §5.3). Each turn is one message to the
 * `npc-turn` server prompt template through Firebase AI Logic (cloud only: templates do not run
 * on-device). The client fills the template's variables from the server's `npc:context`, sends
 * the last 8 turns as the chat history and the player's text as quoted `<player_text>` data, and
 * streams the answer so the bubble shows text before the whole turn has arrived.
 *
 * The answer is validated with zod (with a local repair of fences, chatter and nulls). An answer
 * that still fails gets one repair retry, which tells the model what was wrong. After that the
 * turn falls back to a canned line ("say that again" / "come back later"); the server's turn id
 * stays unused, so the player can simply try again.
 *
 * The model is injected (`TemplateChatPort`); `firebaseModel.ts` has the real one. Streaming:
 * the web SDK's `TemplateChatSession.sendMessageStream` streams template chat answers (checked
 * against firebase/ai 3.1.0's types; architecture §12 asked).
 */

export interface TemplateChatRequest {
  templateId: string;
  variables: TemplateVariables;
  history: HistoryContent[];
  message: string;
  signal: AbortSignal;
}

/** Streams the answer's text chunks. Throws on a failed call. */
export type TemplateChatPort = (request: TemplateChatRequest) => AsyncIterable<string>;

/** A single (non-chat) template call returning the answer text (openers). */
export type TemplateGeneratePort = (request: { templateId: string; variables: TemplateVariables }) => Promise<string>;

/** Attempts per turn: the first and one repair retry. */
export const NPC_TURN_ATTEMPTS = 2;

export interface NpcTurnInput {
  context: NpcContextMessage;
  player: NpcPlayerInfo;
  /** Earlier turns of this conversation (the last 8 are sent). */
  history: readonly NpcHistoryTurn[];
  playerText: string;
  method: InputMethod;
  /** Line texts as they stream in (target language). Called again on the retry. */
  onText?: (lines: string[]) => void;
}

export type NpcTurnResult =
  | { ok: true; reply: NpcTurnReply; attempts: number }
  | {
      ok: false;
      /** `unavailable`: no cloud backend, no call made; `failed`: the answer stayed unusable. */
      reason: "unavailable" | "failed";
      /** A canned line in the target language, or null (then the UI shows its own message). */
      fallback: NpcLine | null;
    };

export interface NpcTurnDeps {
  chat: TemplateChatPort;
  /** A real Firebase project with AI Logic (false for the `demo-*` emulator project). */
  cloudEnabled: boolean;
  /** Overrides the template id (TODO(M38): from Remote Config). */
  templateId?: string;
  warn?: (message: string, error: unknown) => void;
  /**
   * The player's AI budget (build plan M36): with no NPC turns or cloud tokens left the turn is not
   * sent and the NPC answers with the canned "busy" line. Each turn is charged one turn plus the
   * estimated tokens of what was sent and received.
   */
  budget?: Pick<AiBudget, "allow" | "charge">;
}

export interface NpcTurnRunner {
  run(input: NpcTurnInput): Promise<NpcTurnResult>;
  /** A canned line of a kind, for the caller's own fallbacks (limits reached). */
  canned(kind: CannedKind, context: Pick<NpcContextMessage, "lang" | "nativeLang">): NpcLine | null;
}

class TooLongError extends Error {
  constructor() {
    super(`answer longer than ${NPC_TURN_MAX_OUTPUT_CHARS} characters`);
  }
}

/** The repair retry's note, after the quoted player text (never inside it). */
export function repairNote(error: string): string {
  const reason = error.replace(/\s+/g, " ").slice(0, 200);
  return `\n\n(Your previous answer to this message could not be used: ${reason}. Answer again with ONLY valid JSON matching the output schema, in character.)`;
}

export function createNpcTurnRunner(deps: NpcTurnDeps): NpcTurnRunner {
  const warn = deps.warn ?? ((message, error) => console.warn(message, error));
  const templateId = deps.templateId ?? PROMPT_TEMPLATE_IDS.npcTurn;

  async function attempt(request: TemplateChatRequest, onText: NpcTurnInput["onText"]): Promise<string> {
    let text = "";
    let shown = 0;
    for await (const chunk of deps.chat(request)) {
      text += chunk;
      // The per-turn output cap: stop reading (and paying for nothing) past it.
      if (text.length > NPC_TURN_MAX_OUTPUT_CHARS) throw new TooLongError();
      if (onText) {
        const lines = streamedLineTexts(text);
        if (lines.length > shown) {
          shown = lines.length;
          onText(lines);
        }
      }
    }
    return text;
  }

  const canned: NpcTurnRunner["canned"] = (kind, ctx) => cannedLine(kind, ctx.lang, ctx.nativeLang);

  return {
    canned,
    async run(input) {
      if (!deps.cloudEnabled) return { ok: false, reason: "unavailable", fallback: canned("busy", input.context) };
      const budget = deps.budget;
      if (budget && !(budget.allow("turns") && budget.allow("tokens"))) return { ok: false, reason: "unavailable", fallback: canned("busy", input.context) };
      const base = buildNpcTurnRequest(input.context, input.player, input.history, input.playerText, input.method);
      budget?.charge("turns");
      let lastError = "";
      for (let n = 1; n <= NPC_TURN_ATTEMPTS; n++) {
        const controller = new AbortController();
        const message = n === 1 ? base.message : base.message + repairNote(lastError);
        try {
          const text = await attempt({ templateId, variables: base.variables, history: base.history, message, signal: controller.signal }, input.onText);
          budget?.charge("tokens", base.tokens + estimateTokens(text));
          const parsed = parseNpcTurnReply(text);
          if (parsed.ok) return { ok: true, reply: parsed.reply, attempts: n };
          lastError = parsed.error;
        } catch (error) {
          controller.abort();
          // A failed or aborted call may still have been billed for its input.
          budget?.charge("tokens", base.tokens);
          lastError = error instanceof TooLongError ? "it was far too long; keep lines short" : "the call failed";
          if (n === NPC_TURN_ATTEMPTS) warn("ai: npc turn call failed", error);
        }
      }
      warn(`ai: npc turn unusable after ${NPC_TURN_ATTEMPTS} attempts`, lastError);
      return { ok: false, reason: "failed", fallback: canned("retry", input.context) };
    },
  };
}
