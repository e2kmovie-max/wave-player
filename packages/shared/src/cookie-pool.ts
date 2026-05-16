/**
 * Server-side helpers around the GoogleAccount cookie pool.
 *
 * These wrap the raw Mongoose model so the bot admin and the web admin route
 * handlers share the same parsing + validation rules. Cookies are encrypted
 * at rest via `encrypt()` from `./crypto`; plaintext only flows through
 * shared/`loadYtDlpCredentials` when a request needs to ship cookies to an
 * instance.
 */

import type { HydratedDocument } from "mongoose";
import { encrypt } from "./crypto";
import { GoogleAccount, type GoogleAccountDoc } from "./models/GoogleAccount";
import { parseCookiePayload } from "./cookie-payload";

export interface AddCookiesInput {
  /** Short admin-visible label. Required. */
  label: string;
  /** Optional email of the underlying Google account. */
  email?: string;
  /** Raw payload — Netscape `cookies.txt` content or a JSON array. */
  rawPayload: string;
  /** Optional User-Agent override (kept alongside the cookies). */
  userAgent?: string;
  /** Optional admin notes. */
  notes?: string;
}

export interface CookieRecordView {
  id: string;
  label: string;
  email?: string;
  disabled: boolean;
  disabledReason?: string;
  /** True when the master auto-disabled the record after a rotatable error. */
  autoDisabled: boolean;
  autoDisabledAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  /** Total number of times this record was rotated out of the pool. */
  rotationCount: number;
  hasUserAgent: boolean;
  hasNotes: boolean;
  createdAt: string;
  updatedAt: string;
}

export class CookiePoolError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CookiePoolError";
  }
}

/**
 * Validate + encrypt + insert. Throws CookiePoolError(400) when the payload
 * cannot be parsed so the caller can surface the message verbatim.
 */
export async function addCookieAccount(
  input: AddCookiesInput,
): Promise<HydratedDocument<GoogleAccountDoc>> {
  const label = input.label.trim();
  if (!label) throw new CookiePoolError("Label is required.");

  const rawPayload = input.rawPayload.trim();
  if (!rawPayload) throw new CookiePoolError("Cookie payload is empty.");

  let parsedCount: number;
  try {
    parsedCount = parseCookiePayload(rawPayload).length;
  } catch (err) {
    throw new CookiePoolError(`Cookie payload is invalid: ${(err as Error).message}`);
  }
  if (parsedCount === 0) {
    throw new CookiePoolError("Cookie payload did not yield any usable cookies.");
  }

  const doc = await GoogleAccount.create({
    label,
    email: input.email?.trim() || undefined,
    cookiesEncrypted: encrypt(rawPayload),
    userAgent: input.userAgent?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  });
  return doc;
}

export async function listCookieAccounts(): Promise<CookieRecordView[]> {
  const docs = await GoogleAccount.find().sort({ disabled: 1, lastUsedAt: 1, createdAt: 1 }).lean<
    Array<
      GoogleAccountDoc & {
        _id: { toString(): string };
        createdAt?: Date;
        updatedAt?: Date;
      }
    >
  >();
  return docs.map((doc) => ({
    id: String(doc._id),
    label: doc.label,
    email: doc.email ?? undefined,
    disabled: Boolean(doc.disabled),
    disabledReason: doc.disabledReason ?? undefined,
    autoDisabled: Boolean(doc.autoDisabled),
    autoDisabledAt: doc.autoDisabledAt ? doc.autoDisabledAt.toISOString() : undefined,
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : undefined,
    usageCount: doc.usageCount ?? 0,
    rotationCount: doc.rotationCount ?? 0,
    hasUserAgent: Boolean(doc.userAgent),
    hasNotes: Boolean(doc.notes),
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
  }));
}

export async function setCookieAccountDisabled(
  id: string,
  disabled: boolean,
  reason?: string,
): Promise<void> {
  if (disabled) {
    await GoogleAccount.updateOne(
      { _id: id },
      {
        $set: {
          disabled: true,
          disabledAt: new Date(),
          disabledReason: reason?.trim() || "manually disabled",
          autoDisabled: false,
        },
      },
    );
  } else {
    // Re-enabling clears the auto-disable bookkeeping so the next failure
    // can be reported cleanly.
    await GoogleAccount.updateOne(
      { _id: id },
      {
        $set: {
          disabled: false,
          autoDisabled: false,
        },
        $unset: { disabledAt: "", disabledReason: "", autoDisabledAt: "" },
      },
    );
  }
}

/**
 * Auto-disable a cookie record after the master detects a rotatable error
 * (bot_detected / captcha / login_required / forbidden / rate_limited).
 *
 * Sets `disabled=true`, `autoDisabled=true`, records the reason, and bumps
 * `rotationCount`. Admins can later re-enable the record without losing the
 * audit trail — the reason is preserved.
 */
export async function markCookieAccountAutoDisabled(
  id: string,
  reason: string,
): Promise<void> {
  await GoogleAccount.updateOne(
    { _id: id },
    {
      $set: {
        disabled: true,
        autoDisabled: true,
        disabledAt: new Date(),
        autoDisabledAt: new Date(),
        disabledReason: `auto: ${reason}`,
      },
      $inc: { rotationCount: 1 },
    },
  );
}

export async function deleteCookieAccount(id: string): Promise<void> {
  await GoogleAccount.deleteOne({ _id: id });
}
