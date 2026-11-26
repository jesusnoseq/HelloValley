import { busGains } from "@hellovalley/shared";
import type { AudioSink } from "./engine";
import { volumeStore } from "./volumeStore";

/**
 * Voice lines through the mixer (build plan M35). The NPC voice player keeps its `<audio>` element
 * (M22: it keeps the pitch at 0.75×); once the audio system runs, that element is routed into the
 * mixer's voice bus (a MediaElementAudioSourceNode), so the Voices slider sets its level and the
 * music ducks while it talks. Before that (or without Web Audio) the slider sets the element's own
 * volume instead.
 */
export interface VoiceMixer {
  sink: AudioSink;
  onVoiceActive(active: boolean): void;
}

let mixer: VoiceMixer | null = null;
/** Elements routed into a mixer, and which one (a routed element can never leave its context). */
const routed = new WeakMap<HTMLMediaElement, AudioSink>();
const watched = new WeakSet<HTMLMediaElement>();
let current: HTMLMediaElement | null = null;

export function setVoiceMixer(next: VoiceMixer | null): void {
  mixer = next;
}

function applyVolume(el: HTMLMediaElement): void {
  el.volume = routed.has(el) ? 1 : busGains(volumeStore.getState().volumes).voice;
}

volumeStore.subscribe(() => {
  if (current) applyVolume(current);
});

/**
 * False for an element routed into a mixer that has since been stopped (sign-out): it would stay
 * silent, so the voice player makes a new one.
 */
export function voiceElementUsable(el: HTMLMediaElement): boolean {
  const to = routed.get(el);
  return !to || to === mixer?.sink;
}

/** Call before every play of a voice element. */
export function routeVoice(el: HTMLMediaElement): void {
  current = el;
  if (!routed.has(el) && mixer?.sink.running && mixer.sink.connectVoice(el)) routed.set(el, mixer.sink);
  if (!watched.has(el)) {
    watched.add(el);
    const set = (active: boolean) => () => mixer?.onVoiceActive(active);
    el.addEventListener("playing", set(true));
    el.addEventListener("pause", set(false));
    el.addEventListener("ended", set(false));
  }
  applyVolume(el);
}
