/**
 * The App Check token source for the game server's `/api/*` calls and room joins (build plan M36,
 * architecture §7.2). `firebase/app.ts` installs the real one when App Check is configured; until
 * then (emulators, tests) there is no token and the server does not ask for one. This module has
 * no Firebase import, so the API client and the connection code stay testable.
 */
export type AppCheckTokenSource = () => Promise<string | null>;

let source: AppCheckTokenSource = () => Promise.resolve(null);

export function setAppCheckTokenSource(next: AppCheckTokenSource): void {
  source = next;
}

/** The current App Check token, or null (not configured, or the provider failed: the server then decides). */
export async function currentAppCheckToken(): Promise<string | null> {
  try {
    return await source();
  } catch {
    return null;
  }
}
