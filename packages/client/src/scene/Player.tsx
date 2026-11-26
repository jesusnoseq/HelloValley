import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box3, type Group, type Mesh, MeshBasicMaterial, Raycaster, RingGeometry, type Sprite, Vector2 } from "three";
import {
  AnimationStateMachine,
  appearanceHex,
  ClientMessage,
  appearanceOf,
  type CharacterManifest,
  type AvatarAppearance,
  type ClipTimings,
  emoteForKey,
  fishingSpotAt,
  getSeat,
  headingTowards,
  nearestSeat,
  nearestInteractable,
  nearestSpawn,
  talkSpotFor,
  pickNpc,
  PlayerController,
  type SpacePoint,
  type Vec2,
} from "@hellovalley/shared";
import { audioFrame, playSfx } from "../audio/live";
import { characterAssetsWith } from "../characters/assetCache";
import { MoveSync } from "../net/moveSync";
import { chat } from "../net/chatSession";
import { liveNpcLocator, townLive, townSession, useTownSession } from "../net/townSession";
import { openIntercom, visitSession } from "../net/visitSession";
import { assembleAvatar, tintAvatar } from "../characters/avatarLook";
import type { Character } from "../characters/characterGlb";
import { PLACEHOLDER_APPEARANCE, PLACEHOLDER_NAME } from "../characters/placeholderLook";
import { avatarStore, useAvatar } from "../state/avatarStore";
import { conversationStore } from "../state/conversationStore";
import { conversation } from "../ui/conversation/controller";
import { dioramaStore } from "../state/dioramaStore";
import { fishingActive, fishingLive, fishingStore } from "../state/fishingStore";
import { forageStore } from "../state/forageStore";
import { sendPick } from "../net/forageSession";
import { sendSit, sendStand } from "../net/foodSession";
import { foodStore, localSpeedFactor } from "../state/foodStore";
import { inventoryStore } from "../state/inventoryStore";
import { notebookStore } from "../state/notebookStore";
import { placementStore } from "../state/placementStore";
import { questStore } from "../state/questStore";
import { worldStore } from "../state/worldStore";
import { sceneGrids } from "./apartmentLayout";
import { CHAT_BUBBLE_GAP_M } from "../ui/chat/chatView";
import { yawForStep } from "./cameraMath";
import { cameraRig, TALK_VIEW_HEIGHT } from "./cameraRig";
import { ChatBubble } from "./ChatBubble";
import { createNameTag, disposeNameTag, NAME_TAG } from "./nameTag";
import { dampAngle, type Fade, IDLE_FADE, RUN_KEYS, screenDirection, screenToWorld, startFade, stepFade } from "./playerMath";

/** Turning speed of the avatar towards its walking direction (1/s). */
const TURN_RATE = 14;
const NO_INPUT: Vec2 = [0, 0];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** A dialog, placement mode, the chat input, the notebook, the bag or a cast line has the keyboard and mouse: the walker stands still. */
function inputPaused(): boolean {
  return (
    avatarStore.getState().mirrorOpen ||
    visitSession.getState().intercomOpen ||
    placementStore.getState().open ||
    chat.store.getState().typing ||
    notebookStore.getState().open ||
    inventoryStore.getState().open ||
    foodStore.getState().kitchenOpen ||
    questStore.getState().boardOpen ||
    fishingActive()
  );
}

/** The appearance the avatar shows: the mirror's live preview, else the profile's, else the placeholder. */
function currentAppearance(): AvatarAppearance {
  const { preview, profile } = avatarStore.getState();
  return preview ?? (profile ? appearanceOf(profile) : PLACEHOLDER_APPEARANCE);
}

function clipTimings(manifest: CharacterManifest): ClipTimings {
  return Object.fromEntries(manifest.animations.map((a) => [a.name, { duration: a.duration, loop: a.loop }]));
}

