/**
 * Master-side bookkeeping for streaming instances.
 *
 * `syncInstancesFromEnv` reads `INSTANCES_JSON`, validates it, and upserts
 * each entry into the `instances` collection (marking it `managedByEnv:true`).
 * Records added through the future admin panel never carry that flag, and so
 * are never overwritten or removed by this sync.
 *
 * `startInstanceHealthLoop` kicks off a background `setInterval` that pings
 * each instance's `/health` and updates `isHealthy`, `lastHealthAt`,
 * `lastHealthError`, and the reported tool versions.
 */

import { z } from "zod";
import { Instance, type InstanceDoc } from "./models/Instance";
import { InstanceClient, InstanceError } from "./instance-client";

const envInstanceSchema = z.object({
  name: z.string().min(1),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), "url must be http(s)"),
  secret: z.string().min(1),
  isLocal: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  maxStreams: z.number().int().nonnegative().optional().default(0),
});

export type EnvInstance = z.infer<typeof envInstanceSchema>;

export function parseInstancesJson(raw: string): EnvInstance[] {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`INSTANCES_JSON is not valid JSON: ${(err as Error).message}`);
  }
  const result = z.array(envInstanceSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(`INSTANCES_JSON failed validation: ${result.error.message}`);
  }
  return result.data;
}

export interface SyncReport {
  upserted: number;
  unchanged: number;
  skippedAdminOwned: number;
  totalEnv: number;
}

/**
 * Upsert each env-defined instance, refusing to overwrite admin-owned records.
 *
 * Matching rule: an env entry matches an existing record if and only if both
 * the existing record has `managedByEnv:true` AND its `name` equals the env
 * entry's name. Anything else (admin-added record with the same name, or a
 * different name) is left untouched and a warning is returned.
 */
export async function syncInstancesFromEnv(raw: string): Promise<SyncReport> {
  const envEntries = parseInstancesJson(raw);
  const report: SyncReport = {
    upserted: 0,
    unchanged: 0,
    skippedAdminOwned: 0,
    totalEnv: envEntries.length,
  };

  for (const e of envEntries) {
    const existing = await Instance.findOne({ name: e.name });
    if (existing && !existing.managedByEnv) {
      report.skippedAdminOwned += 1;
      continue;
    }
    const changed =
      !existing ||
      existing.url !== e.url ||
      existing.secret !== e.secret ||
      Boolean(existing.isLocal) !== e.isLocal ||
      Boolean(existing.enabled) !== e.enabled ||
      (existing.maxStreams ?? 0) !== e.maxStreams;
    await Instance.updateOne(
      { name: e.name },
      {
        $set: {
          name: e.name,
          url: e.url,
          secret: e.secret,
          isLocal: e.isLocal,
          enabled: e.enabled,
          maxStreams: e.maxStreams,
          managedByEnv: true,
        },
      },
      { upsert: true },
    );
    if (changed) report.upserted += 1;
    else report.unchanged += 1;
  }
  return report;
}

export interface HealthLoopOptions {
  intervalSeconds: number;
  timeoutMs: number;
  log?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * Starts a background loop that pings every enabled instance's /health and
 * writes the result back to its Mongo doc. Returns a function that stops the
 * loop on next-tick.
 *
 * Exposed primarily so it can be exercised from a Next.js instrumentation
 * hook; tests can call `pingInstance` directly for unit coverage.
 */
export function startInstanceHealthLoop(opts: HealthLoopOptions): () => void {
  const log = opts.log ?? console;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    let docs: InstanceDoc[] = [];
    try {
      docs = await Instance.find({ enabled: true }).lean();
    } catch (err) {
      log.error("[wave] instance health: failed to query instances:", err);
      return;
    }
    await Promise.all(
      docs.map((doc) =>
        pingInstance(doc, opts.timeoutMs).catch((err: unknown) => {
          log.error(`[wave] instance health: ping crashed for ${doc.name}:`, err);
        }),
      ),
    );
  };

