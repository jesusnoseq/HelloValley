import {
  type AiBudgetKind,
  type AiBudgetLedger,
  AiBudgetLedgerSchema,
  type AiUsageMessage,
  budgetRemaining,
  chargeBudget,
  checkBudget,
  emptyBudgetLedger,
} from "@hellovalley/shared";

/**
 * The player's AI budgets on this device (build plan M36, shared ai/budget.ts, architecture §9).
 * Every model call runs in the client, so this is where an honest client stops spending: before
 * an NPC turn, a TTS clip or a cloud call it asks `allow`, and afterwards it `charge`s what was
 * used. When a budget is used up the game degrades gracefully instead of calling the model:
 *
 * - NPC turns → the NPC's canned "busy, come back later" line (templates.ts);
 * - TTS seconds → the line stays text only, with the 🔇 badge (tts.ts);
 * - cloud tokens → small tasks run on-device only or come from the caches; NPC turns and opener
 *   generation stop (hybrid.ts, templates.ts, openers.ts).
 *
 * This is not the security boundary (a modified client can skip it): the hard caps are App Check,
 * the AI Logic per-user rate limit and the project quotas, and the server's own NPC turn limits.
 * The ledger is kept per player in localStorage (`hv-ai-budget-<uid>`), so a reload does not reset
 * it; storage failures (private mode) keep it in memory.
 */
export interface AiBudget {
  /** May `amount` more be spent now? A refusal is remembered for the next usage report. */
  allow(kind: AiBudgetKind, amount?: number): boolean;
  charge(kind: AiBudgetKind, amount?: number): void;
  remaining(): Record<AiBudgetKind, number>;
  /** What was spent since the last call, and which budgets ran out (for `ai:usage`); null when nothing happened. */
  drain(): AiUsageMessage | null;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AiBudgetOptions {
  /** Where the ledger persists; null keeps it in memory. */
  storage?: KeyValueStore | null;
  key?: string;
  now?: () => number;
}

export const budgetStorageKey = (uid: string) => `hv-ai-budget-${uid}`;

export function createAiBudget({ storage = null, key = "hv-ai-budget", now = Date.now }: AiBudgetOptions = {}): AiBudget {
  let ledger: AiBudgetLedger = emptyBudgetLedger(now());
  try {
    const raw = storage?.getItem(key);
    const parsed = raw ? AiBudgetLedgerSchema.safeParse(JSON.parse(raw)) : null;
    if (parsed?.success) ledger = parsed.data;
  } catch {
    // Unreadable storage: start a fresh ledger in memory.
  }
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(ledger));
    } catch {
      // Private mode or a full quota: the ledger lives on in memory.
    }
  };
  let pending: Omit<AiUsageMessage, "degraded"> = { turns: 0, ttsSeconds: 0, tokens: 0 };
  let degraded = new Set<AiBudgetKind>();

  return {
    allow(kind, amount) {
      const ok = checkBudget(ledger, kind, now(), amount).ok;
      if (!ok) degraded.add(kind);
      return ok;
    },
    charge(kind, amount) {
      const before = ledger;
      ledger = chargeBudget(ledger, kind, now(), amount);
      if (kind === "turns") pending.turns += ledger.turns - (before.day === ledger.day ? before.turns : 0);
      if (kind === "tts") pending.ttsSeconds += ledger.ttsSeconds - (before.day === ledger.day ? before.ttsSeconds : 0);
      if (kind === "tokens") pending.tokens += ledger.cloudTokens - (before.day === ledger.day ? before.cloudTokens : 0);
      save();
    },
    remaining: () => budgetRemaining(ledger, now()),
    drain() {
      if (pending.turns === 0 && pending.ttsSeconds === 0 && pending.tokens === 0 && degraded.size === 0) return null;
      const report: AiUsageMessage = { turns: pending.turns, ttsSeconds: Math.round(pending.ttsSeconds * 10) / 10, tokens: pending.tokens, degraded: [...degraded] };
      pending = { turns: 0, ttsSeconds: 0, tokens: 0 };
      degraded = new Set();
      return report;
    },
  };
}

/** localStorage when the page has it (wrapped: access itself can throw). */
export function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The signed-in player's budget (one per uid; before sign-in, a memory-only one). */
let current: { uid: string | null; budget: AiBudget } = { uid: null, budget: createAiBudget() };

export function aiBudgetFor(uid: string | null): AiBudget {
  if (current.uid !== uid) current = { uid, budget: createAiBudget(uid ? { storage: browserStorage(), key: budgetStorageKey(uid) } : {}) };
  return current.budget;
}

/** The current player's budget (the AI runtime and the usage reports share it). */
export const currentAiBudget = (): AiBudget => current.budget;
