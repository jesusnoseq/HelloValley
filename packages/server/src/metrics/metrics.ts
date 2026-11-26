import { AI_BUDGET, type AiBudgetKind, type AiBudgetLimits, type AiUsageMessage, utcDayOf } from "@hellovalley/shared";

/**
 * Budget and abuse counters for the server metrics endpoint (build plan M36: "the budget limits are
 * visible in the server metrics"). In memory: there is one game server process (architecture
 * §3.1), so a restart resets them (`startedAt` says since when). `GET /api/metrics` (admin claim
 * only, http.ts) returns `snapshot()`.
 *
 * The AI numbers come from two places: NPC turns are counted by the server itself (it issues the
 * turn ids); TTS seconds and cloud tokens are what the clients report (`ai:usage`), untrusted and
 * clamped, because the calls run in the client (architecture §9).
 */

export type CounterName =
  // Chat and names (moderation)
  | "chat.delivered"
  | "chat.rejected.rate"
  | "chat.rejected.moderation"
  | "chat.rejected.muted"
  | `moderation.blocked.${string}`
  | "moderation.strikes"
  | "moderation.mutes"
  | "moderation.reports"
  | "names.rejected"
  // NPC turns (server-enforced budget)
  | "npc.contexts"
  | "npc.turns.accepted"
  | `npc.refused.${string}`
  | `npc.actions.rejected.${string}`
  // Client-reported AI usage
  | "ai.reports"
  | "ai.reports.dropped"
  | "ai.client.turns"
  | "ai.client.ttsSeconds"
  | "ai.client.tokens"
  | `ai.client.degraded.${AiBudgetKind}`
  // Auth and protocol abuse
  | "auth.idToken.rejected"
  | "auth.appCheck.missing"
  | "auth.appCheck.rejected"
  | "abuse.move.rejected"
  | "abuse.messages.invalid"
  | "abuse.messages.dropped"
  | "abuse.kicked";

/** Most a single `ai:usage` report may add (above it the report is clamped; my numbers, a few minutes of play). */
export const AI_USAGE_REPORT_CAP = { turns: AI_BUDGET.npcTurnsPerWindow, ttsSeconds: 600, tokens: 100_000 } as const;

interface PlayerUsage {
  day: string;
  turns: number;
  ttsSeconds: number;
  tokens: number;
  degraded: Set<AiBudgetKind>;
}

export interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  live: { shards: number; players: number };
  budgets: {
    /** The per-player limits (shared AI_BUDGET), as enforced (turns) or degraded to (TTS, tokens). */
    limits: Readonly<AiBudgetLimits>;
    npcTurns: { contexts: number; accepted: number; refused: Record<string, number> };
    rejectedActions: Record<string, number>;
    clientReported: {
      reports: number;
      dropped: number;
      turns: number;
      ttsSeconds: number;
      tokens: number;
      degraded: Record<AiBudgetKind, number>;
      /** Today (UTC): players who reported usage, and how many ran out of each budget. */
      today: { day: string; players: number; overBudget: Record<AiBudgetKind, number> };
    };
  };
  abuse: {
    chat: { delivered: number; rejected: { rate: number; moderation: number; muted: number } };
    blocked: Record<string, number>;
    strikes: number;
    mutes: number;
    mutedNow: number;
    reports: number;
    namesRejected: number;
    auth: { idTokenRejected: number; appCheckMissing: number; appCheckRejected: number };
    protocol: { moveRejected: number; invalidMessages: number; droppedMessages: number; kicked: number };
  };
}

