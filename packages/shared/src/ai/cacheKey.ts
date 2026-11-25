/**
 * Content-hash cache keys (CLAUDE.md, architecture §8.3): `sha256(kind, npcId, lang, level, text)`.
 * This builds the canonical string that is hashed; the client hashes it with Web Crypto (shared
 * has no DOM or Node crypto). The version prefix changes when a prompt or schema changes so old
 * answers are not reused.
 */
export const CONTENT_KEY_VERSION = "hv-ai-1";

export interface ContentKeyParts {
  /** What the answer is: a task name ("gloss", "translateShort", …) or "tts". */
  kind: string;
  /** The NPC who says it ("" for player and chat text). */
  npcId?: string;
  /** The language (pair): "es", or "es>en" for a translation from Spanish into English. */
  lang: string;
  /** The CEFR level the answer was made for ("" when it does not depend on one). */
  level?: string;
  text: string;
}

/** Unambiguous (JSON-encoded) and case-normalised for the language. */
export function contentKeyMaterial(p: ContentKeyParts): string {
  return JSON.stringify([CONTENT_KEY_VERSION, p.kind, p.npcId ?? "", p.lang.toLowerCase(), p.level ?? "", p.text.trim()]);
}
