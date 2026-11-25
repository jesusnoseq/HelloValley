/**
 * Optional microphone input for the conversation panel (GDD §6.2: "optionally use the microphone
 * (browser speech recognition → text)"). Chrome exposes the Web Speech API as
 * `webkitSpeechRecognition`; where there is none the mic button is not shown. Speech goes to the
 * browser's recogniser, never to the game server. The transcript only fills the reply box: the
 * player still reads it and sends it (input method `spoken`).
 * TODO(M37): a setting to turn the mic button off; the recogniser's on-device mode when Chrome
 * ships it widely (`processLocally`).
 */

export interface SpeechSession {
  stop(): void;
}

export interface SpeechInput {
  readonly supported: boolean;
  /** Listens once in `lang`; `onText` gets the final transcript, `onEnd` always runs at the end. */
  listen(lang: string, onText: (text: string) => void, onEnd: (error?: string) => void): SpeechSession | null;
}

/** The part of the Web Speech API's SpeechRecognition used here (not in every TS DOM lib). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(scope: unknown): RecognitionCtor | null {
  const w = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

export function browserSpeechInput(scope: unknown = typeof window === "undefined" ? undefined : window): SpeechInput {
  const Ctor = recognitionCtor(scope);
  return {
    supported: Ctor !== null,
    listen(lang, onText, onEnd) {
      if (!Ctor) return null;
      let recognition: Recognition;
      try {
        recognition = new Ctor();
      } catch {
        return null;
      }
      let error: string | undefined;
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        const parts: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i]!;
          if (result.isFinal && result[0]) parts.push(result[0].transcript);
        }
        const text = parts.join(" ").trim();
        if (text) onText(text);
      };
      recognition.onerror = (event) => {
        error = event.error;
      };
      recognition.onend = () => onEnd(error);
      try {
        recognition.start();
      } catch {
        return null;
      }
      return { stop: () => recognition.stop() };
    },
  };
}

let shared: SpeechInput | null = null;
export function speechInput(): SpeechInput {
  shared ??= browserSpeechInput();
  return shared;
}
