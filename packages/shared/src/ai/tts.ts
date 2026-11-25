import { getNpc } from "../data/npcs";
import { isLevel, levelToStep, type Level } from "../data/difficulty";
import type { NpcEmotion } from "../npc/reply";
import { contentKeyMaterial } from "./cacheKey";
import { MODEL_IDS } from "./models";

/**
 * TTS request building (build plan M22, architecture §5.4, npc-runtime.md §10, NPC doc § Voice).
 * The client calls Gemini TTS through Firebase AI Logic; this module holds the pure parts: the
 * NPC → prebuilt voice and style mapping, the A1–A2 pace hint, the transcript with inline tags,
 * and the cache key that both the client and the admin seeding tool hash.
 */

/** Gemini TTS output: raw 16-bit little-endian mono PCM at 24 kHz (architecture §5.1). */
export const TTS_SAMPLE_RATE = 24_000;
/** The 🐢 button replays at this rate on the client, with no new generation (architecture §5.4). */
export const TTS_SLOW_RATE = 0.75;
/** Longest transcript sent to TTS (characters, my number; NPC lines are short). */
export const TTS_MAX_TRANSCRIPT = 800;
/** At most this many inline tags per line; more and the plain text is spoken (my number). */
export const TTS_MAX_TAGS = 8;

/** Levels that get the slower delivery (npc-runtime.md §10: "A1–A2"). */
export function isSlowPaceLevel(level: Level): boolean {
  return levelToStep(level) <= levelToStep("A2+");
}

/** npc-runtime.md §10 `{{level_pace_hint}}`. The voice and personality stay the same at every level. */
export const TTS_PACE_HINT = " Speak a little slower than usual with very clear enunciation, keeping the same personality.";

/** How a non-neutral `emotion` colours the style ("…, right now whispering conspiratorially"). */
export const TTS_EMOTION_STYLE: Record<NpcEmotion, string> = {
  neutral: "",
  happy: "sounding happy",
  excited: "excited and animated",
  sad: "a little sad",
  annoyed: "mildly annoyed",
  whisper: "whispering conspiratorially",
  tired: "sounding tired",
  proud: "proud of yourself",
  nostalgic: "wistful and nostalgic",
};

/**
 * The `speechMetadata.style` for a line: the NPC's sustained delivery from the NPC doc, the
 * emotion when it is not neutral, and the pace hint for A1–A2.
 */
export function ttsStyle(npcId: string, level: Level, emotion?: NpcEmotion): string {
  const npc = getNpc(npcId);
  if (!npc) throw new Error(`unknown npc ${npcId}`);
  let style = npc.voice.style;
  const mood = emotion ? TTS_EMOTION_STYLE[emotion] : "";
  if (mood) style = `${style.replace(/[.\s]+$/, "")}, right now ${mood}.`;
  return isSlowPaceLevel(level) ? `${style}${TTS_PACE_HINT}` : style;
}

/**
 * The NPC doc's inline tags in the form Gemini 3.x TTS models read (square-bracket audio tags,
 * in English whatever the line's language). Unknown angle-bracket tags are dropped.
 */
export const TTS_TAG_MAP: Record<string, string> = {
  "<laugh>": "[laughs]",
  "<sigh>": "[sighs]",
  "<cough>": "[coughs]",
  "<breath>": "[breathes in]",
  "<short pause>": "[short pause]",
};

const ANGLE_TAG = /<[^<>]{1,30}>/g;
const SQUARE_TAG = /\[[^[\]]{0,40}\]/g;
/** A square-bracket audio tag the transcript may keep: short English words. */
const AUDIO_TAG = /^\[[a-z][a-z' -]{0,29}\]$/i;

/** The text with every inline tag removed (what a reader sees). */
export function stripTtsTags(text: string): string {
  return text.replace(ANGLE_TAG, " ").replace(SQUARE_TAG, " ").replace(/\s+/g, " ").trim();
}

const comparable = (s: string) => stripTtsTags(s).normalize("NFC").replace(/[\s\u3000]+/g, "");

/**
 * The transcript sent to TTS (npc-runtime.md §10: `line.ttsTags || line.text`). Inline tags are
 * kept in it (converted to bracket tags); anything else in brackets is dropped. The tagged
 * version is used only when, without its tags, it says exactly what the bubble shows: a model
 * that rewrote the line in `ttsTags` must not make the audio differ from the text.
 */
export function ttsTranscript(text: string, ttsTags?: string): string {
  const plain = text.trim().slice(0, TTS_MAX_TRANSCRIPT);
  if (!ttsTags) return plain;
  let tags = 0;
  const tagged = ttsTags
    .replace(ANGLE_TAG, (tag) => {
      const mapped = TTS_TAG_MAP[tag.toLowerCase().replace(/\s+/g, " ")];
      if (mapped) tags++;
      return mapped ?? " ";
    })
    .replace(SQUARE_TAG, (tag) => {
      if (Object.values(TTS_TAG_MAP).includes(tag)) return tag;
      if (!AUDIO_TAG.test(tag)) return " ";
      tags++;
      return tag;
    })
    .replace(/[ \t]+/g, " ")
    .trim();
  if (tags > TTS_MAX_TAGS || tagged.length > TTS_MAX_TRANSCRIPT) return plain;
  return comparable(tagged) === comparable(plain) ? tagged : plain;
}

/** One NPC line to voice. `level` is the NPC's effective level for the player (`npc:context`). */
export interface TtsLine {
  npcId: string;
  /** The target language the line is in (TTS detects it; it only keys the cache). */
  lang: string;
  level: Level;
  /** The line as shown (`lines[].text`). */
  text: string;
  ttsTags?: string;
  emotion?: NpcEmotion;
}

/** Everything the client needs for one TTS call. */
export interface TtsRequest {
  model: string;
  /** Prebuilt voice (`speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`). */
  voiceName: string;
  /** Sustained delivery (`speechMetadata.style` on the text part). */
  style: string;
  /** What is spoken, inline tags included. */
  transcript: string;
  /** Cache key material for `sha256` (see `ttsKeyMaterial`). */
  keyMaterial: string;
}

/**
 * The cache key material: `sha256(npcId, lang, level, text)` (architecture §5.4), with the voice
 * in the kind so a voice swap does not reuse old clips. The shown text is keyed, not the tagged
 * transcript, so the same line hits the cache whatever tags the model added.
 */
export function ttsKeyMaterial(line: Pick<TtsLine, "npcId" | "lang" | "level" | "text">): string {
  const npc = getNpc(line.npcId);
  if (!npc) throw new Error(`unknown npc ${line.npcId}`);
  return contentKeyMaterial({ kind: `tts:${npc.voice.prebuiltVoice}`, npcId: line.npcId, lang: line.lang, level: line.level, text: line.text });
}

/** The request for a line, or `null` when it cannot be voiced (unknown NPC or level, empty text). */
export function buildTtsRequest(line: TtsLine): TtsRequest | null {
  const npc = getNpc(line.npcId);
  if (!npc || !isLevel(line.level) || !line.text.trim()) return null;
  return {
    model: MODEL_IDS.tts,
    voiceName: npc.voice.prebuiltVoice,
    style: ttsStyle(line.npcId, line.level, line.emotion),
    transcript: ttsTranscript(line.text, line.ttsTags),
    keyMaterial: ttsKeyMaterial(line),
  };
}

/** Storage path of a seeded clip (`tts/{hash}.ogg`, architecture §8.2, `storage.rules`). */
export function ttsStoragePath(hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("tts hash must be 64 hex characters");
  return `tts/${hash}.ogg`;
}
