import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { LabelLoad, LabelMap, LabelText } from "./labelSource";

/**
 * World labels on screen (build plan M25): the loaded labels per target language. Loading goes
 * through the lazy AI runtime (`ai/client.ts` → `labels()`), so this store stays in the entry
 * chunk without zod or Firebase.
 */
export interface LabelState {
  byLang: Readonly<Record<string, LabelMap>>;
  status: Readonly<Record<string, "loading" | "partial" | "ready">>;
}

export const labelStore = createStore<LabelState>()(() => ({ byLang: {}, status: {} }));

type Loader = (lang: string) => Promise<LabelLoad>;
let loader: Loader = (lang) => import("../ai/client").then((m) => m.loadWorldLabels(lang));

/** Tests replace the loader. */
export function setLabelLoader(next: Loader): void {
  loader = next;
}

/** Loads a language's labels unless they are loaded or loading. */
export function requestLabels(lang: string): void {
  const status = labelStore.getState().status[lang];
  if (status === "ready" || status === "loading") return;
  labelStore.setState((s) => ({ status: { ...s.status, [lang]: "loading" } }));
  loader(lang)
    .then((load) =>
      labelStore.setState((s) => ({
        byLang: { ...s.byLang, [lang]: load.labels },
        status: { ...s.status, [lang]: load.complete ? "ready" : "partial" },
      })),
    )
    .catch(() => labelStore.setState((s) => ({ status: { ...s.status, [lang]: "partial" } })));
}

export function labelText(lang: string, key: string): LabelText | null {
  return labelStore.getState().byLang[lang]?.[key] ?? null;
}

/** A label in the target language (null while loading or when none could be made). */
export function useLabel(lang: string | null, key: string | null): LabelText | null {
  useEffect(() => {
    if (lang) requestLabels(lang);
  }, [lang]);
  return useStore(labelStore, (s) => (lang && key ? (s.byLang[lang]?.[key] ?? null) : null));
}

/** A language's loaded labels, without asking for them (the world scene loads them). */
export function useLabelMap(lang: string | null): LabelMap | null {
  return useStore(labelStore, (s) => (lang ? (s.byLang[lang] ?? null) : null));
}
