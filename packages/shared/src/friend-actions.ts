/**
 * Orchestration layer that ties `friends.ts`, the rate limiter, and the
 * notification inbox together.
 *
 * Route handlers should call these high-level actions instead of the
 * raw CRUD in `friends.ts` so a single code path handles:
 *
 *  - rate limiting (`assertCanSendFriendRequest()`),
 *  - the CRUD itself (`sendFriendRequest()` / `acceptFriendRequest()`),
 *  - dropping the right notification on the right inbox.
 *
 * The actions return both the friendship doc and the (optional)
 * notification view so the caller can log / forward to the bot.
 */

import { Types } from "mongoose";
import {
  acceptFriendRequest as rawAccept,
  sendFriendRequest as rawSend,
  FriendshipError,
} from "./friends";
import type { FriendshipDoc } from "./models/Friendship";
import { User } from "./models/User";
import {
  notifyFriendAccepted,
  notifyFriendRequest,
  type NotificationView,
} from "./notifications";
import {
  assertCanSendFriendRequest,
  type FriendRateLimits,
} from "./friend-rate-limit";

interface UserIdLike {
  toString(): string;
}

function asObjectId(id: string | Types.ObjectId | UserIdLike): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  return new Types.ObjectId(typeof id === "string" ? id : id.toString());
}

async function loadDisplayName(id: Types.ObjectId): Promise<string | undefined> {
  const doc = await User.findById(id)
    .select({
      googleName: 1,
      googleEmail: 1,
      telegramFirstName: 1,
      telegramUsername: 1,
      guestName: 1,
    })
    .lean<{
      googleName?: string;
      googleEmail?: string;
      telegramFirstName?: string;
      telegramUsername?: string;
      guestName?: string;
    } | null>();
  if (!doc) return undefined;
  return (
    doc.googleName ??
    doc.telegramFirstName ??
    doc.telegramUsername ??
    doc.guestName ??
    doc.googleEmail
  );
}

export interface FriendActionResult {
  friendship: FriendshipDoc;
  notification: NotificationView | null;
}

export interface SendFriendRequestActionOptions {
  /** Override the default rate-limit knobs. */
  rateLimits?: Partial<FriendRateLimits>;
  /** Skip the rate-limit pre-check (used by admin tools). */
  skipRateLimit?: boolean;
  /** Skip emitting a notification (used by tests / migrations). */
  skipNotification?: boolean;
}

/**
 * Send a friend request from `fromId` to `toId` with rate-limit +
 * notification side effects.
 *
 * Throws:
 *  - `FriendRateLimitError` when the caller is over a limit.
 *  - `FriendshipError` when the target is missing / blocked / etc.
 */
export async function sendFriendRequestAction(
  fromId: string | Types.ObjectId,
  toId: string | Types.ObjectId,
  options: SendFriendRequestActionOptions = {},
): Promise<FriendActionResult> {
  const from = asObjectId(fromId);
  const to = asObjectId(toId);
  if (!options.skipRateLimit) {
    await assertCanSendFriendRequest(from, { limits: options.rateLimits });
  }
  const doc = await rawSend(from, to);
  let notification: NotificationView | null = null;
  if (!options.skipNotification) {
    const actorName = await loadDisplayName(from);
    if (doc.status === "accepted") {
      // The reverse-pending → accept case: notify the *other* side
      // that they're now friends.
      notification = await notifyFriendAccepted({
        recipientId: doc.requestedBy.toString() === from.toString() ? to : doc.requestedBy,
        actorId: from,
        actorName,
      });
    } else if (doc.status === "pending") {
      notification = await notifyFriendRequest({
        recipientId: to,
        actorId: from,
        actorName,
      });
    }
  }
  return { friendship: doc, notification };
}

export interface AcceptFriendRequestActionOptions {
  skipNotification?: boolean;
}

/**
 * Accept a friend request that was sent to `viewerId` and notify the
 * original requester.
 *
 * Throws `FriendshipError` when there's no matching pending row, when
 * the viewer is the requester, or when the pair is blocked.
 */
export async function acceptFriendRequestAction(
  viewerId: string | Types.ObjectId,
  otherId: string | Types.ObjectId,
  options: AcceptFriendRequestActionOptions = {},
): Promise<FriendActionResult> {
  const viewer = asObjectId(viewerId);
  const other = asObjectId(otherId);
  const doc = await rawAccept(viewer, other);
  let notification: NotificationView | null = null;
  if (!options.skipNotification) {
    const actorName = await loadDisplayName(viewer);
    notification = await notifyFriendAccepted({
      recipientId: other,
      actorId: viewer,
      actorName,
    });
  }
  return { friendship: doc, notification };
}

export { FriendshipError };
