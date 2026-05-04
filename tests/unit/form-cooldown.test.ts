import {
  bulkCoolingDown,
  coolingDown,
  FORM_COOLDOWN_MS,
  FORM_COOLDOWN_RETENTION_MS,
  recordFormDeath,
} from "@/lib/forms/cooldown";

const NOW = Date.parse("2026-05-04T12:00:00Z");

describe("coolingDown", () => {
  test("empty deaths array → not cooling", () => {
    expect(coolingDown([], "lesser-slime", NOW)).toEqual({
      cooling: false,
      untilMs: null,
    });
  });

  test("recent death triggers 24h cooldown", () => {
    const oneHourAgo = NOW - 60 * 60 * 1000;
    const r = coolingDown(
      [{ formId: "lesser-slime", diedAt: new Date(oneHourAgo).toISOString() }],
      "lesser-slime",
      NOW,
    );
    expect(r.cooling).toBe(true);
    expect(r.untilMs).toBe(oneHourAgo + FORM_COOLDOWN_MS);
  });

  test("death older than 24h does not cool", () => {
    const longAgo = NOW - 25 * 60 * 60 * 1000;
    const r = coolingDown(
      [{ formId: "lesser-slime", diedAt: new Date(longAgo).toISOString() }],
      "lesser-slime",
      NOW,
    );
    expect(r.cooling).toBe(false);
  });

  test("different form not affected", () => {
    const r = coolingDown(
      [
        {
          formId: "lesser-slime",
          diedAt: new Date(NOW - 60_000).toISOString(),
        },
      ],
      "cursed-book",
      NOW,
    );
    expect(r.cooling).toBe(false);
  });

  test("most-recent death wins when there are multiple", () => {
    const old = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(NOW - 60_000).toISOString();
    const r = coolingDown(
      [
        { formId: "lesser-slime", diedAt: old },
        { formId: "lesser-slime", diedAt: fresh },
      ],
      "lesser-slime",
      NOW,
    );
    expect(r.cooling).toBe(true);
    expect(r.untilMs).toBe(Date.parse(fresh) + FORM_COOLDOWN_MS);
  });

  test("ignores entries with invalid timestamps", () => {
    const r = coolingDown(
      [{ formId: "lesser-slime", diedAt: "garbage" }],
      "lesser-slime",
      NOW,
    );
    expect(r.cooling).toBe(false);
  });
});

describe("recordFormDeath", () => {
  test("appends a fresh entry", () => {
    const t = new Date(NOW);
    const next = recordFormDeath([], "lesser-slime", t, NOW);
    expect(next).toHaveLength(1);
    expect(next[0].formId).toBe("lesser-slime");
    expect(next[0].diedAt).toBe(t.toISOString());
  });

  test("trims entries older than retention window", () => {
    const ancient = new Date(NOW - FORM_COOLDOWN_RETENTION_MS - 60_000).toISOString();
    const recent = new Date(NOW - 60 * 60 * 1000).toISOString();
    const next = recordFormDeath(
      [
        { formId: "x", diedAt: ancient },
        { formId: "y", diedAt: recent },
      ],
      "lesser-slime",
      new Date(NOW),
      NOW,
    );
    // Ancient is dropped; recent and the new entry remain.
    const ids = next.map((e) => e.formId).sort();
    expect(ids).toEqual(["lesser-slime", "y"]);
  });
});

describe("bulkCoolingDown", () => {
  test("returns one entry per requested formId", () => {
    const fresh = new Date(NOW - 60_000).toISOString();
    const r = bulkCoolingDown(
      [{ formId: "lesser-slime", diedAt: fresh }],
      ["lesser-slime", "cursed-book", "dragon-egg"],
      NOW,
    );
    expect(r["lesser-slime"].cooling).toBe(true);
    expect(r["cursed-book"].cooling).toBe(false);
    expect(r["dragon-egg"].cooling).toBe(false);
  });
});
