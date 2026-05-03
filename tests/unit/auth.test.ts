import { hashPassword, verifyPassword } from "@/lib/session/auth";

describe("hashPassword + verifyPassword", () => {
  test("round-trips a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true,
    );
  });

  test("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  test("two hashes of the same password differ (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    // Both still verify.
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  test("rejects passwords shorter than 8 chars", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/8 characters/);
  });

  test("verifyPassword returns false for malformed stored hash", async () => {
    expect(await verifyPassword("any", "garbage")).toBe(false);
    expect(await verifyPassword("any", "")).toBe(false);
    expect(await verifyPassword("any", "scrypt$nope")).toBe(false);
    expect(await verifyPassword("any", "bcrypt$abc$def")).toBe(false);
  });
});
