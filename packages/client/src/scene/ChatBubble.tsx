import { Html } from "@react-three/drei";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { chat, type ChatLine, useChat } from "../net/chatSession";
import { bubbleLines, hasHover, nextBubbleExpiry } from "../ui/chat/chatView";

const bubble: CSSProperties = {
  maxWidth: 240,
  padding: "6px 10px",
  borderRadius: 12,
  background: "rgba(255, 250, 240, 0.95)",
  color: "#3d3a44",
  font: "14px/1.35 system-ui, sans-serif",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
  display: "grid",
  gap: 4,
  overflowWrap: "anywhere",
  pointerEvents: "auto",
  userSelect: "text",
};

const extra: CSSProperties = { fontSize: 12, opacity: 0.75, borderTop: "1px solid rgba(61, 58, 68, 0.15)", paddingTop: 3 };

/**
 * The chat bubble above an avatar (build plan M18, GDD §6.6): the speaker's last lines of the
 * past few seconds, each in the reader's target language. Hovering a line shows the original as
 * written plus its translation into the reader's native language. A DOM overlay (drei `Html`), so
 * it costs no draw calls and any script renders with the system fonts.
 * TODO(M19): the tokenized speech bubble (word hover, click-to-save, script toggle) replaces the
 * plain text for chat lines too.
 */
export function ChatBubble({ sessionId, y }: { sessionId: string; y: number }) {
  const lines = useChat((s) => s.lines);
  const [now, setNow] = useState(() => Date.now());
  const shown = useMemo(() => bubbleLines(lines, sessionId, now), [lines, sessionId, now]);
  // The bubble re-renders when its oldest line expires (new lines always count as fresh).
  useEffect(() => {
    const wait = nextBubbleExpiry(shown, Date.now());
    if (wait === null) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 20);
    return () => clearTimeout(timer);
  }, [shown]);
  if (shown.length === 0) return null;
  return (
    <Html position={[0, y, 0]} center zIndexRange={[20, 0]} style={{ transform: "translateY(-50%)" }}>
      <div style={bubble}>
        {shown.map((line) => (
          <BubbleLine key={line.id} line={line} />
        ))}
      </div>
    </Html>
  );
}

function BubbleLine({ line }: { line: ChatLine }) {
  const [hover, setHover] = useState(false);
  const pending = line.shown.status === "pending";
  return (
    <div
      lang={line.shown.status === "translated" ? line.plan.shownLang : line.lang}
      onPointerEnter={() => {
        setHover(true);
        chat.requestHover(line.id);
      }}
      onPointerLeave={() => setHover(false)}
    >
      <span style={pending ? { opacity: 0.6 } : undefined}>{line.shown.text}</span>
      {hover && hasHover(line) ? <HoverDetails line={line} /> : null}
    </div>
  );
}

/** The original as written, plus the native-language translation when there is one. */
export function HoverDetails({ line }: { line: ChatLine }) {
  return (
    <div style={extra}>
      {line.shown.status === "translated" ? <div lang={line.lang}>{line.original}</div> : null}
      {line.hover.status === "ready" ? <div lang={line.plan.hover?.translateTo ?? undefined}>🌐 {line.hover.text}</div> : null}
      {line.hover.status === "pending" ? <div aria-hidden="true">🌐 …</div> : null}
    </div>
  );
}
