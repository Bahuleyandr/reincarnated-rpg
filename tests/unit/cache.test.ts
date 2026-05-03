/**
 * In-memory TTL cache. Used by public read endpoints to absorb
 * polling load.
 */
import {
  _flushCacheForTests,
  cached,
  invalidate,
  invalidatePrefix,
} from "@/lib/util/cache";

beforeEach(() => {
  _flushCacheForTests();
});

describe("cached", () => {
  test("calls fetcher only once within TTL", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return 42;
    };
    const a = await cached("k1", 60_000, fetcher);
    const b = await cached("k1", 60_000, fetcher);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });

  test("calls fetcher again after expiry", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls;
    };
    const a = await cached("k2", 1, fetcher);
    expect(a).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    const b = await cached("k2", 1, fetcher);
    expect(b).toBe(2);
    expect(calls).toBe(2);
  });

  test("different keys are independent", async () => {
    const a = await cached("k3", 60_000, async () => "a");
    const b = await cached("k4", 60_000, async () => "b");
    expect(a).toBe("a");
    expect(b).toBe("b");
  });

  test("invalidate forces re-fetch", async () => {
    let calls = 0;
    const fetcher = async () => ++calls;
    await cached("k5", 60_000, fetcher);
    invalidate("k5");
    await cached("k5", 60_000, fetcher);
    expect(calls).toBe(2);
  });

  test("invalidatePrefix drops all matching keys", async () => {
    let calls = 0;
    const fetcher = async () => ++calls;
    await cached("meta:state", 60_000, fetcher);
    await cached("meta:other", 60_000, fetcher);
    await cached("lore:list", 60_000, fetcher);
    invalidatePrefix("meta:");
    await cached("meta:state", 60_000, fetcher);
    await cached("meta:other", 60_000, fetcher);
    await cached("lore:list", 60_000, fetcher);
    // 3 first-misses + 2 invalidated re-fetches = 5
    expect(calls).toBe(5);
  });
});
