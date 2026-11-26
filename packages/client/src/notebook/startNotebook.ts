import { ttsKeyMaterial } from "@hellovalley/shared";
import { sha256Hex } from "../ai/cache";
import { lazyTranslator } from "../ai/client";
import { db } from "../firebase/firestore";
import { postReview, type TokenSource } from "../net/api";
import { onSaveWord } from "../ui/speech/wordEvents";
import { firestoreNotebookRepo } from "./firestoreNotebook";
import { createNotebook, type Notebook } from "./notebook";

let active: Notebook | null = null;

/** The running notebook (null before sign-in), for the review UI. */
export function currentNotebook(): Notebook | null {
  return active;
}

/**
 * Starts the game's notebook for a player and target language (build plan M25): mirrors the
 * Firestore entries, saves every clicked word (bubbles, chat, world labels) and reports review
 * sessions to the server. Loaded lazily after sign-in so the Firestore SDK stays out of the entry
 * chunk. Returns the stop function.
 */
export function startNotebook(user: TokenSource & { uid: string }, lang: string, nativeLang: string): () => void {
  const notebook = createNotebook({
    repo: firestoreNotebookRepo(db, user.uid),
    audioHash: (line) => sha256Hex(ttsKeyMaterial(line)),
    gloss: async (surface, from, to) => {
      const r = await lazyTranslator.translate({ messageId: `word:${surface}`, text: surface, from, to });
      return r.ok ? r.text : null;
    },
    reportReview: async (l, day) => {
      const r = await postReview(user, { lang: l, day });
      return { streak: r.streak, day: r.day };
    },
  });
  active = notebook;
  notebook.start(lang, nativeLang);
  const off = onSaveWord((draft) => void notebook.save(draft));
  return () => {
    off();
    notebook.stop();
    if (active === notebook) active = null;
  };
}
