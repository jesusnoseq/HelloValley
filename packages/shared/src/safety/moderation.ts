/**
 * The mandatory server-side text check for player chat and display names (GDD §9.3, build plan
 * M36, architecture §6.4). There is no model on the server, so this is a normalised blocklist plus
 * a few heuristics (links, e-mail addresses, phone numbers, reserved names). The sender's and the
 * reader's clients add their own on-device model checks on top (client `ai/moderation.ts`).
 *
 * Pure and headless: the game server calls it before broadcasting a chat line and in
 * `POST /api/onboarding`; tests run it directly.
 *
 * Normalisation (so the usual evasions still match): Unicode NFKC, lower case, diacritics removed,
 * leetspeak digits and symbols mapped to letters (`f4ck`, `$hit`), letter repeats allowed
 * (`fuuuck`), and runs of single characters joined back together (`f u c k`, `f.u.c.k`). Every
 * language's list is checked whatever language the sender claims (claims are untrusted).
 *
 * Matching: Latin and Cyrillic terms match whole words (or word starts for `stem` terms), so
 * "class" and "Scunthorpe" are fine; scripts written without spaces (Japanese, Chinese, Korean
 * and Arabic phrases) match as substrings. Names match every term of 4+ letters as a substring
 * too for stem terms (`xXfuckXx`), because names have no spaces.
 *
 * The lists are a seed, deliberately short and limited to unambiguous words (see pending.md M36).
 */

export type BlocklistCategory = "profanity" | "sexual" | "slur" | "harassment" | "link" | "personal_data" | "reserved" | "spam";

export type TextVerdict = { ok: true } | { ok: false; category: BlocklistCategory; /** Strike weight toward a shard-wide mute (0: blocked, no strike). */ strikes: number };

/** How many strikes each category is worth (my numbers): hate and threats count double. */
export const CATEGORY_STRIKES: Record<BlocklistCategory, number> = {
  profanity: 1,
  sexual: 2,
  slur: 2,
  harassment: 2,
  link: 1,
  // Sharing one's own phone number or e-mail is blocked to protect the sender, not punished.
  personal_data: 0,
  reserved: 0,
  spam: 1,
};

interface Term {
  /** The word as written (normalised at load). */
  text: string;
  category: BlocklistCategory;
  /** Also matches words that start with it (`fuck` → `fucking`). */
  stem?: boolean;
}

const t = (category: BlocklistCategory, words: string, stem = false): Term[] =>
  words
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)
    .map((text) => ({ text, category, stem }));

/** Word lists per language (Latin and Cyrillic: whole words). */
export const BLOCKLIST: Readonly<Record<string, readonly Term[]>> = {
  en: [
    ...t("profanity", "fuck,shit,bitch,cunt,asshole,motherfucker,bastard,dickhead,wanker,bollocks", true),
    ...t("profanity", "fck,fuk,stfu"),
    ...t("sexual", "porn,blowjob,dildo,nudes,penis,vagina,horny,boobs", true),
    ...t("sexual", "sex,sexy,pussy,cock,cocks,cum,tits,rape,raped,rapist"),
    ...t("slur", "nigger,nigga,faggot,retard,tranny", true),
    ...t("slur", "fag,fags,chink,spic,kike,paki"),
    ...t("harassment", "kys"),
  ],
  es: [
    ...t("profanity", "puta,puto,mierda,joder,cabron,cabrona,gilipollas,pendejo,pendeja,chinga,verga,culero", true),
    ...t("sexual", "follar,polla,chupamela,porno", true),
    ...t("slur", "maricon,sudaca,subnormal", true),
  ],
  fr: [
    ...t("profanity", "merde,putain,salope,connard,connasse,enculé,encule,niquer,nique", true),
    ...t("slur", "bougnoule", true),
    ...t("slur", "pédé,pédés"),
  ],
  de: [
    ...t("profanity", "scheisse,scheiße,arschloch,fotze,wichser,hurensohn", true),
    ...t("profanity", "fick,ficken,fickt,gefickt"),
    ...t("slur", "schwuchtel", true),
  ],
  it: [
    ...t("profanity", "cazzo,stronzo,stronza,vaffanculo,puttana,minchia,coglione", true),
    ...t("slur", "frocio", true),
  ],
  pt: [
    ...t("profanity", "caralho,porra,foda,fodase,merda,buceta,viado,arrombado", true),
  ],
  ru: [
    ...t("profanity", "блять,бля,сука,хуй,хуе,пизд,ебать,ебан,мудак,долбоеб", true),
    ...t("slur", "пидор,пидар", true),
  ],
};

