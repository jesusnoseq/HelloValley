import { type ChatLine, useChat } from "../../net/chatSession";
import { emitSaveWord } from "../speech/wordEvents";

export interface ChatPiece {
  text: string;
  /** A word that can be saved (not a space or punctuation). */
  word: boolean;
}

/** A chat line as words and gaps, in its language (`Intl.Segmenter`, so unspaced scripts split too). */
export function chatPieces(text: string, lang: string): ChatPiece[] {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) return [{ text, word: false }];
  let seg: Intl.Segmenter;
  try {
    seg = new Intl.Segmenter(lang, { granularity: "word" });
  } catch {
    seg = new Intl.Segmenter(undefined, { granularity: "word" });
  }
  return [...seg.segment(text)].map((s) => ({ text: s.segment, word: Boolean(s.isWordLike) }));
}

/** The language a line is shown in (the reader's target language when it was translated). */
export const shownLang = (line: ChatLine) => (line.shown.status === "translated" ? line.plan.shownLang : line.lang);

/**
 * A chat line's shown text with clickable words (GDD §6.6 "words in chat messages can be clicked
 * and saved to the notebook like NPC words", build plan M25): only when the line is shown in the
 * reader's target language. The line is the example sentence and the source is `chat`; the
 * notebook adds a gloss when it can.
 */
export function ChatWords({ line }: { line: ChatLine }) {
  const target = useChat((s) => s.reader?.targetLang ?? null);
  const lang = shownLang(line);
  const text = line.shown.text;
  if (line.shown.status === "pending" || !target || lang !== target) return <>{text}</>;
  return (
    <>
      {chatPieces(text, lang).map((p, i) =>
        p.word ? (
          <span
            key={i}
            role="button"
            tabIndex={0}
            className="hv-chat-word"
            style={{ cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
            onClick={() => emitSaveWord({ lang, surface: p.text, example: text, source: "chat" })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                emitSaveWord({ lang, surface: p.text, example: text, source: "chat" });
              }
            }}
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
