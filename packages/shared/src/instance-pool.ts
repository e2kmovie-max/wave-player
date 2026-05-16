/**
 * Server-side helpers for the streaming-instance pool that aren't tied to the
 * INSTANCES_JSON env-sync flow. The bot admin and web admin use these to:
 *   - add instances by hand (`managedByEnv: false` so the env sync never
 *     overwrites them);
 *   - flip enabled/disabled;
 *   - delete admin-owned records;
 *   - return list views with health info.
 *
 * Env-owned records (`managedByEnv: true`) can be toggled enabled/disabled but
 * cannot be deleted from the admin panel — the source of truth is the env.
 */

import type { HydratedDocument } from "mongoose";
import { Instance, type InstanceDoc } from "./models/Instance";

export interface AddInstanceInput {
  name: string;
  url: string;
  secret: string;
  isLocal?: boolean;
  enabled?: boolean;
  maxStreams?: number;
}

export interface InstanceRecordView {
  id: string;
  name: string;
  url: string;
  isLocal: boolean;
  enabled: boolean;
  managedByEnv: boolean;
  isHealthy: boolean;
  lastHealthAt?: string;
  lastHealthError?: string;
  toolsYtDlp?: string;
  toolsFfmpeg?: string;
  activeStreams: number;
  maxStreams: number;
  /** Number of consecutive failed /health probes; 0 when last probe succeeded. */
  consecutiveFailures: number;
  /** Wall-clock start of the current failure streak (if any). */
  failingSince?: string;
  /** True when the URL is plain http:// — surfaced to the UI as a warning. */
  insecure: boolean;
}

export class InstancePoolError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "InstancePoolError";
  }
}

const URL_RE = /^https?:\/\/[^\s]+$/i;

export async function addAdminInstance(
  input: AddInstanceInput,
): Promise<HydratedDocument<InstanceDoc>> {
  const name = input.name.trim();
  const url = input.url.trim().replace(/\/$/, "");
  const secret = input.secret.trim();
  if (!name) throw new InstancePoolError("Instance name is required.");
  if (!URL_RE.test(url)) {
    throw new InstancePoolError("URL must start with http:// or https://");
  }
  if (!secret) throw new InstancePoolError("HMAC secret is required.");

  const existing = await Instance.findOne({ url });
  if (existing) {
    throw new InstancePoolError("An instance with this URL already exists.", 409);
  }

  return Instance.create({
    name,
    url,
    secret,
    isLocal: Boolean(input.isLocal),
    enabled: input.enabled !== false,
    managedByEnv: false,
    maxStreams: input.maxStreams && input.maxStreams > 0 ? input.maxStreams : 0,
  });
}

export async function listInstances(): Promise<InstanceRecordView[]> {
  const docs = await Instance.find()
    .sort({ enabled: -1, isHealthy: -1, name: 1 })
    .lean<
      Array<
        InstanceDoc & { _id: { toString(): string } }
      >
    >();
  return docs.map((doc) => ({
    id: String(doc._id),
    name: doc.name,
    url: doc.url,
    isLocal: Boolean(doc.isLocal),
    enabled: Boolean(doc.enabled),
    managedByEnv: Boolean(doc.managedByEnv),
    isHealthy: Boolean(doc.isHealthy),
    lastHealthAt: doc.lastHealthAt ? doc.lastHealthAt.toISOString() : undefined,
    lastHealthError: doc.lastHealthError || undefined,
    toolsYtDlp: doc.toolsYtDlp || undefined,
    toolsFfmpeg: doc.toolsFfmpeg || undefined,
    activeStreams: doc.activeStreams ?? 0,
    maxStreams: doc.maxStreams ?? 0,
    consecutiveFailures: doc.consecutiveFailures ?? 0,
    failingSince: doc.failingSince ? doc.failingSince.toISOString() : undefined,
    insecure: doc.url.startsWith("http://"),
  }));
}

export async function setInstanceEnabled(id: string, enabled: boolean): Promise<void> {
  await Instance.updateOne({ _id: id }, { $set: { enabled } });
}

/** Refuses to delete env-managed records — that source of truth is INSTANCES_JSON. */
export async function deleteAdminInstance(id: string): Promise<void> {
  const doc = await Instance.findById(id);
  if (!doc) return;
  if (doc.managedByEnv) {
    throw new InstancePoolError(
      "Cannot delete an env-managed instance. Remove it from INSTANCES_JSON instead.",
      409,
    );
  }
  await Instance.deleteOne({ _id: id });
}
