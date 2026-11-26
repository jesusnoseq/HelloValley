import {
  ApiErrorBodySchema,
  ApiRoute,
  type AppearanceUpdateRequest,
  type AppearanceUpdateResponse,
  AppearanceUpdateResponseSchema,
  type OnboardingRequestInput,
  type OnboardingResponse,
  OnboardingResponseSchema,
  type ReviewDoneRequest,
  type ReviewDoneResponse,
  ReviewDoneResponseSchema,
  type ShardsResponse,
  ShardsResponseSchema,
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

/** The part of a zod schema `call` needs (the client has no direct zod dependency). */
interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export interface ApiOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

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

async function call<T>(
  user: TokenSource,
  method: "GET" | "POST" | "PUT",
  route: string,
  body: unknown,
  schema: ResponseSchema<T>,
  { baseUrl = SERVER_URL, fetchImpl = fetch as FetchLike }: ApiOptions,
): Promise<T> {
  const token = await user.getIdToken();
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(
      `${baseUrl.replace(/\/+$/, "")}${route}`,
      method === "GET"
        ? { method, headers: { authorization: `Bearer ${token}` } }
        : { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) },
    );
  } catch (err) {
    throw new ApiError("network", null, err instanceof Error ? err.message : String(err));
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorBodySchema.safeParse(json);
    throw new ApiError(parsed.success ? parsed.data.error : "http_error", res.status, parsed.data?.message);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError("bad_response", res.status, parsed.error.message);
  return parsed.data;
}

export function postOnboarding(user: TokenSource, request: OnboardingRequestInput, options: ApiOptions = {}): Promise<OnboardingResponse> {
  return call(user, "POST", ApiRoute.Onboarding, request, OnboardingResponseSchema, options);
}

/** `PUT /api/profile/appearance` (the apartment mirror, M15): the server answers with the updated profile. */
export function putAppearance(user: TokenSource, appearance: AppearanceUpdateRequest, options: ApiOptions = {}): Promise<AppearanceUpdateResponse> {
  return call(user, "PUT", ApiRoute.Appearance, appearance, AppearanceUpdateResponseSchema, options);
}

/** `GET /api/shards[?friend=<uid>]` (build plan M16): the live shards and the friend's shard (or null). */
export function getShards(user: TokenSource, friendUid?: string, options: ApiOptions = {}): Promise<ShardsResponse> {
  const route = friendUid ? `${ApiRoute.Shards}?friend=${encodeURIComponent(friendUid)}` : ApiRoute.Shards;
  return call(user, "GET", route, undefined, ShardsResponseSchema, options);
}

/** `POST /api/review` (build plan M25): a notebook review session ended; the server answers with the streak. */
export function postReview(user: TokenSource, request: ReviewDoneRequest, options: ApiOptions = {}): Promise<ReviewDoneResponse> {
  return call(user, "POST", ApiRoute.Review, request, ReviewDoneResponseSchema, options);
}
