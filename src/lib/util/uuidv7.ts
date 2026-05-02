/**
 * UUIDv7 — time-ordered UUIDs (RFC 9562 §5.7).
 *
 * Layout (128 bits, big-endian):
 *   - bits   0-47: unix_ts_ms (48-bit ms since epoch)
 *   - bits  48-51: version = 7
 *   - bits  52-63: rand_a (12 bits)
 *   - bits  64-65: variant = 10
 *   - bits  66-127: rand_b (62 bits)
 *
 * Why we ship our own:
 *   - The `uuid` v14 package is pure ESM; next/jest's SWC config doesn't
 *     transform node_modules without ceremony, and we hit it on Day 2/3.
 *   - 30-line dep avoidance.
 *   - PLAN.md mandates UUIDv7 for B-tree-friendly insert order on
 *     `events.id` etc.; rolling our own keeps that promise without
 *     wedging the test runner.
 */
import { randomBytes } from "node:crypto";

export function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());

  // 48-bit timestamp (big-endian) into bytes 0..5
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // version 7 in the high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // variant 10 in the high two bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Extract the embedded ms-precision timestamp from a UUIDv7 string.
 * Useful for diagnostics; production code should not rely on this for
 * anything beyond rough ordering.
 */
export function uuidv7Timestamp(uuid: string): number {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`not a UUID string: ${uuid}`);
  return Number(BigInt("0x" + hex.slice(0, 12)));
}