export class ServerMetrics {
  readonly startedAt: number;
  private readonly counters = new Map<string, number>();
  private readonly usage = new Map<string, PlayerUsage>();
  /** Live gauges, filled in by the server (shards, players, muted players). */
  gauges: () => { shards: number; players: number; mutedNow: number } = () => ({ shards: 0, players: 0, mutedNow: 0 });

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  inc(name: CounterName, by = 1): void {
    if (!Number.isFinite(by) || by <= 0) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  get(name: CounterName): number {
    return this.counters.get(name) ?? 0;
  }

  private byPrefix(prefix: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    return out;
  }

  /** One client's `ai:usage` report, clamped (the numbers are the client's word). */
  reportUsage(uid: string, report: AiUsageMessage): void {
    const turns = Math.min(report.turns, AI_USAGE_REPORT_CAP.turns);
    const ttsSeconds = Math.min(report.ttsSeconds, AI_USAGE_REPORT_CAP.ttsSeconds);
    const tokens = Math.min(report.tokens, AI_USAGE_REPORT_CAP.tokens);
    this.inc("ai.reports");
    this.inc("ai.client.turns", turns);
    this.inc("ai.client.ttsSeconds", Math.round(ttsSeconds * 10) / 10);
    this.inc("ai.client.tokens", tokens);
    const day = utcDayOf(this.now());
    let u = this.usage.get(uid);
    if (!u || u.day !== day) {
      u = { day, turns: 0, ttsSeconds: 0, tokens: 0, degraded: new Set() };
      this.usage.set(uid, u);
    }
    u.turns += turns;
    u.ttsSeconds += ttsSeconds;
    u.tokens += tokens;
    for (const kind of new Set(report.degraded)) {
      if (!u.degraded.has(kind)) this.inc(`ai.client.degraded.${kind}`);
      u.degraded.add(kind);
    }
  }

  snapshot(): MetricsSnapshot {
    const now = this.now();
    const day = utcDayOf(now);
    const today = [...this.usage.values()].filter((u) => u.day === day);
    const over = (kind: AiBudgetKind, used: (u: PlayerUsage) => boolean) => today.filter((u) => u.degraded.has(kind) || used(u)).length;
    const g = this.gauges();
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.round((now - this.startedAt) / 1000),
      live: { shards: g.shards, players: g.players },
      budgets: {
        limits: AI_BUDGET,
        npcTurns: { contexts: this.get("npc.contexts"), accepted: this.get("npc.turns.accepted"), refused: this.byPrefix("npc.refused.") },
        rejectedActions: this.byPrefix("npc.actions.rejected."),
        clientReported: {
          reports: this.get("ai.reports"),
          dropped: this.get("ai.reports.dropped"),
          turns: this.get("ai.client.turns"),
          ttsSeconds: this.get("ai.client.ttsSeconds"),
          tokens: this.get("ai.client.tokens"),
          degraded: { turns: this.get("ai.client.degraded.turns"), tts: this.get("ai.client.degraded.tts"), tokens: this.get("ai.client.degraded.tokens") },
          today: {
            day,
            players: today.length,
            overBudget: {
              turns: over("turns", (u) => u.turns >= AI_BUDGET.npcTurnsPerDay),
              tts: over("tts", (u) => u.ttsSeconds >= AI_BUDGET.ttsSecondsPerDay),
              tokens: over("tokens", (u) => u.tokens >= AI_BUDGET.cloudTokensPerDay),
            },
          },
        },
      },
      abuse: {
        chat: {
          delivered: this.get("chat.delivered"),
          rejected: { rate: this.get("chat.rejected.rate"), moderation: this.get("chat.rejected.moderation"), muted: this.get("chat.rejected.muted") },
        },
        blocked: this.byPrefix("moderation.blocked."),
        strikes: this.get("moderation.strikes"),
        mutes: this.get("moderation.mutes"),
        mutedNow: g.mutedNow,
        reports: this.get("moderation.reports"),
        namesRejected: this.get("names.rejected"),
        auth: { idTokenRejected: this.get("auth.idToken.rejected"), appCheckMissing: this.get("auth.appCheck.missing"), appCheckRejected: this.get("auth.appCheck.rejected") },
        protocol: {
          moveRejected: this.get("abuse.move.rejected"),
          invalidMessages: this.get("abuse.messages.invalid"),
          droppedMessages: this.get("abuse.messages.dropped"),
          kicked: this.get("abuse.kicked"),
        },
      },
    };
  }
}
