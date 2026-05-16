import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A pool of Google accounts whose YouTube cookies (Netscape `cookies.txt`
 * format) are used by yt-dlp on the streaming instances. Cookies are
 * encrypted at rest using APP_SECRET-derived AES-256-GCM (see crypto.ts);
 * the ciphertext is what's stored here. We only ever ship the plaintext to
 * an instance over HTTPS (or HTTP for self-hosted local instances) inside
 * the request body — never persisting it on the instance.
 *
 * Rotation is handled by services/cookie-rotator (Stage 4): we pick the
 * least-recently-used enabled account, increment usage, and disable on
 * captcha/ban responses.
 */
const googleAccountSchema = new Schema(
  {
    label: { type: String, required: true },
    email: { type: String },

    /** AES-256-GCM ciphertext of the Netscape cookies.txt content. */
    cookiesEncrypted: { type: String, required: true },

    /** Optional encrypted user-agent override to keep cookies "warm". */
    userAgent: { type: String },

    lastUsedAt: { type: Date },
    usageCount: { type: Number, default: 0 },

    disabled: { type: Boolean, default: false },
    disabledAt: { type: Date },
    disabledReason: { type: String },

    /**
     * True when the master auto-disabled the record on a rotatable instance
     * error (bot_detected / captcha / login_required / forbidden /
     * rate_limited). Admins can re-enable from /admin without losing the
     * audit trail in `disabledReason`.
     */
    autoDisabled: { type: Boolean, default: false },
    /** UNIX timestamp of the most recent auto-disable, for admin diagnostics. */
    autoDisabledAt: { type: Date },
    /** Total number of times the master rotated away from this record. */
    rotationCount: { type: Number, default: 0 },

    notes: { type: String },
  },
  { timestamps: true },
);

export type GoogleAccountDoc = InferSchemaType<typeof googleAccountSchema>;
export type GoogleAccountModel = Model<GoogleAccountDoc>;

export const GoogleAccount: GoogleAccountModel =
  (models.GoogleAccount as GoogleAccountModel) ??
  model<GoogleAccountDoc>("GoogleAccount", googleAccountSchema);
