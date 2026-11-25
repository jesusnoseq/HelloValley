import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Type-only: importing values from shared here would pull zod into the entry chunk.
import type { AvatarAppearance, PlayerProfile } from "@hellovalley/shared";

/**
 * The local player's avatar (build plan M15): the signed-in profile (name tag, saved appearance),
 * the unsaved appearance the mirror is previewing on the avatar, and whether the mirror is open
 * (player input pauses while it is). The App fills `profile` from the ProfileGate; a saved mirror
 * edit replaces it with the server's answer.
 */
export interface AvatarState {
  profile: PlayerProfile | null;
  /** Shown instead of the profile's appearance while the mirror edits it. */
  preview: AvatarAppearance | null;
  mirrorOpen: boolean;
  setProfile: (profile: PlayerProfile | null) => void;
  setPreview: (preview: AvatarAppearance | null) => void;
  openMirror: () => void;
  /** Closes the mirror and drops any unsaved preview. */
  closeMirror: () => void;
}

export function createAvatarStore() {
  return createStore<AvatarState>()((set) => ({
    profile: null,
    preview: null,
    mirrorOpen: false,
    setProfile: (profile) => set({ profile }),
    setPreview: (preview) => set({ preview }),
    openMirror: () => set({ mirrorOpen: true }),
    closeMirror: () => set({ mirrorOpen: false, preview: null }),
  }));
}

export const avatarStore = createAvatarStore();

export function useAvatar<T>(selector: (state: AvatarState) => T): T {
  return useStore(avatarStore, selector);
}
