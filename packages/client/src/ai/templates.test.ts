import { describe, expect, it, vi } from "vitest";
import { BAKER_ES_A1_REPLY, BAKER_JA_B2_REPLY, npcContextFixture } from "../../../shared/src/npc/fixtures";
import { NPC_TURN_MAX_OUTPUT_CHARS, PROMPT_TEMPLATE_IDS } from "@hellovalley/shared";
import { createNpcTurnRunner, type TemplateChatPort, type TemplateChatRequest } from "./templates";

/**
 * NPC turns with a mocked model (build plan M21 acceptance): the Baker in Spanish at A1 and in
 * Japanese at B2 offering bread, streamed text, malformed answers repaired or falling back.
 */

const player = { name: "Lia", animal: "fox", apartmentId: "3B" };

/** A model that answers each call with the next script entry, streamed in small chunks. */
function scripted(answers: (string | Error)[]): { port: TemplateChatPort; calls: TemplateChatRequest[] } {
  const calls: TemplateChatRequest[] = [];
  const port: TemplateChatPort = (request) => {
    calls.push(request);
    const answer = answers[calls.length - 1] ?? new Error("no more answers");
    return (async function* () {
      if (answer instanceof Error) throw answer;
      for (let i = 0; i < answer.length; i += 17) yield answer.slice(i, i + 17);
    })();
  };
  return { port, calls };
}

const input = (lang: "es" | "ja", playerLevel: "A1" | "B2", playerText: string) => ({
  context: npcContextFixture({ lang, playerLevel }),
  player,
  history: [],
  playerText,
  method: "typed" as const,
});

describe("NPC turn runner", () => {
  it("talks to the Baker in Spanish at A1 and gets an offer for bread", async () => {
    const { port, calls } = scripted([JSON.stringify(BAKER_ES_A1_REPLY)]);
    const runner = createNpcTurnRunner({ chat: port, cloudEnabled: true });
    const streamed: string[][] = [];
    const result = await runner.run({ ...input("es", "A1", "Quiero pan, por favor."), onText: (l) => streamed.push(l) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reply.lines[0]!.text).toBe("¡Sí, cariño! Pan, cinco monedas.");
    expect(result.reply.actions).toEqual([{ type: "offer", itemId: "bread", qty: 1, price: 1 }]);
    expect(result.attempts).toBe(1);
    // The line showed while the rest of the answer was still streaming.
    expect(streamed).toEqual([["¡Sí, cariño! Pan, cinco monedas."]]);
    const call = calls[0]!;
    expect(call.templateId).toBe(PROMPT_TEMPLATE_IDS.npcTurn);
    expect(call.variables).toMatchObject({ target: "Spanish", effective_level: "A1", num_suggestions: 3, is_baker: true });
    expect(call.message).toBe("<player_text>Quiero pan, por favor.</player_text>\nInput method: typed");
  });

  it("talks to the Baker in Japanese at B2 (effective B1) with readings", async () => {
    const { port, calls } = scripted([JSON.stringify(BAKER_JA_B2_REPLY)]);
    const result = await createNpcTurnRunner({ chat: port, cloudEnabled: true }).run(input("ja", "B2", "パンをください。"));
    expect(result.ok && result.reply.lines[0]!.reading).toMatch(/yakitate/);
    expect(result.ok && result.reply.actions[0]).toMatchObject({ type: "offer", itemId: "bread" });
    expect(calls[0]!.variables).toMatchObject({ target: "Japanese", effective_level: "B1", max_words_per_line: 16 });
  });

  it("repairs a fenced answer with chatter locally, without a second call", async () => {
    const { port, calls } = scripted(["Here you go!\n```json\n" + JSON.stringify(BAKER_ES_A1_REPLY) + "\n```"]);
    const result = await createNpcTurnRunner({ chat: port, cloudEnabled: true }).run(input("es", "A1", "pan"));
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("retries once with a repair note when the answer has the wrong shape", async () => {
    const { port, calls } = scripted(['{"lines":[{"text":"Hola"}]}', JSON.stringify(BAKER_ES_A1_REPLY)]);
    const result = await createNpcTurnRunner({ chat: port, cloudEnabled: true, warn: () => undefined }).run(input("es", "A1", "pan"));
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[1]!.message).toMatch(/^<player_text>pan<\/player_text>\nInput method: typed\n\n\(Your previous answer to this message could not be used: lines\.0\./);
    // The repair note is outside the quoted player text.
    expect(calls[1]!.message.indexOf("</player_text>")).toBeLessThan(calls[1]!.message.indexOf("could not be used"));
  });

  it("falls back to a canned line when both attempts fail (and the turn id stays unused)", async () => {
    const warn = vi.fn();
    const { port, calls } = scripted(["not json at all", new Error("503")]);
    const result = await createNpcTurnRunner({ chat: port, cloudEnabled: true, warn }).run(input("es", "A1", "pan"));
    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("failed");
    expect(result.fallback?.text).toMatch(/Puedes repetirlo/);
    expect(warn).toHaveBeenCalled();
  });

  it("stops reading an answer past the per-turn output cap", async () => {
    const { port, calls } = scripted(["x".repeat(NPC_TURN_MAX_OUTPUT_CHARS + 10), JSON.stringify(BAKER_JA_B2_REPLY)]);
    const result = await createNpcTurnRunner({ chat: port, cloudEnabled: true, warn: () => undefined }).run(input("ja", "B2", "パン"));
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.message).toMatch(/far too long/);
  });

  it("makes no call without a cloud backend and says the NPC is busy", async () => {
    const { port, calls } = scripted([]);
    const result = await createNpcTurnRunner({ chat: port, cloudEnabled: false }).run(input("ja", "B2", "パン"));
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(!result.ok && result.fallback?.text).toMatch(/忙しい/);
  });
});
