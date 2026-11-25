import { FONT_FILE_ORIGIN, googleFontsCssUrl, SCRIPT_FONTS, type ScriptCode } from "@hellovalley/shared";

/**
 * Loads a script's Noto family on demand (build plan M19): the first line shown in a script adds
 * its Google Fonts stylesheet to <head>; later lines reuse it. Text renders with the fallback
 * stack (shared/language/fonts.ts) until the font arrives (`display=swap`).
 */

const loaded = new Map<string, Promise<void>>();

function addLink(doc: Document, attrs: Record<string, string>): HTMLLinkElement {
  const link = doc.createElement("link");
  for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
  doc.head.appendChild(link);
  return link;
}

/** Resolves when the stylesheet has loaded (or failed: the fallback fonts are used then). */
export function ensureScriptFont(script: ScriptCode, doc: Document = document): Promise<void> {
  const { family } = SCRIPT_FONTS[script];
  const existing = loaded.get(family);
  if (existing) return existing;
  if (!doc.head.querySelector(`link[rel="preconnect"][href="${FONT_FILE_ORIGIN}"]`)) {
    addLink(doc, { rel: "preconnect", href: FONT_FILE_ORIGIN, crossorigin: "" });
  }
  const link = addLink(doc, { rel: "stylesheet", href: googleFontsCssUrl(family), "data-hv-font": family });
  const promise = new Promise<void>((resolve) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  });
  loaded.set(family, promise);
  return promise;
}

/** For tests: forget which families were loaded. */
export function resetFontLoader(): void {
  loaded.clear();
}
