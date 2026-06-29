/**
 * AES-256-GCM encryption for per-user Productive PATs (BYOT).
 *
 * Each PAT is encrypted app-side under PAT_ENC_KEY (a dedicated Worker secret)
 * before it is written to KV. Cloudflare's at-rest KV encryption alone is not
 * treated as sufficient (NFR-1): a leaked KV binding does not expose usable
 * tokens without this separate secret.
 *
 * Web Crypto only -- no Node APIs -- so this runs in the Worker runtime.
 */

/** Descriptive algorithm name stored in the envelope (DM-2). */
const ALG = 'AES-256-GCM' as const;
/** Web Crypto algorithm identifier (256-bit is implied by the 32-byte key). */
const SUBTLE_ALG = 'AES-GCM' as const;
const IV_BYTES = 12; // GCM standard nonce length
const SCHEMA_VERSION = 1;

/** Crypto envelope produced by {@link encryptPat}; persisted inside the KV value. */
export interface PatCipher {
  v: number;
  alg: typeof ALG;
  iv: string; // base64, freshly generated per encryption
  ciphertext: string; // base64
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('PAT_ENC_KEY must be 64 hex characters (32 bytes)');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// PAT_ENC_KEY never changes for an isolate's lifetime, so import the CryptoKey
// once and reuse it across the per-request decrypts on the hot path.
const keyCache = new Map<string, Promise<CryptoKey>>();

function importAesKey(hexKey: string): Promise<CryptoKey> {
  let cached = keyCache.get(hexKey);
  if (!cached) {
    // hexToBytes throws synchronously on a malformed key; let that propagate
    // rather than caching a rejected import (a valid 32-byte import never rejects).
    cached = crypto.subtle.importKey('raw', hexToBytes(hexKey), { name: SUBTLE_ALG }, false, [
      'encrypt',
      'decrypt',
    ]);
    keyCache.set(hexKey, cached);
  }
  return cached;
}

/** Encrypt a plaintext PAT under the hex-encoded key. */
export async function encryptPat(plaintext: string, hexKey: string): Promise<PatCipher> {
  const key = await importAesKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: SUBTLE_ALG, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: SCHEMA_VERSION,
    alg: ALG,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/** Decrypt an envelope back to the plaintext PAT. Throws if the key/data is wrong. */
export async function decryptPat(cipher: PatCipher, hexKey: string): Promise<string> {
  const key = await importAesKey(hexKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: SUBTLE_ALG, iv: base64ToBytes(cipher.iv) },
    key,
    base64ToBytes(cipher.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
