/**
 * Pure-function tests for gifts. The DB-side flow (rate-limit
 * enforcement under concurrency, redeem atomicity) belongs in an
 * integration test which is deferred — the rate-limit and
 * validation logic in send.ts is straightforward and unit-friendly.
 */
import { MAX_MESSAGE_LEN } from "@/lib/gifts/send";

describe("gift constants", () => {
  test("MAX_MESSAGE_LEN matches the schema CHECK", () => {
    expect(MAX_MESSAGE_LEN).toBe(280);
  });
});
