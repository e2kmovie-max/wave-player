/**
 * Soft rate limit for outgoing friend requests.
 *
 * The friends backend doesn't talk to Redis, so the limiter reads
 * counts from the `Friendship` collection directly. The limits are
 * intentionally generous — they exist to slow obvious abuse, not to
 * gate legitimate use.
 *
 * Defaults (overridable through `FriendRateLimits`):
 *  - At most 50 outgoing pending requests in flight at once.
 *  - At most 30 outgoing requests per rolling 60-minute window.
 *
 * `assertCanSendFriendRequest()` throws `FriendRateLimitError` when the
 * caller is over either bucket; the structured `code` lets the route
 * handler return a specific HTTP status / i18n key.
 */

import { Types } from "mongoose";
import { Friendship } from "./models/Friendship";

export interface FriendRateLimits {
  /** Maximum number of pending outgoing requests at any time. */
  maxOutstandingPending: number;
  /** Maximum number of *new* outgoing requests within `windowMs`. */
  maxPerWindow: number;
  /** Sliding window length for `maxPerWindow`. */
  windowMs: number;
}

export const DEFAULT_FRIEND_RATE_LIMITS: FriendRateLimits = {
  maxOutstandingPending: 50,
  maxPerWindow: 30,
  windowMs: 60 * 60 * 1000,
};

export type FriendRateLimitCode = "too_many_pending" | "too_many_recent";

export class FriendRateLimitError extends Error {
  constructor(
    message: string,
    readonly code: FriendRateLimitCode,
    /** Suggested HTTP status. */
    readonly status = 429,
  ) {
    super(message);
    this.name = "FriendRateLimitError";
  }
}

interface UserIdLike {
  toString(): string;
}

function asObjectId(id: string | Types.ObjectId | UserIdLike): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  return new Types.ObjectId(typeof id === "string" ? id : id.toString());
}

/**
 * Throw `FriendRateLimitError` when the caller has exceeded either
 * the "pending in flight" or "new requests per window" cap.
 */
export async function assertCanSendFriendRequest(
  fromId: string | Types.ObjectId,
  options: {
    limits?: Partial<FriendRateLimits>;
    now?: Date;
  } = {},
): Promise<void> {
  const limits: FriendRateLimits = { ...DEFAULT_FRIEND_RATE_LIMITS, ...options.limits };
  const from = asObjectId(fromId);
  const now = options.now ?? new Date();

  const pending = await Friendship.countDocuments({
    requestedBy: from,
    status: "pending",
  });
  if (pending >= limits.maxOutstandingPending) {
    throw new FriendRateLimitError(
      `You already have ${pending} pending outgoing requests — accept or cancel some first.`,
      "too_many_pending",
    );
  }

  const recent = await Friendship.countDocuments({
    requestedBy: from,
    createdAt: { $gte: new Date(now.getTime() - limits.windowMs) },
  });
  if (recent >= limits.maxPerWindow) {
    throw new FriendRateLimitError(
      `Slow down — you've sent ${recent} friend requests in the last ${Math.round(limits.windowMs / 60_000)} minutes.`,
      "too_many_recent",
    );
  }
}
