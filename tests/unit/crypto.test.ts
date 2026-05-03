/**
 * Round-trip tests for the AES-256-GCM helpers used to encrypt LLM
 * API keys at rest.
 */
import {
  _resetCryptoCacheForTests,
  decryptSecret,
  encryptSecret,
} from "@/lib/util/crypto";
import { _resetEnvCacheForTests } from "@/lib/util/env";

describe("encryptSecret / decryptSecret", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    _resetEnvCacheForTests();
    _resetCryptoCacheForTests();
  });

  it("round-trips a typical API key", () => {
    const key = "sk-ant-api03-abc123_def456-xyz";
    const ct = encryptSecret(key);
    expect(ct).not.toContain(key);
    expect(decryptSecret(ct)).toBe(key);
  });

  it("produces a fresh ciphertext each call (random IV)", () => {
    const a = encryptSecret("hello world");
    const b = encryptSecret("hello world");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("hello world");
    expect(decryptSecret(b)).toBe("hello world");
  });

  it("rejects tampered ciphertext via the GCM auth tag", () => {
    const ct = encryptSecret("secret-token");
    const parts = ct.split(".");
    // Flip one byte in the ciphertext payload.
    const ctBuf = Buffer.from(parts[2], "base64");
    ctBuf[0] ^= 0x01;
    const tampered = [parts[0], parts[1], ctBuf.toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects malformed packed strings", () => {
    expect(() => decryptSecret("not-three-parts")).toThrow();
    expect(() => decryptSecret("a.b")).toThrow();
  });

  it("fails when the SESSION_SECRET rotates underneath", () => {
    const ct = encryptSecret("yesterday-key");
    process.env.SESSION_SECRET =
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    _resetEnvCacheForTests();
    _resetCryptoCacheForTests();
    expect(() => decryptSecret(ct)).toThrow();
  });
});