  const handle = setInterval(tick, opts.intervalSeconds * 1_000);
  // Run once immediately so the master has data before the first interval.
  void tick();

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

/**
 * Single-instance health probe: hits /health and writes the outcome. Exposed
 * for tests + manual diagnostics; production calls it through the loop.
 */
export async function pingInstance(doc: InstanceDoc, timeoutMs: number): Promise<void> {
  const id = (doc as unknown as { _id: unknown })._id;
  const client = new InstanceClient({ url: doc.url, secret: doc.secret });
  try {
    const h = await client.health({ timeoutMs });
    await Instance.updateOne(
      { _id: id },
      {
        $set: {
          isHealthy: Boolean(h.ok),
          lastHealthAt: new Date(),
          activeStreams: h.activeStreams ?? 0,
          toolsYtDlp: h.tools?.ytDlp ?? undefined,
          toolsFfmpeg: h.tools?.ffmpeg ?? undefined,
          consecutiveFailures: 0,
        },
        $unset: { lastHealthError: "", failingSince: "" },
      },
    );
  } catch (err) {
    const message =
      err instanceof InstanceError
        ? `${err.message} (status=${err.status})`
        : (err as Error).message;
    // We want to know how many consecutive failures we have so the admin UI
    // can surface it. Use findOneAndUpdate with $inc + $setOnInsert-style
    // bookkeeping for failingSince.
    const fresh = await Instance.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          isHealthy: false,
          lastHealthAt: new Date(),
          lastHealthError: message,
        },
        $inc: { consecutiveFailures: 1 },
      },
      { new: true },
    );
    if (fresh && !fresh.failingSince) {
      await Instance.updateOne(
        { _id: id },
        { $set: { failingSince: new Date() } },
      );
    }
  }
}

/**
 * Summary of all known streaming instances, suitable for serving from
 * `/api/admin/health` or feeding a Prometheus textfile collector.
 */
export interface HealthSummary {
  total: number;
  enabled: number;
  healthy: number;
  failing: number;
  /** Total active streams across the pool. */
  activeStreams: number;
  /** Per-instance breakdown, sorted enabled/healthy first. */
  instances: Array<{
    id: string;
    name: string;
    url: string;
    isLocal: boolean;
    enabled: boolean;
    isHealthy: boolean;
    managedByEnv: boolean;
    consecutiveFailures: number;
    failingSince?: string;
    lastHealthAt?: string;
    lastHealthError?: string;
    toolsYtDlp?: string;
    toolsFfmpeg?: string;
    activeStreams: number;
    maxStreams: number;
  }>;
}

export async function collectInstanceHealth(): Promise<HealthSummary> {
  const docs = await Instance.find()
    .sort({ enabled: -1, isHealthy: -1, name: 1 })
    .lean<Array<InstanceDoc & { _id: { toString(): string } }>>();
  const summary: HealthSummary = {
    total: docs.length,
    enabled: 0,
    healthy: 0,
    failing: 0,
    activeStreams: 0,
    instances: [],
  };
  for (const doc of docs) {
    if (doc.enabled) summary.enabled += 1;
    if (doc.isHealthy) summary.healthy += 1;
    else if (doc.enabled) summary.failing += 1;
    summary.activeStreams += doc.activeStreams ?? 0;
    summary.instances.push({
      id: String(doc._id),
      name: doc.name,
      url: doc.url,
      isLocal: Boolean(doc.isLocal),
      enabled: Boolean(doc.enabled),
      isHealthy: Boolean(doc.isHealthy),
      managedByEnv: Boolean(doc.managedByEnv),
      consecutiveFailures: doc.consecutiveFailures ?? 0,
      failingSince: doc.failingSince ? doc.failingSince.toISOString() : undefined,
      lastHealthAt: doc.lastHealthAt ? doc.lastHealthAt.toISOString() : undefined,
      lastHealthError: doc.lastHealthError || undefined,
      toolsYtDlp: doc.toolsYtDlp || undefined,
      toolsFfmpeg: doc.toolsFfmpeg || undefined,
      activeStreams: doc.activeStreams ?? 0,
      maxStreams: doc.maxStreams ?? 0,
    });
  }
  return summary;
}