/**
 * The local player (build plan M13, M15): WASD / arrows walk relative to the screen (Shift runs),
 * a left click on the ground walks there along an A* path, and walking into a door fades into
 * that building's interior (or back out). The avatar is built from the profile's appearance
 * (or the mirror's live preview) with a name tag, and its clips follow the shared
 * AnimationStateMachine (idle/walk/run, emotes on 1–5 with crossfades). F uses the interactable
 * the player stands next to (the apartment mirror, the lobby intercom). While the mirror is open,
 * input pauses and the avatar turns to the camera so the new look is easy to see; the intercom
 * panel and furniture placement mode pause input too. In the apartment the walker's walkability
 * follows the apartment's furniture layout (build plan M17).
 * Online (build plan M16) the walker is predicted locally and reported to the TownRoom (MoveSync):
 * the server validates every report and a correction (or a fresh session's spawn) snaps the
 * walker back to the server's point. Emotes are relayed to the other players.
 * NPC conversations (build plan M23): F next to an NPC is handled by the conversation layer;
 * clicking an NPC talks at once when within reach, or walks to its talk spot first. While talking
 * the avatar faces the NPC and plays the talk clip, the camera eases in on the pair, and walking
 * away (keys or a click elsewhere) ends the conversation. Fishing (build plan M27): while a line is
 * out the walker stands still facing the cast and plays fish_cast, then fish_reel in the mini-game;
 * the fishing layer (ui/fishing) reads where the player stands. Foraging (build plan M28): F next to
 * a forage spawn or a lost item picks it up (the server checks the range). Eating and sitting
 * (build plan M29): F at the apartment kitchen opens the recipe cards; F next to a bench or café
 * chair sits down (the avatar is drawn on the seat playing `sit`, the walker stays beside it) and
 * walking (or F again) stands up; a bite plays the eat clip; a walk-speed buff (bread) makes the
 * walker faster by the same factor the server's movement check allows. Audio (build plan M35): the
 * walker is the listener (music and ambience follow where it is) and its steps sound like the
 * surface under it; walking through a door chimes.
 */
