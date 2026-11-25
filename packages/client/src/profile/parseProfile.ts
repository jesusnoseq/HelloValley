import { type PlayerProfile, toPlayerProfile, UserProfileSchema } from "@hellovalley/shared";

/**
 * A `users/{uid}` snapshot's data as the game's profile: null when the document does not exist
 * (onboarding not finished). Throws when it exists but does not match the schema.
 */
export function parseProfileDoc(data: unknown): PlayerProfile | null {
  if (data === undefined || data === null) return null;
  return toPlayerProfile(UserProfileSchema.parse(data));
}
