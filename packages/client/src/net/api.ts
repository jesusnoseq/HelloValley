import {
  ApiRoute,
  OnboardingErrorBodySchema,
  type OnboardingRequestInput,
  type OnboardingResponse,
  OnboardingResponseSchema,
} from "@hellovalley/shared";
import { SERVER_URL } from "./serverUrl";

/**
 * HTTP client for the game server's `/api/*` (architecture §7.2). Every request carries the
 * player's Firebase ID token. TODO(M36): also send `X-Firebase-AppCheck`.
 */

export interface TokenSource {
  getIdToken(): Promise<string>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** Why a call failed: `network` (no answer), a server error code (`name_rejected`, …), or `bad_response`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export async function postOnboarding(
  user: TokenSource,
  request: OnboardingRequestInput,
  { baseUrl = SERVER_URL, fetchImpl = fetch as FetchLike }: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<OnboardingResponse> {
  const token = await user.getIdToken();
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${ApiRoute.Onboarding}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new ApiError("network", null, err instanceof Error ? err.message : String(err));
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = OnboardingErrorBodySchema.safeParse(body);
    throw new ApiError(parsed.success ? parsed.data.error : "http_error", res.status, parsed.data?.message);
  }
  const parsed = OnboardingResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("bad_response", res.status, parsed.error.message);
  return parsed.data;
}
