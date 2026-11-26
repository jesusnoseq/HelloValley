import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey, Translate } from "../i18n/i18n";
import { en } from "../i18n/messages.en";
import { ariaKey, type GameAction, keyLabel } from "../input/keymap";
import { useSettings } from "./settingsStore";

/** A key's name in the UI language ("Space" → "Espacio"); letters and symbols stay as they are. */
export function keyName(t: Translate, code: string): string {
  const label = keyLabel(code);
  const key = `key.${label}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : label;
}

/** The current key of a game action, named for hints ("Pick up (F)"), and its aria-keyshortcuts. */
export function useActionKey(action: GameAction): { name: string; aria: string } {
  const { t } = useI18n();
  const code = useSettings((s) => s.settings.keymap[action]);
  return { name: keyName(t, code), aria: ariaKey(code) };
}
