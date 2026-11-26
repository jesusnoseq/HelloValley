import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, type Group, type Sprite } from "three";
import {
  activityClip,
  AnimationStateMachine,
  type AvatarAppearance,
  AvatarAppearanceSchema,
  type CharacterManifest,
  type ClipTimings,
  isPrivateSpace,
} from "@hellovalley/shared";
import { characterAssetsWith } from "../characters/assetCache";
import { assembleAvatar, tintAvatar } from "../characters/avatarLook";
import type { Character } from "../characters/characterGlb";
import { PLACEHOLDER_APPEARANCE } from "../characters/placeholderLook";
import { useApartmentSession } from "../net/apartmentSession";
import { INTERP_DELAY_MS } from "../net/interpolation";
import { type RemotePlayerInfo, townLive, useTownSession } from "../net/townSession";
import { useWorld } from "../state/worldStore";
import { CHAT_BUBBLE_GAP_M } from "../ui/chat/chatView";
import { ChatBubble } from "./ChatBubble";
import { ChattingIndicator } from "./ChattingIndicator";
import { createNameTag, disposeNameTag, NAME_TAG } from "./nameTag";

function clipTimings(manifest: CharacterManifest): ClipTimings {
  return Object.fromEntries(manifest.animations.map((a) => [a.name, { duration: a.duration, loop: a.loop }]));
}

/** The room's appearance JSON, validated; the placeholder look when it is malformed. */
export function parseRemoteAppearance(json: string): AvatarAppearance {
  try {
    const parsed = AvatarAppearanceSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : PLACEHOLDER_APPEARANCE;
  } catch {
    return PLACEHOLDER_APPEARANCE;
  }
}

/**
 * The other players in the local player's space (build plan M16): one avatar each, built from
 * the appearance in the room state, with a name tag. In an apartment (a private space) only the
 * people in that same apartment show: the ApartmentRoom lists their TownRoom sessions (M17).
 * TODO(M37): distance culling / LOD when a full 40-player shard crowds one place (each avatar is
 * ~9 meshes plus its shadow).
 */
export function RemotePlayers() {
  const remotes = useTownSession((s) => s.remotes);
  const space = useWorld((s) => s.space);
  const occupants = useApartmentSession((s) => s.occupants);
  const privateSpace = isPrivateSpace(space);
  return (
    <>
      {Object.values(remotes)
        .filter((r) => r.space === space && (!privateSpace || occupants.includes(r.sessionId)))
        .map((r) => (
          <RemoteAvatar key={r.sessionId} info={r} />
        ))}
    </>
  );
}

/**
 * One remote avatar: drawn INTERP_DELAY_MS in the past between the room's snapshots
 * (net/interpolation.ts), with its own AnimationStateMachine fed by the synced motion and the
 * emotes the server relays. While they talk to an NPC (the synced `talkingTo`, build plan M23)
 * they play the talk clip and show the "chatting" indicator.
 */
function RemoteAvatar({ info }: { info: RemotePlayerInfo }) {
  const group = useRef<Group>(null);
  const machine = useRef<AnimationStateMachine | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [tagY, setTagY] = useState(1.6);
  const look = useMemo(() => parseRemoteAppearance(info.appearance), [info.appearance]);
  const lookRef = useRef(look);
  const talkingRef = useRef(info.talkingTo !== "");
  const activityRef = useRef(activityClip(info.activity));
  const animal = look.animal;

  // Before the build effect below, so a new character starts with the newest look.
  useEffect(() => {
    lookRef.current = look;
  }, [look]);
  useEffect(() => {
    talkingRef.current = info.talkingTo !== "";
  }, [info.talkingTo]);
  useEffect(() => {
    activityRef.current = activityClip(info.activity);
  }, [info.activity]);

  useEffect(() => {
    let cancelled = false;
    let built: Character | null = null;
    characterAssetsWith([animal])
      .then((assets) => {
        if (cancelled) return;
        built = assembleAvatar(assets, lookRef.current);
        built.root.traverse((n) => {
          n.castShadow = true;
        });
        setTagY(new Box3().setFromObject(built.root).max.y + NAME_TAG.gapM + (NAME_TAG.heightPx * NAME_TAG.metresPerPx) / 2);
        machine.current ??= new AnimationStateMachine(clipTimings(assets.manifest));
        built.play(machine.current.clip, 0);
        setCharacter(built);
      })
      .catch((error: unknown) => console.error("remote avatar:", error));
    return () => {
      cancelled = true;
      if (built) {
        built.mixer.stopAllAction();
        // The tint materials are per-character copies (the geometry is shared with the cache).
        for (const materials of built.tints.values()) for (const m of materials) m.dispose();
      }
      setCharacter(null);
    };
  }, [animal]);

  useEffect(() => {
    if (character) tintAvatar(character, look);
  }, [character, look]);

  const tag = useMemo<Sprite>(() => createNameTag(info.name), [info.name]);
  useEffect(() => () => disposeNameTag(tag), [tag]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    const sample = townLive.tracks.get(info.sessionId)?.sampleAt(performance.now() - INTERP_DELAY_MS);
    if (!g || !sample) return;
    // Mid-door the snapshot can still be in the previous space.
    g.visible = sample.space === info.space;
    g.position.set(sample.x, 0, sample.z);
    g.rotation.y = sample.heading;
    const m = machine.current;
    if (m) {
      for (const emote of townLive.takeEmotes(info.sessionId)) m.playEmote(emote);
      // Talking to an NPC (build plan M23): the talk clip while standing.
      // Fishing (build plan M27): the cast and reel clips while standing.
      const change = m.update({ motion: sample.motion, talking: talkingRef.current, activity: activityRef.current }, dt);
      if (change && character) character.play(change.clip, change.fade, change.restart);
    }
    character?.mixer.update(dt);
  });

  return (
    <group ref={group} name={`remote-${info.sessionId}`} visible={false}>
      {character ? <primitive object={character.root} /> : null}
      <primitive object={tag} position={[0, tagY, 0]} />
      <ChatBubble sessionId={info.sessionId} y={tagY + CHAT_BUBBLE_GAP_M} />
      {info.talkingTo ? <ChattingIndicator y={tagY + 0.35} /> : null}
    </group>
  );
}
