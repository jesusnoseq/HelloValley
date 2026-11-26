import { isNpcId, labelEnglish } from "@hellovalley/shared";
import type { MessageKey } from "../../i18n/messages.en";

/** Where a word was saved from, for the UI: "From the Baker", "From an object: bench", "From chat". */
export function sourceName(source: string, t: (key: MessageKey, params?: Record<string, string>) => string): string {
  const npc = /^npc:(.+)$/.exec(source)?.[1];
  if (npc && isNpcId(npc)) return t("notebook.source.npc", { name: t(`npc.name.${npc}` as MessageKey) });
  const object = /^object:(.+)$/.exec(source)?.[1];
  if (object) return t("notebook.source.object", { object: labelEnglish(object) });
  return t("notebook.source.chat");
}
