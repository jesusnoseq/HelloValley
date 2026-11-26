import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { type InputMethod, isRecipeId, type NpcId, parseQuestId, PLAYER_TEXT_MAX_LENGTH, requestedSuggestions, type ScriptCode, type SuggestedReply } from "@hellovalley/shared";
import type { TtsSpeaker } from "../../ai/tts";
import { useLabelMap } from "../../labels/labelStore";
import { languageDisplayName } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { type Card, type ConversationNotice, type ConversationState, type LogEntry, useConversation } from "../../state/conversationStore";
import { RecipeCard } from "../food/RecipeCard";
import { SpeechBubble } from "../speech/SpeechBubble";
import { VoiceControls } from "../speech/VoiceControls";
import type { VoicePlayer } from "../speech/voicePlayer";
import type { ConversationController } from "./controller";
import { formatHearts, formatHeartsDelta, itemName, NpcProfileCard } from "./NpcProfileCard";
import type { SpeechInput, SpeechSession } from "./speechInput";
import "./conversation.css";

export interface ConversationPanelProps {
  controller: ConversationController;
  /** NPC voices and playback (tests replace them). */
  tts?: TtsSpeaker;
  voice?: VoicePlayer;
  /** Browser speech recognition for the optional mic button. */
  speech?: SpeechInput;
  /** Script font loader for the bubble (tests replace it). */
  loadFont?: (script: ScriptCode) => Promise<void>;
}

export { itemName };

export function npcNameKey(npcId: NpcId): MessageKey {
  return `npc.name.${npcId}` as MessageKey;
}

function findLast<T>(list: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i]!)) return list[i];
  return undefined;
}

/**
 * The conversation panel (build plan M23, GDD §6.2, §8.1). A non-modal dialog at the bottom of
 * the screen: the NPC's speech bubble (M19: word glosses, translation, script toggle) with its
 * voice (M22: replay, 0.75×), the full log, cards for what the server accepted (trades wait for
 * Buy / No), suggested replies by level with hover (and focus) translations, the reply box with
 * an optional mic, and the soft grammar chip before sending. The ♥ button in the header opens the
 * NPC profile card (build plan M24: hearts, friendship band, gifts).
 *
 * Keyboard: focus starts in the reply box; Enter sends; ↑ from an empty reply box goes to the
 * suggestions, where ← → ↑ ↓ move and Enter or Space picks; a new trade card takes focus (Enter
 * buys, Tab then Enter declines); Escape closes the grammar chip, otherwise says goodbye. Every
 * control is a real button or input, so Tab order and screen readers work as usual.
 */
