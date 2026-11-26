import { useEffect } from "react";
import type { NpcId, ScriptCode } from "@hellovalley/shared";
import type { TtsSpeaker } from "../../ai/tts";
import { useI18n } from "../../i18n/I18nProvider";
import { chat } from "../../net/chatSession";
import { visitSession } from "../../net/visitSession";
import { avatarStore } from "../../state/avatarStore";
import { useConversation } from "../../state/conversationStore";
import { notebookStore } from "../../state/notebookStore";
import { placementStore } from "../../state/placementStore";
import { useWorld, worldStore } from "../../state/worldStore";
import type { VoicePlayer } from "../speech/voicePlayer";
import { Toasts } from "../toast/Toasts";
import { conversation as gameConversation, type ConversationController } from "./controller";
import { ConversationPanel, npcNameKey } from "./ConversationPanel";
import { type SpeechInput, speechInput } from "./speechInput";
import "./conversation.css";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Another dialog (mirror, intercom, placement mode, chat input, notebook) has the keyboard. */
function otherDialogOpen(): boolean {
  return avatarStore.getState().mirrorOpen || visitSession.getState().intercomOpen || placementStore.getState().open || chat.store.getState().typing || notebookStore.getState().open;
}

export interface ConversationLayerProps {
  controller?: ConversationController;
  tts?: TtsSpeaker;
  voice?: VoicePlayer;
  speech?: SpeechInput;
  loadFont?: (script: ScriptCode) => Promise<void>;
}

/**
 * NPC conversations on screen (build plan M23, GDD §8.1 step 1): next to an NPC a "Talk to …"
 * button appears (click it, or press F, or click the NPC in the scene), and the conversation
 * panel opens. Escape outside a text box also says goodbye. The level toasts (build plan M24)
 * show here too: they arrive after a conversation ended.
 */
export function ConversationLayer({ controller = gameConversation, tts, voice, speech = speechInput(), loadFont }: ConversationLayerProps) {
  const { t } = useI18n();
  const nearby = useWorld((s) => s.nearby);
  const phase = useConversation((s) => s.phase, controller.store);
  const npcId: NpcId | null = nearby?.kind === "npc" ? (nearby.id.slice("npc:".length) as NpcId) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (e.code === "KeyF") {
        const near = worldStore.getState().nearby;
        if (near?.kind !== "npc" || controller.active || otherDialogOpen()) return;
        e.preventDefault();
        void controller.open(near.id.slice("npc:".length) as NpcId);
      } else if (e.code === "Escape" && controller.active) {
        e.preventDefault();
        controller.end();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);

  // Leaving the game screen ends the conversation.
  useEffect(() => () => controller.end(), [controller]);

  return (
    <>
      {npcId && phase === "idle" ? (
        <button type="button" className="hv-talk-hint" aria-keyshortcuts="F" onClick={() => void controller.open(npcId)}>
          💬 {t("convo.talkHint", { name: t(npcNameKey(npcId)) })} <kbd>F</kbd>
        </button>
      ) : null}
      <Toasts />
      <ConversationPanel controller={controller} {...(tts ? { tts } : {})} {...(voice ? { voice } : {})} speech={speech} {...(loadFont ? { loadFont } : {})} />
    </>
  );
}
