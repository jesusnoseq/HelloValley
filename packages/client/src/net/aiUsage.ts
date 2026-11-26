import { type AiUsageMessage, ClientMessage } from "@hellovalley/shared";
import { drainAiUsage } from "../ai/client";

/** How often the client reports its AI usage (the server drops reports closer than 10 s). */
export const AI_USAGE_REPORT_MS = 60_000;

interface UsageRoom {
  send(type: string, payload: unknown): void;
  connection: { isOpen: boolean };
}

/**
 * Sends `ai:usage` once a minute while the town room is up (build plan M36): what this device
 * spent on AI since the last report and which budgets ran out, so the server metrics show the
 * budgets in use. Nothing is sent while nothing was spent (or the AI runtime never loaded).
 */
export function attachAiUsageReports(room: UsageRoom, drain: () => Promise<AiUsageMessage | null> = drainAiUsage, everyMs = AI_USAGE_REPORT_MS): () => void {
  const timer = setInterval(() => {
    if (!room.connection.isOpen) return;
    void drain()
      .then((usage) => {
        if (usage && room.connection.isOpen) room.send(ClientMessage.AiUsage, usage);
      })
      .catch(() => undefined);
  }, everyMs);
  return () => clearInterval(timer);
}
