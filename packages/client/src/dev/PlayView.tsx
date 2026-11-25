import type { CSSProperties } from "react";
import {
  AppearanceUpdateRequestSchema,
  BUILDING_RECIPE_IDS,
  buildingExitPoint,
  interiorArrivalPoint,
  interiorLayout,
  isInteriorId,
  type PlayerProfile,
  type SpacePoint,
  withAppearance,
} from "@hellovalley/shared";
import { PLACEHOLDER_APPEARANCE, PLACEHOLDER_NAME } from "../characters/placeholderLook";
import { ApiError } from "../net/api";
import { ZOOM_LEVELS } from "../scene/cameraMath";
import { currentApartment, startOfflineApartment } from "../scene/apartmentLayout";
import { DioramaView } from "../scene/DioramaView";
import { TOWN_SHADOW_EXTENT } from "../scene/townCamera";
import { TOWN_START, World } from "../scene/World";
import { avatarStore } from "../state/avatarStore";
import { placementStore } from "../state/placementStore";
import { dioramaStore, useDiorama } from "../state/dioramaStore";
import { useWorld } from "../state/worldStore";
import { ApartmentHud } from "../ui/apartment/ApartmentHud";
import { FadeOverlay } from "../ui/FadeOverlay";
import { MirrorLayer } from "../ui/mirror/MirrorLayer";
import type { SaveAppearance } from "../ui/mirror/MirrorPanel";
import { ConversationLayer } from "../ui/conversation/ConversationLayer";
import { PerfHud } from "../ui/PerfHud";

const panel: CSSProperties = {
  position: "fixed",
  left: 8,
  bottom: 8,
  display: "grid",
  gap: 6,
  maxWidth: 360,
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(255, 250, 240, 0.9)",
  color: "#3d3a44",
  font: "13px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
};

const query = new URLSearchParams(window.location.search);
const s = dioramaStore.getState();
const t = Number(query.get("t"));
if (query.has("t") && Number.isFinite(t)) s.setWorldTime(t);
if (query.get("speed") === "0") s.setTimeScale(0);
if (query.get("fx") === "0") s.setEffects(false);
if (query.has("zoom")) dioramaStore.setState({ zoomLevel: Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Number(query.get("zoom")) || 0)) });
if (query.has("step")) dioramaStore.setState({ cameraStep: Math.round(Number(query.get("step")) || 0) });

/** `?space=<interior>` starts inside it, `?at=<building>` outside its door, else at the spawn point. */
function startPoint(): SpacePoint {
  const space = query.get("space");
  if (isInteriorId(space)) {
    // `&spot=mirror` starts at a named spot of the room (interior layout `spots`).
    const spot = interiorLayout(space).spots[query.get("spot") ?? ""];
    const arrival = interiorArrivalPoint(space);
    return spot ? { ...arrival, pos: [spot[0], spot[1]] } : arrival;
  }
  const at = query.get("at");
  if (at && (BUILDING_RECIPE_IDS as readonly string[]).includes(at)) return buildingExitPoint(at as (typeof BUILDING_RECIPE_IDS)[number]);
  return TOWN_START;
}

const START = startPoint();

// A fake signed-in profile so the avatar, name tag and mirror work without Firebase.
avatarStore.getState().setProfile({
  name: query.get("name") ?? PLACEHOLDER_NAME,
  ...PLACEHOLDER_APPEARANCE,
  apartmentId: "6D",
  nativeLang: "en",
  targetLangs: ["es"],
  style: "european",
} satisfies PlayerProfile);

// No ApartmentRoom offline: placement mode edits a local layout with the same shared rules (M17).
startOfflineApartment();
// `&decorate=1` opens placement mode at once (`&hold=<index>` also picks up that placed piece).
if (query.get("decorate") === "1") {
  placementStore.getState().setOpen(true);
  const index = Number(query.get("hold"));
  const piece = query.has("hold") && Number.isInteger(index) ? currentApartment().layout.furniture[index] : undefined;
  if (piece) placementStore.getState().hold({ kind: "placed", index, itemId: piece.itemId }, piece.rot);
}

/** Stands in for `PUT /api/profile/appearance` (`?save=offline` simulates a network failure). */
const fakeSave: SaveAppearance = async (request) => {
  await new Promise((r) => setTimeout(r, 300));
  if (query.get("save") === "offline") throw new ApiError("network", null);
  return withAppearance(avatarStore.getState().profile!, AppearanceUpdateRequestSchema.parse(request));
};

/**
 * Dev-only play page (`/dev/play`, build plan M13): the world with the local player and no
 * sign-in. WASD / arrows walk (Shift runs), click the ground to walk there, click a building or
 * walk into its door to go inside; Q/E rotate, the wheel zooms. Query parameters:
 * `?space=bakery` (`&spot=counter`) or `?at=library` (start point), `&t=0.2&speed=0&zoom=1&step=0&fx=0`, and for
 * the M15 avatar `&name=Lia` and `&save=offline`. In the apartment, F at the mirror edits the look;
 * 1–5 play emotes. In the apartment, Decorate opens furniture placement mode (M17, a local layout:
 * no server); in town, F at the intercom beside the apartment block door opens the (empty) panel.
 * M23: every interior has its villager; F or a click next to one opens the conversation panel,
 * which says it is offline here (no TownRoom; the component tests drive it with a mocked room).
 */
export function PlayView() {
  const space = useWorld((st) => st.space);
  const zoomLevel = useDiorama((st) => st.zoomLevel);
  return (
    <DioramaView shadowExtent={TOWN_SHADOW_EXTENT} world={<World start={START} />}>
      <FadeOverlay />
      <MirrorLayer save={fakeSave} />
      <ApartmentHud />
      <ConversationLayer />
      <PerfHud />
      <div style={panel}>
        <strong>Play (M13, M15, M17)</strong>
        <span>
          space: {space} · zoom: {ZOOM_LEVELS[zoomLevel]!.id}
        </span>
        <span>WASD / arrows walk, Shift runs, click to walk there, click a building or walk into its door to enter. Q/E rotate, wheel zooms. 1–5 emote; F at the apartment mirror changes your look.</span>
      </div>
    </DioramaView>
  );
}
