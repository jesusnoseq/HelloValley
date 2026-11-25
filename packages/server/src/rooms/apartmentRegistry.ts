import { type NavGrid, openApartmentNavGrid } from "@hellovalley/shared";

/** What the registry needs from a live ApartmentRoom. */
export interface RegisteredApartment {
  /** The owner's uid. */
  readonly owner: string;
  /** The walkability grid of the apartment's current layout. */
  navGrid(): NavGrid;
  /** Disconnects a visitor whose visit ended. */
  endVisit(visitorUid: string): void;
}

/**
 * Process-wide bookkeeping for apartments (build plan M17; one server instance, so in memory like
 * the TownRegistry): the live ApartmentRoom of each owner, and the visit passes the lobby
 * intercom grants. A pass lets one visitor into one owner's apartment until they leave it (walk
 * out of the door, or leave the town). The TownRoom asks it for the walkability grid of the
 * apartment a player is in, so movement there is validated against that owner's furniture.
 */
export class ApartmentRegistry {
  private readonly rooms = new Map<string, RegisteredApartment>();
  private readonly passes = new Map<string, Set<string>>();

  /** Registers an owner's room. False when that owner already has one. */
  addRoom(room: RegisteredApartment): boolean {
    if (this.rooms.has(room.owner)) return false;
    this.rooms.set(room.owner, room);
    return true;
  }

  removeRoom(room: RegisteredApartment): void {
    if (this.rooms.get(room.owner) === room) this.rooms.delete(room.owner);
  }

  room(owner: string): RegisteredApartment | undefined {
    return this.rooms.get(owner);
  }

  /** The owner accepted a visit. */
  grantVisit(owner: string, visitor: string): void {
    if (owner === visitor) return;
    let set = this.passes.get(owner);
    if (!set) this.passes.set(owner, (set = new Set()));
    set.add(visitor);
  }

  /** The visit is over: the pass goes and the visitor leaves the owner's room. */
  endVisit(owner: string, visitor: string): void {
    const set = this.passes.get(owner);
    if (!set?.delete(visitor)) return;
    if (set.size === 0) this.passes.delete(owner);
    this.rooms.get(owner)?.endVisit(visitor);
  }

  /** Whether `uid` may join `owner`'s ApartmentRoom: the owner always, others with a pass. */
  canEnter(owner: string, uid: string): boolean {
    return owner === uid || (this.passes.get(owner)?.has(uid) ?? false);
  }

  /**
   * The walkability grid of `owner`'s apartment: its live room's layout, or the empty studio
   * while no room has loaded it yet (looser than any layout, so nobody is corrected for
   * furniture their client has not seen).
   */
  gridFor(owner: string): NavGrid {
    return this.rooms.get(owner)?.navGrid() ?? openApartmentNavGrid();
  }
}
