/**
 * Symmetric encryption for at-rest secrets (LLM API keys today; reusable
 * for any short string we need to round-trip through the database).
 *
 * AES-256-GCM, key derived from SESSION_SECRET via HKDF-SHA-256 with a
 * domain-separator label so the same SESSION_SECRET key isn't reused
 * elsewhere by accident.
 *
 * Storage shape (base64 strings, joined with '.'): `${ivB64}.${tagB64}.${ctB64}`
 *   - iv:  12 random bytes (GCM standard)
 *   - tag: 16-byte auth tag
 *   - ct:  the ciphertext
 *
 * If SESSION_SECRET ever rotates, ciphertext written under the old
 * secret cannot be decrypted — design choice: we fail closed and force
 * the user to re-enter their key. (We do NOT keep historical secrets.)
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { env } from "./env";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HKDF_INFO = "reincarnated-rpg/llm-api-key/v1";

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = env().SESSION_SECRET;
  // HKDF needs a salt; we use a fixed domain-separator label so the
  // derivation is deterministic across restarts.
  const salt = Buffer.from("reincarnated-rpg/at-rest-encryption", "utf8");
  const ikm = Buffer.from(secret, "utf8");
  const okm = hkdfSync("sha256", ikm, salt, HKDF_INFO, KEY_LENGTH);
  cachedKey = Buffer.from(okm);
  return cachedKey;
}

/** Encrypt a UTF-8 string. Returns `iv.tag.ct` base64 form for storage. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

/** Decrypt a string produced by encryptSecret. Throws on tamper / wrong key. */
export function decryptSecret(packed: string): string {
  const parts = packed.split(".");
  if (parts.length !== 3) {
    throw new Error("decryptSecret: malformed packed string");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error("decryptSecret: iv/tag wrong length");
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/** Test-only: clear cached derived key so a new SESSION_SECRET takes effect. */
export function _resetCryptoCacheForTests(): void {
  cachedKey = null;
}
