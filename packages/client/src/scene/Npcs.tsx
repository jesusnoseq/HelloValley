import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Box3, type Group, type Sprite } from "three";
import {
  type ActivityAnimState,
  activityClip,
  AnimationStateMachine,
  type CharacterManifest,
  clockMinutesForPhase,
  type ClipTimings,
  ELDER_DOCK_FACING,
  elderAtDock,
  elderDockSpot,
  getNpc,
  headingTowards,
  NPC_IDS,
  type NpcId,
  npcsInSpace,
  type SpaceId,
  type Vec2,
} from "@hellovalley/shared";
import { characterAssetsWith } from "../characters/assetCache";
import { assembleCharacter, type Character } from "../characters/characterGlb";
import { translate, uiLocaleFor } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages.en";
import { INTERP_DELAY_MS } from "../net/interpolation";
import { useNpcBarks } from "../net/npcBarks";
import { townLive, useTownSession } from "../net/townSession";
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
 * The villagers in the space the player is in, each in its outfit with a name tag. Online (build
 * plan M31) they are where the TownRoom's NPC life has them: drawn INTERP_DELAY_MS in the past
 * between the room's snapshots (like remote players), walking their schedules, with the activity
 * clip of what they do there (fishing, eating), idle emotes and ambient bark bubbles in the
 * player's target language. Offline (the dev pages) they stand at their posts, and the Elder
 * fishes on the dock while his schedule says so (M27). When the local player talks to one, the
 * NPC turns to face them and plays the talk clip; when another player does (the synced
 * `talkingTo`), it plays the talk clip and shows the "chatting" indicator. Clicking an NPC is
 * picked in scene/Player.tsx (a shared ray test, like doors).
 */
export function Npcs() {
  const space = useWorld((s) => s.space);
  const live = useTownSession((s) => s.npcs);
  const online = Object.keys(live).length > 0;
  const posts = useMemo(() => npcsInSpace(space as SpaceId), [space]);
  const elderFishing = useElderOnDock(!online);
  const dock = useMemo<NpcSpot>(() => ({ npcId: "elder", space: "town", pos: elderDockSpot(), facing: ELDER_DOCK_FACING, activity: "fish_cast" }), []);
  if (online) {
    return (
      <>
        {NPC_IDS.filter((id) => live[id]?.space === space).map((id) => (
          <Npc key={id} spot={{ npcId: id, space: space as SpaceId, pos: [0, 0], facing: 0, ...(activityClip(live[id]!.activity) ? { activity: activityClip(live[id]!.activity)! } : {}) }} live />
        ))}
      </>
    );
  }
  return (
    <>
      {posts.map((post) => (
        <Npc key={post.npcId} spot={post} />
      ))}
      {space === "town" && elderFishing ? <Npc key="elder-dock" spot={dock} /> : null}
    </>
  );
}

/** How often the dock check reads the clock (ms). */
const DOCK_CHECK_MS = 2000;

/**
 * Offline only (build plan M27, GDD §5.2 "the Elder is often on the dock"): while his schedule
 * says `fishing_dock`, the Elder also fishes on the dock (the local world clock). Online the room
 * walks him there (build plan M31).
 */
function useElderOnDock(enabled: boolean): boolean {
  const [on, setOn] = useState(elderOnDockNow);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setOn(elderOnDockNow()), DOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return enabled && on;
}

const elderOnDockNow = () => elderAtDock(getNpc("elder"), clockMinutesForPhase(dioramaStore.getState().worldTime));

/** Where an NPC stands offline: its post, or (the Elder on the dock) a spot in the town with an activity clip. */
interface NpcSpot {
  npcId: NpcId;
  space: SpaceId;
  pos: Vec2;
  facing: number;
  activity?: ActivityAnimState;
}

