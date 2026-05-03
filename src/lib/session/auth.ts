/**
 * Password hashing + verification using Node's `crypto.scrypt`.
 * No bcrypt dep needed.
 *
 * Stored format: `scrypt$<salt-hex>$<hash-hex>`. Salt is 16 bytes,
 * hash is 64 bytes. Verification is constant-time
 * (`crypto.timingSafeEqual`) so we don't leak whether the user
 * exists vs whether the password's wrong via timing.
 */
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const HASH_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, HASH_BYTES);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (typeof password !== "string" || typeof stored !== "string") {
    return false;
  }
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  let salt: Buffer;
  let expectedHash: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expectedHash = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expectedHash.length !== HASH_BYTES) return false;
  const actualHash = await scrypt(password, salt, HASH_BYTES);
  return timingSafeEqual(expectedHash, actualHash);
}
