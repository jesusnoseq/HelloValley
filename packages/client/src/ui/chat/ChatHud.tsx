import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
// Only zod-free values from shared (protocol/messages), so the entry chunk stays small.
import { CHAT_MAX_LENGTH, CHAT_REPORT_REASONS } from "@hellovalley/shared";
import { languageDisplayName } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { chat, type ChatLine, type ChatNotice, useChat } from "../../net/chatSession";
import { visitSession } from "../../net/visitSession";
import { avatarStore } from "../../state/avatarStore";
import { conversationActive, conversationStore } from "../../state/conversationStore";
import { placementStore } from "../../state/placementStore";
import { hasHover, lineVisible } from "./chatView";

const surface: CSSProperties = {
  borderRadius: 12,
  background: "rgba(255, 250, 240, 0.93)",
  color: "#3d3a44",
  font: "14px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.18)",
};

const panel: CSSProperties = {
  ...surface,
  position: "fixed",
  left: 12,
  bottom: 12,
  width: "min(360px, calc(100vw - 24px))",
  padding: "8px 10px",
  display: "grid",
  gap: 6,
};

const log: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  maxHeight: "min(220px, 35vh)",
  overflowY: "auto",
  display: "grid",
  gap: 4,
  alignContent: "start",
};

const small: CSSProperties = { fontSize: 12, opacity: 0.75 };
const row: CSSProperties = { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" };
const linkButton: CSSProperties = { font: "inherit", fontSize: 12, padding: "0 6px" };

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Another dialog (mirror, intercom, placement mode, an NPC conversation) has the keyboard. */
function dialogOpen(): boolean {
  return (
    avatarStore.getState().mirrorOpen ||
    visitSession.getState().intercomOpen ||
    placementStore.getState().open ||
    conversationActive(conversationStore.getState())
  );
}

/**
 * The proximity chat HUD (build plan M18, GDD §6.6): the chat log of the lines that reached the
 * player (each shown in their target language; hovering shows the original and a translation into
 * their native language), Enter to type, the sender-side pre-check, the reader-side "show anyway",
 * mute / block / report on other players' lines, and the block list. The bubbles above avatars are
 * scene/ChatBubble.tsx.
 */
export function ChatHud({ targetLang, nativeLang }: { targetLang: string; nativeLang: string }) {
  const { t } = useI18n();
  const lines = useChat((s) => s.lines);
  const online = useChat((s) => s.online);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    chat.setReader({ targetLang, nativeLang });
    return () => chat.setReader(null);
  }, [targetLang, nativeLang]);

  // Enter opens the chat input (GDD §10), unless something else has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Enter" && e.code !== "NumpadEnter") return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target) || dialogOpen()) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the newest line in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (!online && lines.length === 0) return null;
  return (
    <section aria-label={t("chat.title")} style={panel}>
      <ul ref={listRef} style={log} aria-live="polite">
        {lines.length === 0 ? <li style={small}>{t("chat.empty")}</li> : null}
        {lines.map((line) => (
          <LineRow key={line.id} line={line} />
        ))}
      </ul>
      <Notice />
      {open ? (
        <ChatInput targetLang={targetLang} nativeLang={nativeLang} onClose={() => setOpen(false)} />
      ) : (
        <div style={row}>
          <button type="button" onClick={() => setOpen(true)}>
            {t("chat.open")}
          </button>
          <BlockedList />
        </div>
      )}
    </section>
  );
}