export function Player({ start }: { start: SpacePoint }) {
  // The apartment's walkability follows its furniture layout (build plan M17).
  const controller = useMemo(() => new PlayerController(start, sceneGrids), [start]);
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const held = useRef(new Set<string>());
  const avatar = useRef<Group>(null);
  const marker = useRef<Mesh>(null);
  const fade = useRef<Fade>(IDLE_FADE);
  const heading = useRef(start.heading);
  const machine = useRef<AnimationStateMachine | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [tagY, setTagY] = useState(1.6);
  const sync = useRef(new MoveSync());

  const selfSession = useTownSession((s) => s.room?.sessionId ?? null);
  const profile = useAvatar((s) => s.profile);
  const preview = useAvatar((s) => s.preview);
  const shown = preview ?? (profile ? appearanceOf(profile) : PLACEHOLDER_APPEARANCE);
  const name = profile?.name ?? PLACEHOLDER_NAME;
  const hex = appearanceHex(shown);
  const animal = shown.animal;

  // Show the start space and put the camera on the player.
  useEffect(() => {
    worldStore.getState().setSpace(start.space);
    cameraRig.follow = [start.pos[0], 0, start.pos[1]];
    cameraRig.snap = true;
    return () => {
      cameraRig.follow = null;
      cameraRig.talk = null;
      worldStore.setState({ nearby: null });
    };
  }, [start]);

  // A new character per animal (heads differ); colours change in place below.
  useEffect(() => {
    let cancelled = false;
    let built: Character | null = null;
    characterAssetsWith([animal])
      .then((assets) => {
        if (cancelled) return;
        const look = currentAppearance();
        built = assembleAvatar(assets, look.animal === animal ? look : { ...look, animal, colors: { ...look.colors, fur: "" } });
        built.root.traverse((n) => {
          n.castShadow = true;
        });
        // The name tag floats above the tallest part of this head (ears, antlers).
        setTagY(new Box3().setFromObject(built.root).max.y + NAME_TAG.gapM + (NAME_TAG.heightPx * NAME_TAG.metresPerPx) / 2);
        machine.current ??= new AnimationStateMachine(clipTimings(assets.manifest));
        built.play(machine.current.clip, 0);
        setCharacter(built);
      })
      .catch((error: unknown) => console.error("player avatar:", error));
    return () => {
      cancelled = true;
      built?.mixer.stopAllAction();
      setCharacter(null);
    };
  }, [animal]);

  // Colour edits re-tint in place (the hex values change, the character does not).
  useEffect(() => {
    if (character) tintAvatar(character, currentAppearance());
  }, [character, hex.fur, hex.shirt, hex.trousers]);

  const tag = useMemo<Sprite>(() => createNameTag(name), [name]);
  useEffect(() => () => disposeNameTag(tag), [tag]);

  // Keyboard: held keys are sampled every frame; F interacts, 1–5 emote.
  useEffect(() => {
    const keys = held.current;
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (inputPaused()) return;
      if (e.code.startsWith("Arrow")) e.preventDefault();
      if (e.repeat) return;
      keys.add(e.code);
      const nearby = worldStore.getState().nearby?.kind;
      // F next to an NPC belongs to the conversation layer (ui/conversation/ConversationLayer).
      if (e.code === "KeyF" && fade.current.phase === "idle" && nearby && nearby !== "npc") {
        keys.clear();
        if (nearby === "mirror") avatarStore.getState().openMirror();
        else if (nearby === "kitchen") foodStore.setState({ kitchenOpen: true });
        // Build plan M30: F at the Town Hall notice board opens today's requests.
        else if (nearby === "notice_board") questStore.setState({ boardOpen: true });
        else openIntercom();
        return;
      }
      // Build plan M28: F next to a forage spawn (or a lost item) asks the server to pick it up.
      const spawn = forageStore.getState().nearby;
      if (e.code === "KeyF" && fade.current.phase === "idle" && !nearby && spawn && conversationStore.getState().phase === "idle") {
        keys.clear();
        sendPick(spawn);
        return;
      }
      // Build plan M29: F sits on the seat in reach, or stands up again.
      const food = foodStore.getState();
      if (e.code === "KeyF" && fade.current.phase === "idle" && !nearby && conversationStore.getState().phase === "idle" && (food.seat || food.nearbySeat)) {
        keys.clear();
        if (food.seat) sendStand();
        else if (food.nearbySeat) sendSit(food.nearbySeat);
        return;
      }
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
      const emote = digit ? emoteForKey(Number(digit)) : null;
      if (emote && machine.current?.playEmote(emote)) {
        const room = townSession.getState().room;
        if (room?.connection.isOpen) room.send(ClientMessage.Emote, { emote });
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const clear = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Click-to-move: a left click on the canvas, as a camera ray (a building click goes to its door).
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || fade.current.phase !== "idle" || inputPaused()) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      const { origin, direction } = raycaster.ray;
      const o: [number, number, number] = [origin.x, origin.y, origin.z];
      const d: [number, number, number] = [direction.x, direction.y, direction.z];
      // An NPC first (build plan M23): talk now, or walk to the counter and talk on arrival.
      // Build plan M31: villagers walk; the ray, the range and the talk spot follow where they are.
      const npc = pickNpc(controller.state.space, o, d, liveNpcLocator);
      if (npc) {
        if (conversationStore.getState().npcId === npc) return;
        conversation.requestTalk(npc, controller.state.space, controller.state.pos);
        if (conversationStore.getState().pendingTalk === npc) controller.clickTo(talkSpotFor(liveNpcLocator(npc), controller.state.pos));
        return;
      }
      conversation.cancelPending();
      // Building walls and doorways first, else the ground plane (shared pickClick).
      controller.clickRay(o, d);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [gl, get, controller]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const world = worldStore.getState();
    const mirrorOpen = avatarStore.getState().mirrorOpen;
    const paused = inputPaused();

    // Server corrections and a fresh session's spawn put the walker where the server has it.
    const putAt = (to: SpacePoint) => {
      controller.teleport(to);
      heading.current = to.heading;
      cameraRig.snap = true;
      if (fade.current.phase !== "idle") {
        fade.current = IDLE_FADE;
        worldStore.setState({ fade: 0 });
      }
      if (world.space !== to.space) world.setSpace(to.space);
    };
    const spawn = townLive.spawn;
    if (spawn) {
      townLive.spawn = null;
      sync.current.reset();
      const here = controller.state;
      if (here.space !== spawn.space || Math.hypot(here.pos[0] - spawn.x, here.pos[1] - spawn.z) > 0.05) {
        putAt({ space: spawn.space, pos: [spawn.x, spawn.z], heading: spawn.heading });
      }
    }
    while (townLive.corrections.length) {
      const to = sync.current.correct(townLive.corrections.shift()!);
      if (to) putAt(to);
    }

    // Door fade: out, swap spaces at full cover, wait for the new room's meshes, back in.
    if (fade.current.phase !== "idle") {
      const r = stepFade(fade.current, dt, world.ready);
      fade.current = r.fade;
      if (r.swap) {
        const to = controller.completeTransition();
        if (to) {
          world.setSpace(to.space);
          heading.current = to.heading;
          cameraRig.snap = true;
        }
      }
      worldStore.setState({ fade: fade.current.cover });
    }

    if (paused) {
      held.current.clear();
      controller.setInput(NO_INPUT);
      if (controller.waypoints) controller.teleport({ ...controller.state });
    } else {
      const keys = held.current;
      // Walking off with the keys cancels a clicked NPC.
      if (keys.size > 0 && conversationStore.getState().pendingTalk) conversation.cancelPending();
      const run = RUN_KEYS.some((k) => keys.has(k));
      controller.setInput(screenToWorld(screenDirection(keys), yawForStep(dioramaStore.getState().cameraStep)), run);
    }
    // Build plan M29: bread's walk-speed buff (the server allows the same factor).
    const food = foodStore.getState();
    const nowMs = Date.now();
    controller.setSpeedFactor(localSpeedFactor(food, nowMs));
    let enteredDoor = false;
    if (fade.current.phase === "idle" && controller.update(dt)) {
      fade.current = startFade();
      worldStore.setState({ fade: 0 });
      enteredDoor = true;
    }
    // Report the predicted walker (the door trigger position goes out at once).
    const room = townSession.getState().room;
    if (room?.connection.isOpen && townLive.welcomed) {
      const move = sync.current.next(controller.state, performance.now(), enteredDoor);
      if (move) room.send(ClientMessage.PlayerMove, move);
    }

    const { pos, motion, space } = controller.state;
    // Build plan M35: the listener follows the walker; footsteps by surface, a chime at doors.
    audioFrame(space, pos, fade.current.phase === "idle" ? motion : "idle", dt);
    if (enteredDoor) playSfx("door.chime");
    // What F would use: only while standing still in the open (not mid-fade).
    const near = fade.current.phase === "idle" ? nearestInteractable(space, pos, liveNpcLocator) : null;
    if ((near?.id ?? null) !== (world.nearby?.id ?? null)) worldStore.setState({ nearby: near ? { id: near.id, kind: near.kind } : null });
    // Fishing (build plan M27): where the player could cast from (the server decides the secret spot).
    const spot = fade.current.phase === "idle" ? fishingSpotAt(space, pos) : null;
    if (spot !== world.fishingSpot) worldStore.setState({ fishingSpot: spot });
    fishingLive.pos = space === "town" ? [pos[0], pos[1]] : null;
    // Foraging (build plan M28): the spawn within reach (the server checks the range again).
    const forage = forageStore.getState();
    const reach = fade.current.phase === "idle" && space === "town" ? (nearestSpawn(Object.values(forage.spawns), pos)?.spawnId ?? null) : null;
    if (reach !== forage.nearby) forageStore.setState({ nearby: reach });
    // Seats (build plan M29): walking off one stands up; otherwise the one within reach is what F sits on.
    if (food.seat && motion !== "idle") sendStand();
    const seated = food.seat ? getSeat(food.seat) : undefined;
    const sitOn = seated && seated.space === space ? seated : null;
    const seatNear = fade.current.phase === "idle" && !sitOn ? (nearestSeat(space, pos)?.id ?? null) : null;
    if (seatNear !== food.nearbySeat) foodStore.setState({ nearbySeat: seatNear });
    fishingLive.heading = heading.current;

    cameraRig.follow = [pos[0], 0, pos[1]];
    // NPC conversations: walking away ends one, arriving at a clicked NPC starts one.
    conversation.updatePosition(space, pos);
    const talk = conversationStore.getState();
    const talkingTo = talk.npcId && talk.phase !== "idle" && talk.phase !== "unavailable" ? liveNpcLocator(talk.npcId) : null;
    const talking = talkingTo !== null && talkingTo.space === space;
    cameraRig.talk = talking ? { target: [(pos[0] + talkingTo.pos[0]) / 2, 0.6, (pos[1] + talkingTo.pos[1]) / 2], viewHeight: TALK_VIEW_HEIGHT } : null;
    // In front of the mirror the avatar turns to the camera to show off the new look; in a
    // conversation it stands facing the NPC.
    const fishing = fishingStore.getState();
    const castHeading = fishingActive(fishing) ? fishing.heading : null;
    const faceTo = mirrorOpen
      ? cameraRig.yaw
      : sitOn
        ? sitOn.facing
      : castHeading !== null
        ? castHeading
        : talking && motion === "idle"
          ? headingTowards(pos, talkingTo.pos)
          : controller.state.heading;
    heading.current = dampAngle(heading.current, faceTo, TURN_RATE, dt);
    const g = avatar.current;
    if (g) {
      g.position.set(sitOn ? sitOn.pos[0] : pos[0], 0, sitOn ? sitOn.pos[1] : pos[1]);
      g.rotation.y = heading.current;
    }
    const m0 = machine.current;
    if (m0) {
      const reeling = fishing.phase === "reeling" || fishing.phase === "landing";
      const activity = fishingActive(fishing) ? (reeling ? "fish_reel" : "fish_cast") : nowMs < food.eatingUntil ? "eat" : undefined;
      // The cake's cheer (build plan M29) arrives for the local avatar like a remote emote.
      if (selfSession) for (const emote of townLive.takeEmotes(selfSession)) m0.playEmote(emote);
      const change = m0.update({ motion, seated: sitOn !== null, talking, activity }, dt);
      if (change && character) character.play(change.clip, change.fade, change.restart);
    }
    character?.mixer.update(dt);
    const m = marker.current;
    if (m) {
      const goal: Vec2 | undefined = controller.waypoints?.at(-1);
      m.visible = goal !== undefined;
      if (goal) m.position.set(goal[0], 0.03, goal[1]);
    }
    // Before the camera (priority 0) so it follows this frame's position.
  }, -1);

  const markerResources = useMemo(
    () => ({ geometry: new RingGeometry(0.16, 0.24, 24).rotateX(-Math.PI / 2), material: new MeshBasicMaterial({ color: "#fff6e0", transparent: true, opacity: 0.8, depthWrite: false }) }),
    [],
  );
  useEffect(
    () => () => {
      markerResources.geometry.dispose();
      markerResources.material.dispose();
    },
    [markerResources],
  );

  return (
    <>
      <group ref={avatar} name="player">
        {character ? <primitive object={character.root} /> : null}
        <primitive object={tag} position={[0, tagY, 0]} />
        {selfSession ? <ChatBubble sessionId={selfSession} y={tagY + CHAT_BUBBLE_GAP_M} /> : null}
      </group>
      <mesh ref={marker} geometry={markerResources.geometry} material={markerResources.material} visible={false} renderOrder={5} />
    </>
  );
}
