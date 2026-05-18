import { z } from "zod";

/**
 * Validated, type-safe access to environment variables shared across apps.
 *
 * Each app extends this with its own additional vars where needed.
 */

/**
 * Sentinel APP_SECRET used for local development. Exported so callers and
 * tests can recognise the unsafe default without hard-coding the literal.
 * Production deployments must override it; [getEnv] enforces this whenever
 * NODE_ENV === "production" unless WAVE_ALLOW_INSECURE_APP_SECRET=1 is set
 * (escape hatch for one-off scripts, never for the running service).
 */
export const DEV_APP_SECRET = "dev-only-app-secret-replace-me-please";

const baseSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1)
    .default("mongodb://wave:wave@localhost:27017/wave?authSource=admin"),
  APP_SECRET: z.string().min(16).default(DEV_APP_SECRET),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),

  BOT_TOKEN: z.string().optional().default(""),
  BOT_USERNAME: z.string().optional().default(""),

  ADMIN_TELEGRAM_IDS: z
    .string()
    .optional()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n)),
    ),

  /**
   * Comma-separated list of Google account emails that should have admin
   * access to the web admin panel. Empty by default — the web admin is
   * disabled in that case. Bot admins are configured separately via
   * ADMIN_TELEGRAM_IDS.
   */
  ADMIN_GOOGLE_EMAILS: z
    .string()
    .optional()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    ),

  /**
   * Optional JSON array of streaming instances to upsert into Mongo on master
   * startup. Each entry must have `name`, `url`, and `secret`; `isLocal` is
   * optional. Admin-added instances (those without `managedByEnv:true`) are
   * never overwritten by this sync.
   *
   * Example:
   *   INSTANCES_JSON='[{"name":"local","url":"http://localhost:8080","secret":"..."}]'
   */
  INSTANCES_JSON: z.string().optional().default(""),

  /** How often the master pings each instance's /health (seconds). */
  INSTANCE_HEALTH_INTERVAL_SECONDS: z
    .string()
    .optional()
    .default("15")
    .transform((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : 15;
    }),

  /** Per-instance HTTP timeout for /health (milliseconds). */
  INSTANCE_HEALTH_TIMEOUT_MS: z
    .string()
    .optional()
    .default("5000")
    .transform((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : 5000;
    }),
});

export type WaveEnv = z.infer<typeof baseSchema>;

let cached: WaveEnv | null = null;

export function getEnv(): WaveEnv {
  if (cached) return cached;
  const parsed = baseSchema.safeParse(process.env);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const fieldErrors = JSON.stringify(flat.fieldErrors, null, 2);
    throw new Error(`Invalid environment variables:\n${fieldErrors}`);
  }
  // Hard guard: never ship the dev-only sentinel secret in production. With
  // it, AES-GCM cookie storage and HMAC session tokens collapse to "anyone
  // who can read the source can decrypt them" — there is no in-between.
  const isProd = (process.env.NODE_ENV ?? "").toLowerCase() === "production";
  const allowInsecure = process.env.WAVE_ALLOW_INSECURE_APP_SECRET === "1";
  if (isProd && !allowInsecure && parsed.data.APP_SECRET === DEV_APP_SECRET) {
    throw new Error(
      "APP_SECRET is set to the dev-only default in production. " +
        "Generate a strong secret (e.g. openssl rand -hex 32) and set it on the deploy environment.",
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test-only — drops the memoised env so tests can re-parse process.env. */
export function __resetEnvCacheForTests(): void {
  cached = null;
}

export function isGoogleOAuthConfigured(env = getEnv()): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function isBotConfigured(env = getEnv()): boolean {
  return Boolean(env.BOT_TOKEN);
}
