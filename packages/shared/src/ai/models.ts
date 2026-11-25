/**
 * Model ids, kept in one place (architecture §5.1). Every call runs in the client through
 * Firebase AI Logic; the game server never calls a model.
 */
export const MODEL_IDS = {
  /** NPC dialogue turns and openers (server prompt templates `ai/templates/*.prompt`, cloud only). */
  npcTurn: "gemini-3.8-flash",
  /** Cloud fallback for the small hybrid tasks (`inCloudParams.model`). */
  cloudFallback: "gemini-3.5-flash-lite",
  /** TTS (raw 24 kHz mono 16-bit PCM), called by the client per line (`ai/tts.ts`). */
  tts: "gemini-3.1-flash-tts-preview",
} as const;
export type ModelRole = keyof typeof MODEL_IDS;