/** Phrases and words of scripts without spaces: matched as substrings of the squashed text. */
export const SUBSTRING_BLOCKLIST: Readonly<Record<string, readonly Term[]>> = {
  ja: [...t("profanity", "くそったれ,ちくしょう,きさま"), ...t("sexual", "ちんこ,まんこ,セックス"), ...t("harassment", "死ね,しね,殺す")],
  zh: [...t("profanity", "操你妈,他妈的,傻逼,煞笔,妈的,草泥马,王八蛋"), ...t("sexual", "做爱,鸡巴")],
  ko: [...t("profanity", "씨발,시발,병신,개새끼,좆같"), ...t("sexual", "보지,자지")],
  ar: [...t("profanity", "كس امك,شرموطة,منيوك,يلعن"), ...t("sexual", "سكس")],
  // Multi-word threats in any language with spaces (matched on the space-joined words).
  any: [...t("harassment", "kill yourself,go die,kill urself,i will kill you,matate,suicidate,crève")],
};

/** Names nobody may take (impersonating staff or the game). Substring match on the squashed name. */
export const RESERVED_NAME_PARTS = ["admin", "moderator", "hellovalley", "official", "staff", "support", "system", "gamemaster"] as const;
/** Whole names that are reserved. */
export const RESERVED_NAMES = ["mod", "gm", "owner", "server", "anthropic", "google", "firebase"] as const;

/** Leetspeak and look-alike symbols (applied after lower-casing). */
const LEET: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "!": "i", "|": "l", "€": "e" };

const ch = (code: number) => String.fromCharCode(code);
/** Latin, Greek and Cyrillic letters (the scripts whose diacritics are stripped). */
const MARKED_LETTERS = new RegExp(`[${ch(0xc0)}-${ch(0x24f)}${ch(0x1e00)}-${ch(0x1eff)}${ch(0x370)}-${ch(0x3ff)}${ch(0x400)}-${ch(0x4ff)}]`, "g");
/** Zero-width characters and the Arabic tatweel, used to split words invisibly. */
const INVISIBLE = new RegExp(`[${[0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff, 0x640].map(ch).join("")}]`, "g");

/** Removes diacritics but keeps the base letters of every script; Hangul and kana stay composed. */
function stripMarks(s: string): string {
  // Decompose only Latin/Greek/Cyrillic letters: NFD on kana or Hangul would split them apart.
  return s.replace(MARKED_LETTERS, (c) => c.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC"));
}

/** NFKC, lower case, no diacritics, no zero-width characters, no tatweel. */
export function normalizeForModeration(text: string): string {
  return stripMarks(text.normalize("NFKC").toLowerCase().replace(INVISIBLE, ""));
}

function deLeet(s: string): string {
  let out = "";
  for (const c of s) out += LEET[c] ?? c;
  return out;
}

/** The words of a text after normalisation, with runs of single letters joined (`f u c k` → `fuck`). */
export function moderationTokens(text: string): string[] {
  const words = deLeet(normalizeForModeration(text))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run.length >= 3) out.push(run);
    else if (run) out.push(...run);
    run = "";
  };
  for (const w of words) {
    if ([...w].length === 1) run += w;
    else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `fuck` → /^f+u+c+k+/: every letter may repeat. */
function termPattern(term: string, anchoredEnd: boolean, anchoredStart = true): RegExp {
  const chars = [...deLeet(normalizeForModeration(term))].filter((c) => /[\p{L}\p{N}]/u.test(c));
  return new RegExp(`${anchoredStart ? "^" : ""}${chars.map((c) => `${escapeRe(c)}+`).join("")}${anchoredEnd ? "$" : ""}`, "u");
}

interface CompiledTerm {
  category: BlocklistCategory;
  word: RegExp;
  /** Inside a name (4+ letters only). */
  inName: RegExp | null;
}

const COMPILED_WORDS: CompiledTerm[] = Object.values(BLOCKLIST)
  .flat()
  .map((term) => ({
    category: term.category,
    word: termPattern(term.text, !term.stem),
    // Names have no spaces, so stems of 4+ letters also match inside them (not short or whole-word terms: "Peacock").
    inName: term.stem && [...term.text].length >= 4 ? termPattern(term.text, false, false) : null,
  }));

const COMPILED_SUBSTRINGS = Object.values(SUBSTRING_BLOCKLIST)
  .flat()
  .map((term) => ({ category: term.category, text: normalizeForModeration(term.text), spaced: term.text.includes(" ") }));

const URL_RE = /(?:https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|net|org|io|gg|xyz|ru|me|ly|co|tv|app|dev|link|info|biz|site|shop|top)\b|discord\s?\.?\s?gg)/iu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+\s?(?:@|\(at\)|\[at\])\s?[\p{L}\p{N}.-]+\.[a-z]{2,}/iu;
/** Eight or more digits in a row, allowing spaces, dots, dashes and a leading +. */
const PHONE_RE = /(?:\+|\b)(?:\d[\s.\-()]?){8,}\d?/u;

