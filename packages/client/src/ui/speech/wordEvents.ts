import type { SaveWordDraft } from "@hellovalley/shared";

/**
 * "Click a word → saved to the notebook" (GDD §6.1, build plan M19). Speech bubbles emit the
 * word here; the notebook subscribes.
 * Build plan M25: chat lines and world labels emit here too; the notebook (notebook/startNotebook.ts)
 * listens and writes `users/{uid}/langs/{lang}/notebook/{entryId}`.
 */

type Listener = (draft: SaveWordDraft) => void;

const listeners = new Set<Listener>();

export function onSaveWord(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSaveWord(draft: SaveWordDraft): void {
  for (const listener of [...listeners]) listener(draft);
}
