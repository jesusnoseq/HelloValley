import { useEffect } from "react";
import type { NpcId } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { type Toast, TOAST_MS, type ToastStore, toastStore, useToasts } from "../../state/toastStore";
import "./toast.css";

/** Each NPC's sign-off emoji for the level toast (GDD §6.4: "The Baker thinks you're improving! 🥐"). */
export const NPC_TOAST_EMOJI: Readonly<Record<NpcId, string>> = {
  shopkeeper: "🛒",
  baker: "🥐",
  barista: "☕",
  farmer: "🥕",
  mayor: "🎩",
  librarian: "📚",
  doctor: "🩺",
  gossip: "💬",
  elder: "🎣",
};

function ToastItem({ toast, store }: { toast: Toast; store: ToastStore }) {
  const { t } = useI18n();
  useEffect(() => {
    const timer = setTimeout(() => store.dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [store, toast.id]);
  const name = t(`npc.name.${toast.npcId}` as MessageKey);
  const text = t(toast.direction > 0 ? "toast.level.up" : "toast.level.down", { name, emoji: NPC_TOAST_EMOJI[toast.npcId] });
  return (
    <li className="hv-toast">
      <span>{text}</span>
      <button type="button" aria-label={t("toast.dismiss")} onClick={() => store.dismiss(toast.id)}>
        ×
      </button>
    </li>
  );
}

/** Game notices, announced politely to screen readers and gone after a few seconds. */
export function Toasts({ store = toastStore }: { store?: ToastStore }) {
  const toasts = useToasts(store);
  return (
    <ul className="hv-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} store={store} />
      ))}
    </ul>
  );
}