/** Each category is checked in this order; the first hit names the verdict. */
const ORDER: BlocklistCategory[] = ["slur", "harassment", "sexual", "profanity"];

function blocked(category: BlocklistCategory): TextVerdict {
  return { ok: false, category, strikes: CATEGORY_STRIKES[category] };
}

function firstHit(hits: BlocklistCategory[]): BlocklistCategory | null {
  for (const c of ORDER) if (hits.includes(c)) return c;
  return hits[0] ?? null;
}

/** Blocklisted words and phrases in a text (the categories hit). */
function blocklistHits(text: string, asName: boolean): BlocklistCategory[] {
  const tokens = moderationTokens(text);
  const hits: BlocklistCategory[] = [];
  const squashed = tokens.join("");
  const spaced = ` ${tokens.join(" ")} `;
  for (const term of COMPILED_WORDS) {
    if (tokens.some((tok) => term.word.test(tok)) || (asName && term.inName?.test(squashed))) hits.push(term.category);
  }
  const plain = normalizeForModeration(text).replace(/\s+/g, " ");
  for (const term of COMPILED_SUBSTRINGS) {
    const hay = term.spaced ? spaced : squashed;
    if (hay.includes(term.text) || plain.includes(term.text)) hits.push(term.category);
  }
  return hits;
}

/** Most times one character may repeat in a row before a line counts as spam (my number). */
export const SPAM_REPEAT_MAX = 12;

/**
 * The server's check of one chat line. `ok: false` means the line is not broadcast; `strikes`
 * counts toward a shard-wide mute (safety/strikes.ts).
 */
export function moderateChatText(text: string): TextVerdict {
  const hit = firstHit(blocklistHits(text, false));
  if (hit) return blocked(hit);
  const plain = normalizeForModeration(text);
  if (EMAIL_RE.test(plain)) return blocked("personal_data");
  if (URL_RE.test(plain)) return blocked("link");
  if (PHONE_RE.test(plain)) return blocked("personal_data");
  if (new RegExp(`(.)\\1{${SPAM_REPEAT_MAX},}`, "u").test(plain)) return blocked("spam");
  return { ok: true };
}

/** The server's check of a display name (onboarding and renames). */
export function moderateNameText(name: string): TextVerdict {
  const hit = firstHit(blocklistHits(name, true));
  if (hit) return blocked(hit);
  const squashed = moderationTokens(name).join("");
  if ((RESERVED_NAMES as readonly string[]).includes(squashed) || RESERVED_NAME_PARTS.some((p) => squashed.includes(p))) return blocked("reserved");
  const plain = normalizeForModeration(name);
  if (URL_RE.test(plain) || EMAIL_RE.test(plain)) return blocked("link");
  if (/\d{6,}/u.test(plain.replace(/[\s.-]/g, ""))) return blocked("personal_data");
  return { ok: true };
}
