import { type Client, type Delayed, Room, ServerError } from "@colyseus/core";
import {
  type ApartmentLayoutData,
  ApartmentJoinOptionsSchema,
  apartmentNavGrid,
  applyFurnitureEdit,
  ClientMessage,
  type ClientMessagePayloads,
  cloneLayout,
  type FurnitureEdit,
  type FurnitureResultMessage,
  layoutOrDefault,
  type NavGrid,
  parseClientMessage,
  ServerMessage,
  type UserProfile,
  VISIT_ENDED_CODE,
} from "@hellovalley/shared";
import type { ApartmentLayoutStore } from "../apartments/layoutStore";
import { type AppCheckVerifier, checkAppCheck } from "../auth/appCheck";
import { type IdTokenVerifier, InvalidIdTokenError, type VerifiedUser } from "../auth/idToken";
import type { ServerMetrics } from "../metrics/metrics";
import type { ProfileStore } from "../profiles/profileStore";
import { ApartmentRegistry, type RegisteredApartment } from "./apartmentRegistry";
import { ApartmentOccupant, ApartmentState } from "./ApartmentState";
import { TownRegistry } from "./townRegistry";

/** The owner and a few friends (my number; the studio is 6 × 5 m). */
export const APARTMENT_MAX_CLIENTS = 6;
/** Edits are saved this long after the last one (Firestore: about one write per second per document). */
export const LAYOUT_SAVE_DEBOUNCE_MS = 1000;
/**
 * Furniture edits per second the owner can sustain, with bursts up to the same number (a token
 * bucket). Only the owner sends messages here, so this is the room's per-client limit (build plan
 * M36; the TownRoom has its own per-client bucket for everything else).
 */
export const FURNITURE_EDITS_PER_S = 10;

export interface ApartmentAuth {
  uid: string;
  profile: UserProfile;
}

export type ApartmentClient = Client<{ auth: ApartmentAuth }>;

export interface ApartmentRoomDeps {
  verifier: IdTokenVerifier;
  profiles: ProfileStore;
  layouts: ApartmentLayoutStore;
  apartments: ApartmentRegistry;
  towns: TownRegistry;
  /** Save debounce (tests use a short one). */
  saveDebounceMs?: number;
  /** App Check verification of joins (build plan M36); null or left out: not enforced. */
  appCheck?: AppCheckVerifier | null;
  metrics?: ServerMetrics;
}

const unbound: ApartmentRoomDeps = {
  verifier: { verify: () => Promise.reject(new InvalidIdTokenError()) },
  profiles: {
    getProfile: () => Promise.resolve(null),
    createProfile: () => Promise.reject(new Error("no profile store")),
    updateAppearance: () => Promise.resolve(null),
  },
  layouts: { getLayout: () => Promise.resolve(null), saveLayout: () => Promise.reject(new Error("no layout store")) },
  apartments: new ApartmentRegistry(),
  towns: new TownRegistry(),
};

/**
 * One player's apartment (build plan M17, GDD §4.2, architecture §7.1): a private instance per
 * owner (`filterBy(["owner"])`), holding the furniture layout and who is inside. The owner always
 * gets in; anybody else needs a visit the owner accepted at the lobby intercom (TownRoom). Only
 * the owner can edit the furniture: every `furniture:edit` is validated with the shared placement
 * rules, applied to the synced state and saved (debounced) to `users/{owner}/apartment/layout`
 * through the Admin SDK. Positions stay in the TownRoom (players in an apartment report there as
 * everywhere else); the TownRoom validates them against this room's walkability grid.
 */
export class ApartmentRoom extends Room<{ state: ApartmentState; client: ApartmentClient }> implements RegisteredApartment {
  override maxClients = APARTMENT_MAX_CLIENTS;
  override state = new ApartmentState();
  protected deps: ApartmentRoomDeps = unbound;
  private ownerUid = "";
  private layout: ApartmentLayoutData = layoutOrDefault(null);
  private grid: NavGrid = apartmentNavGrid(this.layout);
  private saveTimer: Delayed | null = null;
  private unsaved = false;
  private saving: Promise<void> = Promise.resolve();
  private editTokens = FURNITURE_EDITS_PER_S;
  private editRefillMs = Date.now();

  get owner(): string {
    return this.ownerUid;
  }

