import { uuidv7, uuidv7Timestamp } from "@/lib/util/uuidv7";

describe("uuidv7", () => {
  test("produces a canonical UUID string", () => {
    const u = uuidv7();
    expect(u).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("version field is 7", () => {
    const u = uuidv7();
    expect(u[14]).toBe("7");
  });

  test("variant field is 10xx (one of 8/9/a/b)", () => {
    const u = uuidv7();
    expect(["8", "9", "a", "b"]).toContain(u[19]);
  });

  test("embedded timestamp is within ~50ms of Date.now()", () => {
    const before = Date.now();
    const u = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(u);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 50);
  });

  test("two consecutive UUIDs sort correctly by string compare", async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = uuidv7();
    expect(a < b).toBe(true);
  });

  test("1k UUIDs are all distinct", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(uuidv7());
    expect(set.size).toBe(1000);
  });
});
