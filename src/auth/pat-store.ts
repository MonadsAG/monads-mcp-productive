/**
 * Per-user Productive PAT storage in Workers KV (BYOT).
 *
 * - Keyed by the stable Entra `oid` (NFR-3) -- never email/UPN.
 * - Values are AES-256-GCM envelopes (see pat-crypto.ts); the plaintext PAT is
 *   never written to KV (DM-3) and never returned except to authorize a request.
 * - A user can only ever reach their own entry because the caller passes the
 *   `oid` from the verified request identity (NFR-4).
 */

import type { WorkerEnv } from '../config/worker-config.js';
import { decryptPat, encryptPat, type PatCipher } from './pat-crypto.js';

/** 90-day TTL for stored PATs (NFR-5). Refreshed on use and on rotation. */
const TTL_SECONDS = 90 * 24 * 60 * 60;

/** Full KV value: the crypto envelope plus non-secret bookkeeping metadata. */
export interface StoredPat extends PatCipher {
  createdAt: string;
  updatedAt: string;
}

/** Status surfaced on the settings page -- never includes the PAT value (FR-2). */
export interface PatStatus {
  set: boolean;
  createdAt?: string;
  updatedAt?: string;
}

async function readEnvelope(env: WorkerEnv, oid: string): Promise<StoredPat | null> {
  const raw = await env.USER_PAT_KV.get(oid);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredPat;
  } catch {
    return null;
  }
}

/**
 * Load and decrypt the user's PAT, or null if no PAT is stored OR the stored
 * envelope cannot be decrypted (e.g. PAT_ENC_KEY was rotated, or KV holds corrupt
 * data). Treating a decrypt failure as "no token" lets the request fall back to
 * the FR-9 "visit /settings" hint instead of hard-500-ing every call.
 *
 * The TTL is refreshed on each save/rotation (see putUserPat); we deliberately do
 * NOT rewrite the envelope on read -- a read-time rewrite would race a concurrent
 * rotation/delete (last-write-wins could resurrect a revoked token) and burn a KV
 * write on every request.
 */
export async function getUserPat(env: WorkerEnv, oid: string): Promise<string | null> {
  const envelope = await readEnvelope(env, oid);
  if (!envelope) return null;
  try {
    return await decryptPat(envelope, env.PAT_ENC_KEY);
  } catch {
    return null;
  }
}

/**
 * Encrypt and store (or atomically overwrite, for rotation FR-13) the user's PAT.
 * Preserves the original createdAt across rotations.
 */
export async function putUserPat(env: WorkerEnv, oid: string, pat: string): Promise<void> {
  const cipher = await encryptPat(pat, env.PAT_ENC_KEY);
  const existing = await readEnvelope(env, oid);
  const now = new Date().toISOString();
  const record: StoredPat = {
    ...cipher,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await env.USER_PAT_KV.put(oid, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
}

/** Remove the user's stored PAT (FR-5). */
export async function deleteUserPat(env: WorkerEnv, oid: string): Promise<void> {
  await env.USER_PAT_KV.delete(oid);
}

/** Report whether a PAT is stored and when it last changed -- without decrypting it. */
export async function getUserPatStatus(env: WorkerEnv, oid: string): Promise<PatStatus> {
  const envelope = await readEnvelope(env, oid);
  if (!envelope) return { set: false };
  return { set: true, createdAt: envelope.createdAt, updatedAt: envelope.updatedAt };
}
