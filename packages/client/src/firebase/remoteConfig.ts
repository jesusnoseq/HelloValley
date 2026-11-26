import type { FirebaseApp } from "firebase/app";
import { PROMPT_TEMPLATE_IDS, type PromptTemplateName, resolveTemplateId, TEMPLATE_ID_PARAMS } from "@hellovalley/shared";

/**
 * The active server prompt template ids (build plan M38, architecture §3.2): Remote Config
 * parameters `npc_turn_template_id` and `npc_opener_template_id` (repo `remoteconfig.template.json`),
 * so a new prompt version can be switched on in the console without shipping a client. Until the
 * fetch lands, or when it fails, offline or on the `demo-*` emulator project (no Remote Config),
 * the ids bundled in `PROMPT_TEMPLATE_IDS` are used. Values are validated per template
 * (`resolveTemplateId`), so a console typo falls back instead of breaking every NPC turn.
 */
export interface TemplateIds {
  get(name: PromptTemplateName): string;
  /** Settles once the remote values are in (or the fetch gave up). Never rejects. */
  readonly ready: Promise<void>;
}

/** Reads the raw parameter values (null for a parameter the remote template lacks). */
export type TemplateIdLoader = (params: readonly string[]) => Promise<Record<string, string | null>>;

export function createTemplateIds(load: TemplateIdLoader | null, warn: (message: string, error: unknown) => void = (m, e) => console.warn(m, e)): TemplateIds {
  const values: Partial<Record<PromptTemplateName, string>> = {};
  const names = Object.keys(PROMPT_TEMPLATE_IDS) as PromptTemplateName[];
  const ready = load
    ? load(names.map((n) => TEMPLATE_ID_PARAMS[n])).then(
        (raw) => {
          for (const name of names) values[name] = resolveTemplateId(name, raw[TEMPLATE_ID_PARAMS[name]]);
        },
        (err: unknown) => warn("[remote-config] template ids not fetched; using the bundled ones", err),
      )
    : Promise.resolve();
  return { get: (name) => values[name] ?? PROMPT_TEMPLATE_IDS[name], ready };
}

/** Remote Config refresh: at most every 12 h in production (the SDK default), 1 min in development. */
const FETCH_INTERVAL_MS = import.meta.env.DEV ? 60_000 : 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

/** The Firebase Remote Config loader (only in the lazy AI chunk, so the SDK stays off the first screen). */
export function remoteConfigLoader(app: FirebaseApp): TemplateIdLoader {
  return async (params) => {
    const { ensureInitialized, fetchAndActivate, getRemoteConfig, getValue, isSupported } = await import("firebase/remote-config");
    if (!(await isSupported())) return {};
    const rc = getRemoteConfig(app);
    rc.settings = { minimumFetchIntervalMillis: FETCH_INTERVAL_MS, fetchTimeoutMillis: FETCH_TIMEOUT_MS };
    rc.defaultConfig = Object.fromEntries(Object.entries(TEMPLATE_ID_PARAMS).map(([name, param]) => [param, PROMPT_TEMPLATE_IDS[name as PromptTemplateName]]));
    // Offline or throttled: keep the values activated in an earlier session (the SDK's IndexedDB).
    await fetchAndActivate(rc).catch(() => ensureInitialized(rc));
    return Object.fromEntries(params.map((p) => {
      const value = getValue(rc, p);
      return [p, value.getSource() === "remote" ? value.asString() : null];
    }));
  };
}