  override async onCreate(options: unknown): Promise<void> {
    const parsed = ApartmentJoinOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) throw new ServerError(400, "invalid join options");
    this.ownerUid = parsed.data.owner;
    const [profile, stored] = await Promise.all([
      this.deps.profiles.getProfile(this.ownerUid),
      this.deps.layouts.getLayout(this.ownerUid).catch((err: unknown) => {
        // A broken document must not lock the owner out of their home: start from the studio again.
        console.error(`[apartment] layout of ${this.ownerUid} unreadable, using the starting furniture:`, err);
        return null;
      }),
    ]);
    if (!profile) throw new ServerError(404, "no such apartment");
    if (!this.deps.apartments.addRoom(this)) throw new ServerError(409, "apartment already open");
    this.setLayout(layoutOrDefault(stored));
    this.state.owner = this.ownerUid;
    this.state.ownerName = profile.name;
    this.state.apartmentId = profile.apartmentId;
    this.state.revision = 0;
    this.onMessage(ClientMessage.FurnitureEdit, (client: ApartmentClient, payload: unknown) => {
      const result = parseClientMessage(ClientMessage.FurnitureEdit, payload);
      if (!result.ok) {
        console.warn(`[apartment ${this.ownerUid}] dropped invalid furniture edit from ${client.sessionId}: ${result.error}`);
        return;
      }
      this.onEdit(client, result.value);
    });
  }

  override async onAuth(_client: ApartmentClient, options: unknown): Promise<ApartmentAuth> {
    const parsed = ApartmentJoinOptionsSchema.safeParse(options ?? {});
    if (!parsed.success || parsed.data.owner !== this.ownerUid) throw new ServerError(400, "invalid join options");
    let user: VerifiedUser;
    try {
      user = await this.deps.verifier.verify(parsed.data.idToken);
    } catch {
      this.deps.metrics?.inc("auth.idToken.rejected");
      throw new ServerError(401, "invalid ID token");
    }
    const app = await checkAppCheck(this.deps.appCheck ?? null, parsed.data.appCheckToken);
    if (app !== "ok") {
      this.deps.metrics?.inc(app === "missing" ? "auth.appCheck.missing" : "auth.appCheck.rejected");
      throw new ServerError(401, "invalid App Check token");
    }
    if (!this.deps.apartments.canEnter(this.ownerUid, user.uid)) throw new ServerError(403, "not invited");
    let profile: UserProfile | null;
    try {
      profile = await this.deps.profiles.getProfile(user.uid);
    } catch (err) {
      console.error(`[apartment] profile lookup failed for ${user.uid}:`, err);
      throw new ServerError(503, "profile unavailable");
    }
    if (!profile) throw new ServerError(403, "onboarding required");
    return { uid: user.uid, profile };
  }

  override onJoin(client: ApartmentClient): void {
    const { uid, profile } = client.auth!;
    // One seat per person: an older connection of the same uid (another tab) goes.
    for (const other of this.clients) {
      if (other !== client && other.auth?.uid === uid) other.leave(VISIT_ENDED_CODE, "joined again");
    }
    this.state.occupants.set(
      client.sessionId,
      new ApartmentOccupant({ name: profile.name, townSession: this.deps.towns.sessionIdOf(uid) ?? "", owner: uid === this.ownerUid }),
    );
  }

  override onLeave(client: ApartmentClient): void {
    this.state.occupants.delete(client.sessionId);
  }

  override async onDispose(): Promise<void> {
    this.deps.apartments.removeRoom(this);
    await this.flush();
  }

  /** RegisteredApartment: the current layout's walkability. */
  navGrid(): NavGrid {
    return this.grid;
  }

  /** RegisteredApartment: a visitor left the apartment (or the town); their connection goes. */
  endVisit(visitorUid: string): void {
    if (visitorUid === this.ownerUid) return;
    for (const client of this.clients) if (client.auth?.uid === visitorUid) client.leave(VISIT_ENDED_CODE, "visit ended");
  }

  /** Waits for every pending save (tests; dispose). */
  async flush(): Promise<void> {
    this.saveTimer?.clear();
    this.saveTimer = null;
    if (this.unsaved) this.save();
    await this.saving;
  }

  private onEdit(client: ApartmentClient, edit: ClientMessagePayloads[typeof ClientMessage.FurnitureEdit]): void {
    const reply = (r: Omit<FurnitureResultMessage, "editId">) => client.send(ServerMessage.FurnitureResult, { editId: edit.editId, ...r });
    if (client.auth?.uid !== this.ownerUid) {
      reply({ ok: false, reason: "not_owner" });
      return;
    }
    const now = Date.now();
    this.editTokens = Math.min(FURNITURE_EDITS_PER_S, this.editTokens + ((now - this.editRefillMs) / 1000) * FURNITURE_EDITS_PER_S);
    this.editRefillMs = now;
    if (this.editTokens < 1) {
      reply({ ok: false, reason: "invalid", problems: ["too many edits"] });
      return;
    }
    this.editTokens -= 1;
    const { editId: _id, ...rest } = edit;
    const result = applyFurnitureEdit(this.layout, rest as FurnitureEdit);
    if (!result.ok) {
      reply({ ok: false, reason: result.reason, problems: result.problems.slice(0, 5) });
      return;
    }
    this.setLayout(result.layout);
    this.state.revision++;
    reply({ ok: true });
    this.unsaved = true;
    this.saveTimer?.clear();
    this.saveTimer = this.clock.setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, this.deps.saveDebounceMs ?? LAYOUT_SAVE_DEBOUNCE_MS);
  }

  private setLayout(layout: ApartmentLayoutData): void {
    this.layout = layout;
    this.grid = apartmentNavGrid(layout);
    this.state.layout = JSON.stringify(layout);
  }

  /** Writes the current layout after any save in flight (saves never overlap or reorder). */
  private save(): void {
    this.unsaved = false;
    const snapshot = cloneLayout(this.layout);
    const owner = this.ownerUid;
    this.saving = this.saving
      .then(() => this.deps.layouts.saveLayout(owner, snapshot))
      .catch((err: unknown) => {
        // Keep the edit in the room and try again with the next edit or on dispose.
        console.error(`[apartment] saving the layout of ${owner} failed:`, err);
        this.unsaved = true;
      });
  }
}

/** An ApartmentRoom class bound to its dependencies, for `server.define`. */
export function apartmentRoomWith(deps: ApartmentRoomDeps): typeof ApartmentRoom {
  return class extends ApartmentRoom {
    protected override deps = deps;
  };
}