function Npc({ spot, live = false }: { spot: NpcSpot; live?: boolean }) {
  const group = useRef<Group>(null);
  const machine = useRef<AnimationStateMachine | null>(null);
  const heading = useRef(spot.facing);
  const [character, setCharacter] = useState<Character | null>(null);
  const [tagY, setTagY] = useState(1.6);
  const nativeLang = useAvatar((s) => s.profile?.nativeLang);
  const name = translate(uiLocaleFor(nativeLang), `npc.name.${spot.npcId}` as MessageKey);
  const talkingToMe = useConversation((s) => s.phase !== "idle" && s.phase !== "unavailable" && s.npcId === spot.npcId);
  const othersTalking = useTownSession((s) => Object.values(s.remotes).some((r) => r.talkingTo === spot.npcId && r.space === spot.space));
  const bubble = useNpcBarks((s) => s.bubbles[spot.npcId] ?? null);
  const talking = useRef(false);
  const wasThinking = useRef(false);
  const activity = useRef(spot.activity);
  useEffect(() => {
    talking.current = talkingToMe || othersTalking || bubble !== null;
  }, [talkingToMe, othersTalking, bubble]);
  useEffect(() => {
    activity.current = spot.activity;
  }, [spot.activity]);

  useEffect(() => {
    let cancelled = false;
    let built: Character | null = null;
    const npc = getNpc(spot.npcId);
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
      .catch((error: unknown) => console.error(`npc ${spot.npcId}:`, error));
    return () => {
      cancelled = true;
      if (built) {
        built.mixer.stopAllAction();
        for (const materials of built.tints.values()) for (const m of materials) m.dispose();
      }
      setCharacter(null);
    };
  }, [spot.npcId]);

  const tag = useMemo<Sprite>(() => createNameTag(name), [name]);
  useEffect(() => () => disposeNameTag(tag), [tag]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;
    let pos: Vec2 = spot.pos;
    let rest = spot.facing;
    let motion: "idle" | "walk" | "run" = "idle";
    if (live) {
      const sample = townLive.npcTracks.get(spot.npcId)?.sampleAt(performance.now() - INTERP_DELAY_MS);
      if (!sample) return;
      // Mid-door the snapshot can still be in the previous space.
      g.visible = sample.space === spot.space;
      pos = [sample.x, sample.z];
      rest = sample.heading;
      motion = sample.motion;
    }
    g.position.set(pos[0], 0, pos[1]);
    // Face the local player while talking with them (GDD §8.1: "the NPC turns").
    const state = conversationStore.getState();
    const me = cameraRig.follow;
    const facing = state.npcId === spot.npcId && state.phase !== "idle" && me ? headingTowards(pos, [me[0], me[2]]) : rest;
    heading.current = live && motion !== "idle" ? facing : dampAngle(heading.current, facing, TURN_RATE, dt);
    g.rotation.y = heading.current;
    const m = machine.current;
    // While the model answers, the NPC strikes its "think" pose once.
    const thinking = state.npcId === spot.npcId && state.phase === "thinking";
    if (thinking && !wasThinking.current) m?.playEmote("think");
    wasThinking.current = thinking;
    if (m) {
      for (const emote of townLive.takeNpcEmotes(spot.npcId)) m.playEmote(emote);
      const change = m.update({ motion, talking: talking.current, ...(activity.current ? { activity: activity.current } : {}) }, dt);
      if (change && character) character.play(change.clip, change.fade, change.restart);
    }
    character?.mixer.update(dt);
  });

  return (
    <group ref={group} name={`npc-${spot.npcId}`} position={[spot.pos[0], 0, spot.pos[1]]} rotation={[0, spot.facing, 0]} visible={!live}>
      {character ? <primitive object={character.root} /> : null}
      <primitive object={tag} position={[0, tagY, 0]} />
      {othersTalking && !talkingToMe ? <ChattingIndicator y={tagY + 0.35} /> : null}
      {bubble && !talkingToMe ? <BarkBubble y={tagY + 0.45} text={bubble.line.text} reading={bubble.line.reading} translation={bubble.line.translation} /> : null}
    </group>
  );
}

const bubbleStyle: CSSProperties = {
  maxWidth: 220,
  padding: "5px 9px",
  borderRadius: 12,
  background: "rgba(255, 250, 240, 0.95)",
  color: "#3d3a44",
  font: "italic 14px/1.35 system-ui, sans-serif",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
  overflowWrap: "anywhere",
  pointerEvents: "auto",
};

/**
 * An ambient bark above a villager (build plan M31): the line in the player's target language;
 * hovering shows the reading and the translation into their native language.
 */
function BarkBubble({ y, text, reading, translation }: { y: number; text: string; reading?: string | undefined; translation: string }) {
  const [hover, setHover] = useState(false);
  return (
    <Html position={[0, y, 0]} center zIndexRange={[19, 0]} style={{ transform: "translateY(-50%)" }}>
      <div style={bubbleStyle} role="status" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} title={translation || undefined}>
        <div dir="auto">{text}</div>
        {hover && (reading || translation) ? (
          <div style={{ fontSize: 12, opacity: 0.75, fontStyle: "normal" }}>
            {reading ? <div>{reading}</div> : null}
            {translation ? <div>{translation}</div> : null}
          </div>
        ) : null}
      </div>
    </Html>
  );
}
