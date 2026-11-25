import {
  type ApartmentLayoutData,
  ApartmentLayoutSchema,
  apartmentInteriorLayout,
  apartmentNavGrid,
  applyFurnitureEdit,
  defaultApartmentLayout,
  type FurnitureEdit,
  type FurnitureResultMessage,
  type InteriorLayout,
  type NavGrid,
  type SpaceGrids,
  spaceGrid,
} from "@hellovalley/shared";
import { apartmentSession, setOfflineFurnitureEditor, useApartmentSession } from "../net/apartmentSession";

/**
 * The apartment as the scene shows it (build plan M17): the layout of the ApartmentRoom the
 * player is in, parsed and validated, with its interior scene and walkability grid cached per
 * layout. Before the room's layout arrives (and offline without one) it is the starting
 * furniture, which is also what the static apartment grid has.
 */

interface Parsed {
  json: string | null;
  layout: ApartmentLayoutData;
  interior: InteriorLayout;
  grid: NavGrid;
}

let cache: Parsed | null = null;

/** Parses the room's layout JSON; null when it is missing or malformed. */
export function parseLayoutJson(json: string | null): ApartmentLayoutData | null {
  if (!json) return null;
  try {
    const parsed = ApartmentLayoutSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parsedFor(json: string | null): Parsed {
  if (cache && cache.json === json) return cache;
  const layout = parseLayoutJson(json) ?? defaultApartmentLayout();
  cache = { json, layout, interior: apartmentInteriorLayout(layout), grid: apartmentNavGrid(layout) };
  return cache;
}

/** The current apartment layout (outside React). */
export function currentApartment(): Parsed {
  return parsedFor(apartmentSession.getState().layoutJson);
}

/** The current apartment layout and its interior scene; re-renders when an edit lands. */
export function useApartmentLayout(): Parsed {
  const json = useApartmentSession((s) => s.layoutJson);
  return parsedFor(json);
}

/** Walkability per space for the local walker: the apartment follows its current furniture. */
export const sceneGrids: SpaceGrids = (space) => (space === "apartment" ? currentApartment().grid : spaceGrid(space));

/**
 * Offline (the dev page): edits apply to a local layout with the same shared rules the
 * ApartmentRoom runs, so placement mode can be tried without a server.
 */
export function startOfflineApartment(start: ApartmentLayoutData = defaultApartmentLayout()): void {
  apartmentSession.setState({ isOwner: true, owner: "offline", ownerName: "", layoutJson: JSON.stringify(start) });
  setOfflineFurnitureEditor((edit: FurnitureEdit): Omit<FurnitureResultMessage, "editId"> & { editId: number } => {
    const result = applyFurnitureEdit(currentApartment().layout, edit);
    if (!result.ok) return { editId: 0, ok: false, reason: result.reason, problems: result.problems };
    apartmentSession.setState((s) => ({ layoutJson: JSON.stringify(result.layout), revision: s.revision + 1 }));
    return { editId: 0, ok: true };
  });
}
