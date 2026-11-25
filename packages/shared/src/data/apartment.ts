import { z } from "zod";

/** Apartment IDs are floor 1–9 + door A–H, for example `6D` (GDD §4.2). They need not be unique. */
export const APARTMENT_FLOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const APARTMENT_DOORS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type ApartmentFloor = (typeof APARTMENT_FLOORS)[number];
export type ApartmentDoor = (typeof APARTMENT_DOORS)[number];
export type ApartmentId = `${ApartmentFloor}${ApartmentDoor}`;

const APARTMENT_ID = /^[1-9][A-H]$/;

export function isApartmentId(value: unknown): value is ApartmentId {
  return typeof value === "string" && APARTMENT_ID.test(value);
}

export const ApartmentIdSchema = z.string().refine(isApartmentId, { message: "apartment id must be floor 1-9 + door A-H" });

export function parseApartmentId(id: ApartmentId): { floor: ApartmentFloor; door: ApartmentDoor } {
  return { floor: Number(id[0]) as ApartmentFloor, door: id[1] as ApartmentDoor };
}

function pick<T>(options: readonly T[], random: () => number): T {
  const r = random();
  const raw = Number.isFinite(r) ? Math.floor(r * options.length) : 0;
  const index = Math.min(options.length - 1, Math.max(0, raw));
  return options[index] as T;
}

/**
 * A random apartment ID. `random` returns a number in [0, 1) like Math.random (inject a seeded RNG
 * in tests). The server assigns it at onboarding (TODO(M14)).
 */
export function randomApartmentId(random: () => number = Math.random): ApartmentId {
  return `${pick(APARTMENT_FLOORS, random)}${pick(APARTMENT_DOORS, random)}`;
}