function LineRow({ line }: { line: ChatLine }) {
  const { t, locale } = useI18n();
  const muted = useChat((s) => s.muted.includes(line.from));
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState<"closed" | "actions" | "report">("closed");
  const name = line.own ? t("chat.you") : line.name;
  if (line.flagged === null) return null;
  if (!lineVisible(line)) {
    return (
      <li style={small}>
        <strong>{name}:</strong> {t("chat.flagged")}{" "}
        <button type="button" style={linkButton} onClick={() => chat.reveal(line.id)}>
          {t("chat.showAnyway")}
        </button>
      </li>
    );
  }
  const show = () => {
    setHover(true);
    chat.requestHover(line.id);
  };
  const nativeLang = line.plan.hover?.translateTo;
  return (
    <li>
      <div
        tabIndex={hasHover(line) ? 0 : undefined}
        onPointerEnter={show}
        onPointerLeave={() => setHover(false)}
        onFocus={show}
        onBlur={() => setHover(false)}
      >
        <strong>{name}:</strong>{" "}
        <span lang={line.shown.status === "translated" ? line.plan.shownLang : line.lang}>{line.shown.text}</span>
        {line.shown.status === "pending" ? <span style={small}> · {t("chat.translating")}</span> : null}
        {line.shown.status === "unavailable" ? <span style={small}> · {t("chat.translationUnavailable")}</span> : null}
        {!line.own ? (
          <button
            type="button"
            style={{ ...linkButton, marginLeft: 4 }}
            aria-label={t("chat.actions", { name: line.name })}
            aria-expanded={menu !== "closed"}
            onClick={() => setMenu(menu === "closed" ? "actions" : "closed")}
          >
            ⋯
          </button>
        ) : null}
        {hover && hasHover(line) ? (
          <div style={small}>
            {line.shown.status === "translated" ? <div lang={line.lang}>{t("chat.original", { text: line.original })}</div> : null}
            {nativeLang && line.hover.status === "ready" ? (
              <div lang={nativeLang}>{t("chat.nativeTranslation", { language: languageDisplayName(nativeLang, locale, nativeLang), text: line.hover.text ?? "" })}</div>
            ) : null}
            {nativeLang && line.hover.status === "pending" ? <div>{t("chat.translating")}</div> : null}
            {nativeLang && line.hover.status === "unavailable" ? <div>{t("chat.translationUnavailable")}</div> : null}
          </div>
        ) : null}
      </div>
      {menu === "actions" ? (
        <div style={row}>
          <button type="button" style={linkButton} onClick={() => (chat.mute(line.from, !muted), setMenu("closed"))}>
            {t(muted ? "chat.unmute" : "chat.mute")}
          </button>
          <button type="button" style={linkButton} onClick={() => (chat.block(line.from), setMenu("closed"))}>
            {t("chat.block")}
          </button>
          <button type="button" style={linkButton} onClick={() => setMenu("report")}>
            {t("chat.report")}
          </button>
        </div>
      ) : null}
      {menu === "report" ? (
        <div style={{ display: "grid", gap: 4 }}>
          <span style={small}>{t("chat.report.title", { name: line.name })}</span>
          <div style={row}>
            {CHAT_REPORT_REASONS.map((reason) => (
              <button key={reason} type="button" style={linkButton} onClick={() => (chat.report(line, reason), setMenu("closed"))}>
                {t(`chat.report.${reason}` as MessageKey)}
              </button>
            ))}
            <button type="button" style={linkButton} onClick={() => setMenu("closed")}>
              {t("chat.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function noticeText(t: ReturnType<typeof useI18n>["t"], notice: ChatNotice): string {
  if (notice.kind === "reported") return t(notice.ok ? "chat.reported.ok" : "chat.reported.failed");
  return t(`chat.rejected.${notice.reason}` as MessageKey);
}

/** How long a notice stays (my number). */
const NOTICE_MS = 5000;

function Notice() {
  const { t } = useI18n();
  const notice = useChat((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => chat.clearNotice(), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div role="status" style={{ ...row, ...small, opacity: 1 }}>
      <span>{noticeText(t, notice)}</span>
      <button type="button" style={linkButton} onClick={() => chat.clearNotice()}>
        {t("chat.dismiss")}
      </button>
    </div>
  );
}

function ChatInput({ targetLang, nativeLang, onClose }: { targetLang: string; nativeLang: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [writeNative, setWriteNative] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [offline, setOffline] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lang = writeNative && nativeLang !== targetLang ? nativeLang : targetLang;

  useEffect(() => {
    input.current?.focus();
    return () => chat.setTyping(false);
  }, []);

  const close = () => {
    chat.setTyping(false);
    onClose();
  };
  const submit = async (force: boolean) => {
    if (!text.trim()) return close();
    const result = await chat.send(text, lang, force);
    setOffline(result === "offline");
    setFlagged(result === "flagged");
    if (result === "sent") setText("");
    input.current?.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <form
        style={{ display: "flex", gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <input
          ref={input}
          aria-label={t("chat.input.label")}
          placeholder={t("chat.input.placeholder")}
          lang={lang}
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          style={{ flex: 1, minWidth: 0, font: "inherit", padding: "4px 8px" }}
          onChange={(e) => {
            setText(e.target.value);
            setFlagged(false);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => chat.setTyping(true)}
          onBlur={() => chat.setTyping(false)}
        />
        <button type="submit">{t("chat.send")}</button>
      </form>
      {nativeLang !== targetLang ? (
        <button type="button" style={{ ...linkButton, justifySelf: "start" }} title={t("chat.writingIn.toggle")} onClick={() => setWriteNative((w) => !w)}>
          {t("chat.writingIn", { language: languageDisplayName(lang, locale, lang) })} ⇄
        </button>
      ) : null}
      {flagged ? (
        <div role="alert" style={{ ...row, fontSize: 13 }}>
          <span>{t("chat.precheck")}</span>
          <button type="button" style={linkButton} onClick={() => void submit(true)}>
            {t("chat.sendAnyway")}
          </button>
          <button type="button" style={linkButton} onClick={() => (setFlagged(false), input.current?.focus())}>
            {t("chat.edit")}
          </button>
        </div>
      ) : null}
      {offline ? <span role="alert" style={small}>{t("chat.offline")}</span> : null}
    </div>
  );
}

function BlockedList() {
  const { t } = useI18n();
  const blocked = useChat((s) => s.blocked);
  if (blocked.length === 0) return null;
  return (
    <details style={small}>
      <summary>{t("chat.blocked.title", { count: String(blocked.length) })}</summary>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
        {blocked.map((p) => (
          <li key={p.uid} style={row}>
            <span>{p.name}</span>
            <button type="button" style={linkButton} onClick={() => chat.unblock(p.uid)}>
              {t("chat.unblock")}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
