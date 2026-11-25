import { type Request, type Response, Router } from "express";
import { ApiRoute, type ShardsResponse, UidSchema } from "@hellovalley/shared";
import type { TownRegistry } from "../rooms/townRegistry";

export interface ShardsDeps {
  registry: TownRegistry;
}

/** Path of the route under the `/api` mount. */
const PATH = ApiRoute.Shards.replace(/^\/api/, "");

/**
 * `GET /api/shards[?friend=<uid>]` (architecture §7.2, build plan M16): the live TownRoom shards
 * and, with `friend`, the shard that player is in. The client then joins that shard by room id
 * (falling back to normal matchmaking when it is full).
 * TODO(M36+): once players have a friend list, only reveal the shard of the caller's friends.
 */
export function shardsRouter(deps: ShardsDeps): Router {
  const router = Router();
  router.get(PATH, (req: Request, res: Response) => {
    const friend = req.query.friend;
    let friendShard: ShardsResponse["friend"] = null;
    if (friend !== undefined) {
      const parsed = UidSchema.safeParse(friend);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_request", message: "friend: not a uid" });
        return;
      }
      friendShard = deps.registry.shardOf(parsed.data);
    }
    const body: ShardsResponse = { shards: deps.registry.list(), friend: friendShard };
    res.json(body);
  });
  return router;
}