export function ConversationPanel({ controller, tts, voice, speech, loadFont }: ConversationPanelProps) {
  const { t, locale } = useI18n();
  const store = controller.store;
  const state = useConversation((s) => s, store);
  const { phase, npcId, context } = state;
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [text, setText] = useState("");
  const [method, setMethod] = useState<InputMethod>("typed");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileId = useId();
  /** The suggestion text that was put into the box (starter / hint), to tell "suggested" from "typed". */
  const filledFrom = useRef<string | null>(null);

  const name = npcId ? t(npcNameKey(npcId)) : "";
  const language = context ? languageDisplayName(context.lang, locale, context.lang) : "";
  const canType = phase === "open" || phase === "thinking";

  // Focus the reply box when the player can talk, unless focus is already somewhere in the panel.
  useEffect(() => {
    if (!canType) return;
    const active = document.activeElement;
    if (!active || active === document.body || !panel.current?.contains(active)) input.current?.focus();
  }, [canType, phase]);

  const focusInput = () => void setTimeout(() => input.current?.focus(), 0);

  const fill = (value: string, from: string | null, how: InputMethod = "typed") => {
    setText(value);
    setMethod(how);
    filledFrom.current = from;
    controller.clearCheck();
    input.current?.focus();
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const how: InputMethod = filledFrom.current !== null && text.trim() === filledFrom.current.trim() ? "suggested" : method;
    const result = await controller.submit(text, how);
    if (result === "sent") {
      setText("");
      setMethod("typed");
      filledFrom.current = null;
    }
  };

  const pickSuggestion = (s: SuggestedReply) => {
    if (state.style === "replies") {
      void controller.submit(s.text, "suggested");
      focusInput();
    } else {
      // A starter fragment (B2) or the 💡 hint (C1+): the player finishes it in the box.
      fill(s.text, s.text, "typed");
    }
  };

  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (state.check.status === "suggest") {
      controller.clearCheck();
      input.current?.focus();
      return;
    }
    controller.end();
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" && text === "") {
      const first = panel.current?.querySelector<HTMLButtonElement>(".hv-suggestion > button");
      if (first) {
        e.preventDefault();
        e.stopPropagation();
        first.focus();
      }
    }
  };

  if (phase === "idle" || !npcId) return null;
  const npcLines = state.log.flatMap((e) => (e.kind === "npc" ? [e.line] : []));
  const newest = findLast(state.log, (e) => e.kind === "npc");
  const lastPlayer = findLast(state.log, (e) => e.kind === "player");
  // Build plan M29: the coffee's extra suggestion stays hidden until its button is pressed.
  const baseCount = context ? requestedSuggestions(context.effectiveLevel) : state.suggestions.length;
  const shownSuggestions = state.extraHint === "shown" ? state.suggestions : state.suggestions.slice(0, baseCount);
  const extraWaiting = state.extraHint === "available" && state.suggestions.length > baseCount;
  const showSuggestions = canType && shownSuggestions.length > 0 && (state.style !== "hint" || state.hintShown);

  return (
    <section ref={panel} className="hv-convo" role="dialog" aria-labelledby={titleId} onKeyDown={onPanelKeyDown}>
      <header className="hv-convo__header">
        <h2 id={titleId} className="hv-convo__title">
          {t("convo.title", { name })}
        </h2>
        {context ? (
          <button
            type="button"
            className="hv-convo__hearts"
            aria-expanded={profileOpen}
            aria-controls={profileId}
            aria-label={t("convo.profile.open", { name, hearts: formatHearts(context.hearts, locale) })}
            onClick={() => setProfileOpen((o) => !o)}
          >
            ♥ {formatHearts(context.hearts, locale)}
          </button>
        ) : null}
        {state.coins !== null ? <span className="hv-convo__coins">🪙 {t("convo.coins", { coins: String(state.coins) })}</span> : null}
        <button type="button" onClick={() => controller.end()} aria-keyshortcuts="Escape">
          {t(phase === "unavailable" || phase === "ended" ? "convo.close" : "convo.goodbye")} <kbd>Esc</kbd>
        </button>
      </header>

      {context && profileOpen ? (
        <div id={profileId}>
          <NpcProfileCard context={context} name={name} controller={controller} gifting={state.gifting} canGive={phase === "open" || phase === "thinking" || phase === "ended"} />
        </div>
      ) : null}

      {phase === "unavailable" ? (
        <p role="alert" className="hv-convo__note">
          {noticeText(t, state.notice, name, language)}
        </p>
      ) : null}

      {phase === "starting" ? (
        <p role="status" className="hv-convo__status">
          {t("convo.starting", { name })}
        </p>
      ) : null}

      {context && npcLines.length > 0 ? (
        <SpeechBubble
          lines={npcLines}
          lang={context.lang}
          nativeLang={context.nativeLang}
          source={`npc:${npcId}`}
          speaker={name}
          onTranslationShown={(line) => controller.noteTranslation(line.text ?? line.tokens.map((tok) => tok.surface).join(""))}
          {...(loadFont ? { loadFont } : {})}
          audio={
            newest && newest.kind === "npc" ? (
              <VoiceControls
                line={{ npcId, lang: context.lang, level: context.effectiveLevel, text: newest.line.text, ...(newest.line.ttsTags ? { ttsTags: newest.line.ttsTags } : {}), ...(newest.line.emotion ? { emotion: newest.line.emotion } : {}), ...(newest.seeded ? { seeded: true } : {}) }}
                {...(tts ? { tts } : {})}
                {...(voice ? { player: voice } : {})}
              />
            ) : undefined
          }
        />
      ) : null}

      {phase === "thinking" ? (
        <p role="status" className="hv-convo__status" lang={state.streaming.length ? context?.lang : undefined}>
          {state.streaming.length ? state.streaming.join(" ") : t("convo.thinking", { name })}
        </p>
      ) : null}

      {lastPlayer && lastPlayer.kind === "player" && lastPlayer.correction?.better ? (
        <p className="hv-convo__note">
          <span>{t("convo.correction", { name, better: lastPlayer.correction.better })}</span>
          {lastPlayer.correction.note ? <span lang={context?.nativeLang}>{lastPlayer.correction.note}</span> : null}
        </p>
      ) : null}

      {newest && newest.kind === "npc" && newest.teach ? (
        <p className="hv-convo__note">
          <span lang={context?.lang}>{t("convo.teach", { phrase: newest.teach.phrase })}</span>
          {newest.teach.meaning ? <span lang={context?.nativeLang}>({newest.teach.meaning})</span> : null}
          {canType ? (
            <button type="button" onClick={() => fill(newest.teach!.phrase, newest.teach!.phrase)}>
              {t("convo.teach.use")}
            </button>
          ) : null}
        </p>
      ) : null}

      {phase !== "unavailable" && state.notice ? (
        <p role="status" className="hv-convo__note">
          {noticeText(t, state.notice, name, language)}
        </p>
      ) : null}

      <Cards state={state} name={name} controller={controller} onDone={focusInput} />

      {state.log.length > 0 ? <ConversationLog log={state.log} name={name} lang={context?.lang} /> : null}

      {phase === "ended" ? (
        <p role="status" className="hv-convo__status">
          {t("convo.ended")}
        </p>
      ) : null}

      {canType ? (
        <>
          {state.style === "hint" && !state.hintShown && state.suggestions.length > 0 ? (
            <button type="button" style={{ justifySelf: "start" }} onClick={() => controller.revealHint()}>
              {t("convo.hint.show")}
            </button>
          ) : null}
          {extraWaiting && phase === "open" ? (
            <button type="button" style={{ justifySelf: "start" }} onClick={() => controller.revealExtraHint()}>
              {t("convo.hint.extra")}
            </button>
          ) : null}
          {showSuggestions ? (
            <Suggestions
              suggestions={shownSuggestions}
              label={t(state.style === "replies" ? "convo.suggestions" : "convo.starter")}
              lang={context?.lang}
              nativeLang={context?.nativeLang}
              disabled={phase !== "open"}
              onPick={pickSuggestion}
              onLeave={() => input.current?.focus()}
            />
          ) : null}
          <CheckChip state={state} controller={controller} onDone={() => (setText(""), setMethod("typed"), (filledFrom.current = null), focusInput())} />
          <form className="hv-convo__form" onSubmit={(e) => void submit(e)}>
            <input
              ref={input}
              aria-label={t("convo.input.label", { language })}
              placeholder={t("convo.input.placeholder", { language })}
              lang={context?.lang}
              value={text}
              maxLength={PLAYER_TEXT_MAX_LENGTH}
              autoComplete="off"
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value === "") setMethod("typed");
                controller.clearCheck();
              }}
              onKeyDown={onInputKeyDown}
            />
            {speech?.supported && context ? <MicButton speech={speech} lang={context.lang} onText={(heard) => fill(text ? `${text} ${heard}` : heard, null, "spoken")} /> : null}
            <button type="submit" disabled={phase !== "open" || state.check.status === "checking" || !text.trim()}>
              {t("convo.send")}
            </button>
          </form>
          {state.check.status === "checking" ? (
            <p role="status" className="hv-convo__status">
              {t("convo.checking")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function noticeText(t: ReturnType<typeof useI18n>["t"], notice: ConversationNotice | null, name: string, language: string): string {
  if (!notice) return "";
  switch (notice.kind) {
    case "offline":
      return t("convo.notice.offline");
    case "retry":
      return t("convo.notice.retry", { name });
    case "busy":
      return t("convo.notice.busy", { name });
    case "native":
      return t("convo.notice.native", { name, language });
    case "refused":
      if (notice.reason === "too_far") return t("convo.notice.tooFar", { name });
      if (notice.reason === "daily_limit" || notice.reason === "turn_limit") return t("convo.notice.limit", { name });
      if (notice.reason === "rate") return t("convo.notice.rate");
      return t("convo.notice.refused", { name });
  }
}

function Suggestions({
  suggestions,
  label,
  lang,
  nativeLang,
  disabled,
  onPick,
  onLeave,
}: {
  suggestions: readonly SuggestedReply[];
  label: string;
  lang: string | undefined;
  nativeLang: string | undefined;
  disabled: boolean;
  onPick: (s: SuggestedReply) => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const group = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const buttons = [...(group.current?.querySelectorAll<HTMLButtonElement>(".hv-suggestion > button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    // Arrow keys stay in the panel (they also walk the player otherwise).
    e.preventDefault();
    e.stopPropagation();
    const next = at + step;
    if (next >= buttons.length) onLeave();
    else buttons[Math.max(0, next)]!.focus();
  };
  return (
    <div ref={group} role="group" aria-label={label} aria-describedby={hintId} className="hv-convo__suggestions" onKeyDown={onKeyDown}>
      <span id={hintId} className="hv-visually-hidden">
        {t("convo.suggestions.hint")}
      </span>
      {suggestions.map((s, i) => (
        <Suggestion key={`${i}:${s.text}`} suggestion={s} lang={lang} nativeLang={nativeLang} disabled={disabled} onPick={() => onPick(s)} />
      ))}
    </div>
  );
}

function Suggestion({ suggestion, lang, nativeLang, disabled, onPick }: { suggestion: SuggestedReply; lang: string | undefined; nativeLang: string | undefined; disabled: boolean; onPick: () => void }) {
  const tipId = useId();
  const [tip, setTip] = useState(false);
  const hasTip = suggestion.translation !== "" || suggestion.reading !== undefined;
  return (
    <span className="hv-suggestion" onPointerEnter={() => setTip(true)} onPointerLeave={() => setTip(false)}>
      <button
        type="button"
        lang={lang}
        aria-disabled={disabled || undefined}
        aria-describedby={tip && hasTip ? tipId : undefined}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        onClick={() => {
          if (!disabled) onPick();
        }}
      >
        {suggestion.text}
      </button>
      {tip && hasTip ? (
        <span role="tooltip" id={tipId} className="hv-suggestion__tip">
          {suggestion.reading ? <span lang={lang ? `${lang.split("-")[0]}-Latn` : undefined}>{suggestion.reading} · </span> : null}
          <span lang={nativeLang}>{suggestion.translation}</span>
        </span>
      ) : null}
    </span>
  );
}

function CheckChip({ state, controller, onDone }: { state: ConversationState; controller: ConversationController; onDone: () => void }) {
  const { t } = useI18n();
  const use = useRef<HTMLButtonElement>(null);
  const check = state.check;
  const showing = check.status === "suggest";
  useEffect(() => {
    if (showing) use.current?.focus();
  }, [showing]);
  if (check.status !== "suggest") return null;
  return (
    <div role="alert" className="hv-convo__note">
      <span lang={state.context?.lang}>{t("convo.check.better", { better: check.better })}</span>
      {check.note ? <span lang={state.context?.nativeLang}>{check.note}</span> : null}
      <button ref={use} type="button" onClick={() => (controller.useBetter(), onDone())}>
        {t("convo.check.use")}
      </button>
      <button type="button" onClick={() => (controller.sendAnyway(), onDone())}>
        {t("convo.check.sendAnyway")}
      </button>
    </div>
  );
}

function Cards({ state, name, controller, onDone }: { state: ConversationState; name: string; controller: ConversationController; onDone: () => void }) {
  if (state.cards.length === 0) return null;
  return (
    <div className="hv-convo__cards">
      {state.cards.map((card) => (
        <CardView key={card.id} card={card} name={name} coins={state.coins} controller={controller} onDone={onDone} />
      ))}
    </div>
  );
}

function CardView({ card, name, coins, controller, onDone }: { card: Card; name: string; coins: number | null; controller: ConversationController; onDone: () => void }) {
  const { t, locale } = useI18n();
  const labels = useLabelMap(controller.store.getState().context?.lang ?? null);
  const accept = useRef<HTMLButtonElement>(null);
  const open = card.kind === "trade" && card.status === "open";
  // A new trade card takes focus, so a keyboard player can answer it at once.
  useEffect(() => {
    if (open) accept.current?.focus();
  }, [open]);
  if (card.kind === "gift") return <p className="hv-card">🎁 {t("convo.card.gift", { name, item: itemName(card.itemId, labels) })}</p>;
  if (card.kind === "quest") {
    // Build plan M30: the request's own card (with its notice) is in the quest log; here just its name.
    const template = parseQuestId(card.questId)?.templateId ?? card.questId;
    return <p className="hv-card">📜 {t("convo.card.quest", { name, quest: itemName(template, labels) })}</p>;
  }
  if (card.kind === "recipe") {
    // Build plan M29: the recipe card itself, written in the target language.
    const lang = controller.store.getState().context?.lang;
    return (
      <div className="hv-card">
        <p>📖 {t("convo.card.recipe", { name, recipe: itemName(card.recipeId, labels) })}</p>
        {lang && isRecipeId(card.recipeId) ? <RecipeCard recipeId={card.recipeId} lang={lang} /> : null}
      </div>
    );
  }
  if (card.kind === "given") {
    return (
      <p className="hv-card" role="status">
        🎁 {t(`convo.gift.${card.reaction}` as MessageKey, { name, item: itemName(card.itemId, labels) })}
        {card.delta !== 0 ? ` ${formatHeartsDelta(card.delta, locale)} ♥` : ""}
      </p>
    );
  }
  if (card.kind === "returned") {
    return (
      <p className="hv-card" role="status">
        ✨ {t(card.delta > 0 ? "convo.return.done" : "convo.return.again", { name, item: itemName(card.itemId, labels) })}
        {card.delta !== 0 ? ` ${formatHeartsDelta(card.delta, locale)} ♥` : ""}
      </p>
    );
  }
  if (card.kind === "returnFailed") {
    return (
      <p className="hv-card" role="status">
        ✨ {t(`convo.return.failed.${card.reason}` as MessageKey, { name, item: itemName(card.itemId, labels) })}
      </p>
    );
  }
  if (card.kind === "giftFailed") {
    return (
      <p className="hv-card" role="status">
        🎁 {t(`convo.gift.failed.${card.reason}` as MessageKey, { name, item: itemName(card.itemId, labels) })}
      </p>
    );
  }
  const { trade } = card;
  const kind = trade.kind;
  const answer = async (yes: boolean) => {
    await controller.confirm(card.id, yes);
    onDone();
  };
  let status = "";
  if (card.status === "sending") status = t("convo.trade.sending");
  else if (card.status === "done") status = t(kind === "offer" ? "convo.trade.done.offer" : "convo.trade.done.buy", { coins: String(coins ?? "") });
  else if (card.status === "declined") status = t("convo.trade.declined");
  else if (card.status === "failed") {
    const key = `convo.trade.failed.${card.reason ?? ""}` as MessageKey;
    status = ["insufficient_coins", "not_owned", "inventory_full"].includes(card.reason ?? "") ? t(key) : t("convo.trade.failed");
  }
  const label = t(kind === "offer" ? "convo.trade.offer" : "convo.trade.buy", { name, item: itemName(trade.itemId, labels), qty: String(trade.qty) });
  return (
    <div className="hv-card" role="group" aria-label={label}>
      <span className="hv-card__text">
        {kind === "offer" ? "🛒" : "💰"} {label} · 🪙 {t("convo.trade.price", { price: String(trade.price) })}
      </span>
      {card.status === "open" ? (
        <>
          <button ref={accept} type="button" onClick={() => void answer(true)}>
            {t(kind === "offer" ? "convo.trade.accept.offer" : "convo.trade.accept.buy")}
          </button>
          <button type="button" onClick={() => void answer(false)}>
            {t("convo.trade.decline")}
          </button>
        </>
      ) : (
        <span role="status">{status}</span>
      )}
    </div>
  );
}

function ConversationLog({ log, name, lang }: { log: readonly LogEntry[]; name: string; lang: string | undefined }) {
  const { t } = useI18n();
  return (
    <details className="hv-convo__log">
      <summary>
        {t("convo.log")} ({log.length})
      </summary>
      <ol>
        {log.map((e) => (
          <li key={e.id}>
            <strong>{e.kind === "npc" ? name : t("convo.you")}:</strong>{" "}
            {e.kind === "npc" ? (
              <>
                <span lang={lang}>{e.line.text}</span>
                {e.line.translation ? <span style={{ opacity: 0.7 }}> — {e.line.translation}</span> : null}
              </>
            ) : (
              <span lang={e.native ? undefined : lang}>{e.text}</span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function MicButton({ speech, lang, onText }: { speech: SpeechInput; lang: string; onText: (text: string) => void }) {
  const { t } = useI18n();
  const [session, setSession] = useState<SpeechSession | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => session?.stop(), [session]);
  const toggle = () => {
    if (session) {
      session.stop();
      return;
    }
    setFailed(false);
    let heard = false;
    const started = speech.listen(
      lang,
      (text) => {
        heard = true;
        onText(text);
      },
      () => {
        setSession(null);
        if (!heard) setFailed(true);
      },
    );
    setSession(started);
    if (!started) setFailed(true);
  };
  return (
    <>
      <button type="button" className="hv-convo__mic" aria-pressed={session !== null} aria-label={t(session ? "convo.mic.stop" : "convo.mic.start")} title={t(session ? "convo.mic.stop" : "convo.mic.start")} onClick={toggle}>
        🎤
      </button>
      {session ? (
        <span role="status" className="hv-visually-hidden">
          {t("convo.mic.listening")}
        </span>
      ) : null}
      {failed ? (
        <span role="status" className="hv-convo__status">
          {t("convo.mic.failed")}
        </span>
      ) : null}
    </>
  );
}
