/**
 * Retry helper — sanity check on retryable-error detection and backoff.
 */
import { isRetryableError, withRetry } from "@/lib/util/retry";

describe("isRetryableError", () => {
  it("retries on 429/503/504", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 504 })).toBe(true);
  });
  it("does not retry on 4xx user errors", () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 404 })).toBe(false);
  });
  it("retries on common network codes", () => {
    expect(isRetryableError({ code: "ECONNRESET" })).toBe(true);
    expect(isRetryableError({ code: "ETIMEDOUT" })).toBe(true);
  });
  it("retries on bare fetch failures", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
  });
  it("retries on parsed OpenAI-compatible API errors", () => {
    expect(
      isRetryableError(new Error("OpenAI-compatible API 503: oops")),
    ).toBe(true);
    expect(
      isRetryableError(new Error("OpenAI-compatible API 401: bad key")),
    ).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const r = await withRetry(() => {
      calls++;
      return Promise.resolve(42);
    });
    expect(r).toBe(42);
    expect(calls).toBe(1);
  });

  it("retries once on retryable error", async () => {
    let calls = 0;
    const r = await withRetry(
      () => {
        calls++;
        if (calls === 1) {
          const e = new Error("503") as Error & { status: number };
          e.status = 503;
          throw e;
        }
        return Promise.resolve("ok");
      },
      { baseDelayMs: 1, jitterMs: 0 },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retry on non-retryable", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          const e = new Error("401") as Error & { status: number };
          e.status = 401;
          throw e;
        },
        { baseDelayMs: 1, jitterMs: 0 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          const e = new Error("503") as Error & { status: number };
          e.status = 503;
          throw e;
        },
        { maxRetries: 2, baseDelayMs: 1, jitterMs: 0 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(3); // first + 2 retries
  });
});
