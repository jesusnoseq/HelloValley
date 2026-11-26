import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, type Group, type Sprite } from "three";
import {
  type ActivityAnimState,
  AnimationStateMachine,
  type CharacterManifest,
  clockMinutesForPhase,
  type ClipTimings,
  ELDER_DOCK_FACING,
  elderAtDock,
  elderDockSpot,
  getNpc,
  headingTowards,
  type NpcPost,
  npcsInSpace,
  type SpaceId,
} from "@hellovalley/shared";
import { characterAssetsWith } from "../characters/assetCache";
import { assembleCharacter, type Character } from "../characters/characterGlb";
import { translate, uiLocaleFor } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages.en";
import { useTownSession } from "../net/townSession";
import { useAvatar } from "../state/avatarStore";
import { conversationStore, useConversation } from "../state/conversationStore";
import { dioramaStore } from "../state/dioramaStore";
import { useWorld } from "../state/worldStore";
import { cameraRig } from "./cameraRig";
import { ChattingIndicator } from "./ChattingIndicator";
import { createNameTag, disposeNameTag, NAME_TAG } from "./nameTag";
import { dampAngle } from "./playerMath";

/** How fast an NPC turns to the player it talks to (1/s). */
const TURN_RATE = 6;

function clipTimings(manifest: CharacterManifest): ClipTimings {
  return Object.fromEntries(manifest.animations.map((a) => [a.name, { duration: a.duration, loop: a.loop }]));
}

/**
 * The villagers in the space the player is in (build plan M23): each NPC stands at its post
 * (shared npcPosts.ts; TODO(M31): schedules and walking) in its outfit, with a name tag. When the
 * local player talks to one, the NPC turns to face them and plays the talk clip; when another
 * player does (the synced `talkingTo`), it plays the talk clip and shows the "chatting" indicator.
 * Clicking an NPC is picked in scene/Player.tsx (a shared ray test, like doors).
 */
export function Npcs() {
  const space = useWorld((s) => s.space);
  const posts = useMemo(() => npcsInSpace(space as SpaceId), [space]);
  const elderFishing = useElderOnDock();
  const dock = useMemo<NpcSpot>(() => ({ npcId: "elder", space: "town", pos: elderDockSpot(), facing: ELDER_DOCK_FACING, activity: "fish_cast" }), []);
  return (
    <>
      {posts.map((post) => (
        <Npc key={post.npcId} post={post} />
      ))}
      {space === "town" && elderFishing ? <Npc key="elder-dock" post={dock} /> : null}
    </>
  );
}

/** How often the dock check reads the clock (ms). */
const DOCK_CHECK_MS = 2000;

/**
 * Build plan M27 (GDD §5.2 "the Elder is often on the dock"): while his schedule says
 * `fishing_dock`, the Elder also fishes on the dock (the world clock: synced online, local offline).
 * TODO(M31): NPCs walk their schedules (he is still at his cottage post too, and the dock figure
 * cannot be talked to yet; the server hears catches next to him: `elderNearby`).
 */
function useElderOnDock(): boolean {
  const [on, setOn] = useState(elderOnDockNow);
  useEffect(() => {
    const timer = setInterval(() => setOn(elderOnDockNow()), DOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return on;
}

const elderOnDockNow = () => elderAtDock(getNpc("elder"), clockMinutesForPhase(dioramaStore.getState().worldTime));

/** Where an NPC stands: its post, or (the Elder on the dock) a spot in the town with an activity clip. */
type NpcSpot = Pick<NpcPost, "npcId" | "pos" | "facing"> & { space: SpaceId; activity?: ActivityAnimState };

function Npc({ post }: { post: NpcSpot }) {
  const group = useRef<Group>(null);
  const machine = useRef<AnimationStateMachine | null>(null);
  const heading = useRef(post.facing);
  const [character, setCharacter] = useState<Character | null>(null);
  const [tagY, setTagY] = useState(1.6);
  const nativeLang = useAvatar((s) => s.profile?.nativeLang);
  const name = translate(uiLocaleFor(nativeLang), `npc.name.${post.npcId}` as MessageKey);
  const talkingToMe = useConversation((s) => s.phase !== "idle" && s.phase !== "unavailable" && s.npcId === post.npcId);
  const othersTalking = useTownSession((s) => Object.values(s.remotes).some((r) => r.talkingTo === post.npcId && r.space === post.space));
  const talking = useRef(false);
  const wasThinking = useRef(false);
  useEffect(() => {
    talking.current = talkingToMe || othersTalking;
  }, [talkingToMe, othersTalking]);

  useEffect(() => {
    let cancelled = false;
    let built: Character | null = null;
    const npc = getNpc(post.npcId);
    characterAssetsWith([npc.look.animal], [npc.id])
      .then((assets) => {
        if (cancelled) return;
        built = assembleCharacter(assets, { ...npc.look, outfit: npc.id });
        built.root.traverse((n) => {
          n.castShadow = true;
        });
        setTagY(new Box3().setFromObject(built.root).max.y + NAME_TAG.gapM + (NAME_TAG.heightPx * NAME_TAG.metresPerPx) / 2);
        machine.current ??= new AnimationStateMachine(clipTimings(assets.manifest));
        built.play(machine.current.clip, 0);
        setCharacter(built);
      })
      .catch((error: unknown) => console.error(`npc ${post.npcId}:`, error));
    return () => {
      cancelled = true;
      if (built) {
        built.mixer.stopAllAction();
        for (const materials of built.tints.values()) for (const m of materials) m.dispose();
      }
      setCharacter(null);
    };
  }, [post.npcId]);

  const tag = useMemo<Sprite>(() => createNameTag(name), [name]);
  useEffect(() => () => disposeNameTag(tag), [tag]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;
    // Face the local player while talking with them (GDD §8.1: "the NPC turns").
    const state = conversationStore.getState();
    const me = cameraRig.follow;
    const facing = state.npcId === post.npcId && state.phase !== "idle" && me ? headingTowards(post.pos, [me[0], me[2]]) : post.facing;
    heading.current = dampAngle(heading.current, facing, TURN_RATE, dt);
    g.rotation.y = heading.current;
    const m = machine.current;
    // While the model answers, the NPC strikes its "think" pose once.
    const thinking = state.npcId === post.npcId && state.phase === "thinking";
    if (thinking && !wasThinking.current) m?.playEmote("think");
    wasThinking.current = thinking;
    if (m) {
      const change = m.update({ motion: "idle", talking: talking.current, ...(post.activity ? { activity: post.activity } : {}) }, dt);
      if (change && character) character.play(change.clip, change.fade, change.restart);
    }
    character?.mixer.update(dt);
  });

  return (
    <group ref={group} name={`npc-${post.npcId}`} position={[post.pos[0], 0, post.pos[1]]} rotation={[0, post.facing, 0]}>
      {character ? <primitive object={character.root} /> : null}
      <primitive object={tag} position={[0, tagY, 0]} />
      {othersTalking && !talkingToMe ? <ChattingIndicator y={tagY + 0.35} /> : null}
    </group>
  );
}
