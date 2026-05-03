/**
 * Rate-limit helper. Used by /api/chat/say to cap players at 10
 * messages/minute/session.
 */
import {
  _flushRateLimitForTests,
  checkRate,
  rateLimitState,
} from "@/lib/util/rate-limit";

beforeEach(() => {
  _flushRateLimitForTests();
});

describe("checkRate", () => {
  test("allows up to maxHits within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRate("k", 5, 60_000)).toBe(true);
    }
  });

  test("rejects past maxHits within the window", () => {
    for (let i = 0; i < 5; i++) checkRate("k", 5, 60_000);
    expect(checkRate("k", 5, 60_000)).toBe(false);
    expect(checkRate("k", 5, 60_000)).toBe(false);
  });

  test("recovers after the window passes", async () => {
    for (let i = 0; i < 3; i++) checkRate("k", 3, 50);
    expect(checkRate("k", 3, 50)).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(checkRate("k", 3, 50)).toBe(true);
  });

  test("buckets are per-key", () => {
    for (let i = 0; i < 3; i++) checkRate("a", 3, 60_000);
    expect(checkRate("a", 3, 60_000)).toBe(false);
    expect(checkRate("b", 3, 60_000)).toBe(true);
  });
});

describe("rateLimitState", () => {
  test("returns full capacity for a fresh key", () => {
    const s = rateLimitState("fresh", 10, 60_000);
    expect(s.allowed).toBe(10);
    expect(s.resetMs).toBe(0);
  });

  test("decrements as hits accrue", () => {
    checkRate("decay", 10, 60_000);
    checkRate("decay", 10, 60_000);
    const s = rateLimitState("decay", 10, 60_000);
    expect(s.allowed).toBe(8);
  });
});
