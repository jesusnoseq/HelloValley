import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  buildNpcTurnVariables,
  cardOf,
  localDayNumber,
  notebookEntryFromDraft,
  notebookEntryId,
  type NotebookItem,
  Rating,
  reviewCard,
  ReviewDoneResponseSchema,
} from "@hellovalley/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireAuth } from "../auth/middleware";
import { InvalidIdTokenError } from "../auth/idToken";
import { NpcDialogueService } from "../npc/dialogue";
import { createMemoryNpcStore } from "../npc/npcStore";
import { reviewRouter } from "../routes/review";
import { createMemoryStreakStore } from "./streakStore";

/**
 * Build plan M25 on the server: the NPC context carries the notebook's learning words (picked by
 * FSRS state), and `POST /api/review` counts review days for the streak.
 */

const T0 = Date.UTC(2026, 10, 25, 10, 0, 0);
const WORDS = ["pan", "leche", "harina", "azúcar", "mantequilla", "café", "queso", "manzana", "huevo", "miel"];

function savedAndReviewed(now: number): NotebookItem[] {
  return WORDS.map((w, i) => {
    const entry = notebookEntryFromDraft({ lang: "es", surface: w, example: `Quiero ${w}.`, source: "npc:baker" })!;
    const item: NotebookItem = { id: notebookEntryId(entry), entry, createdMs: now - 3_600_000 + i };
    return { ...item, entry: { ...entry, fsrs: reviewCard(cardOf(item), w === "miel" ? Rating.Easy : Rating.Good, now - 60_000) } };
  });
}

describe("learning words in the NPC context (build plan M25 acceptance)", () => {
  it("save 10 words, review them, and the Baker's prompt carries learning words", async () => {
    const notebook = savedAndReviewed(Date.now());
    const store = createMemoryNpcStore({ "lia/es": { level: "A1", coins: 50, hearts: {}, slots: [], notebook } });
    const npc = new NpcDialogueService(store);
    const start = await npc.start({ uid: "lia", npcId: "baker", lang: "es", nativeLang: "en" }, T0);
    if (!start.ok) throw new Error(start.reason);
    expect(start.context.learningWords).toHaveLength(5);
    // "miel" was rated Easy: it graduated (a review card, not yet known), so it is still "learning".
    for (const w of start.context.learningWords) expect(WORDS).toContain(w);
    const vars = buildNpcTurnVariables(start.context, { name: "Lia", animal: "fox", apartmentId: "3B" });
    expect(JSON.parse(String(vars.learning_words))).toEqual(start.context.learningWords);
  });
});

describe("POST /api/review (streak)", () => {
  let server: Server;
  let base: string;
  let now = T0;
  const streaks = createMemoryStreakStore({ "lia/es": { streak: 0, day: null, reviews: [] } });

  beforeAll(async () => {
    const app = express();
    app.use(
      "/api",
      requireAuth({
        verify: async (t) => {
          if (t !== "valid:lia") throw new InvalidIdTokenError();
          return { uid: "lia", admin: false };
        },
      }),
    );
    app.use("/api", express.json());
    app.use("/api", reviewRouter({ streaks, now: () => now }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (body: unknown, token = "valid:lia") =>
    fetch(`${base}/api/review`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("needs a recent review, then counts consecutive days", async () => {
    const day = localDayNumber(now, 0);
    expect((await post({ lang: "es", day })).status).toBe(409);
    streaks.players.get("lia/es")!.reviews.push(now - 1000);
    const first = await post({ lang: "es", day });
    expect(first.status).toBe(200);
    expect(ReviewDoneResponseSchema.parse(await first.json())).toEqual({ streak: 1, day });
    // The same day again changes nothing.
    expect(await (await post({ lang: "es", day })).json()).toEqual({ streak: 1, day });
    // The next day, after another session.
    now += 86_400_000;
    streaks.players.get("lia/es")!.reviews.push(now - 1000);
    expect(await (await post({ lang: "es", day: day + 1 })).json()).toEqual({ streak: 2, day: day + 1 });
  });

  it("refuses implausible days, unknown languages, bad bodies and missing tokens", async () => {
    const day = localDayNumber(now, 0);
    expect((await post({ lang: "es", day: day + 5 })).status).toBe(400);
    expect((await post({ lang: "fr", day })).status).toBe(404);
    expect((await post({ lang: "es", day, extra: 1 })).status).toBe(400);
    expect((await post({ lang: "es", day }, "nope")).status).toBe(401);
  });
});
