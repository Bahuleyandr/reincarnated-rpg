/**
 * Weekly theme rotation. ISO week is deterministic; given the same
 * Date on any server, the same theme resolves.
 */
import {
  activeTheme,
  findTheme,
  isoWeekNumber,
  themeForDate,
  WEEKLY_THEMES,
} from "@/lib/world/weekly-theme";
import type { MetaArc } from "@/lib/db/schema";

describe("isoWeekNumber", () => {
  test("week 1 of 2026", () => {
    // 2026-01-05 is the first Monday of week 2 (2026-01-04 is Sunday
    // of week 1; ISO weeks start Monday). Spot-check a few:
    expect(isoWeekNumber(new Date("2026-01-05T12:00:00Z"))).toBe(2);
    expect(isoWeekNumber(new Date("2026-01-12T12:00:00Z"))).toBe(3);
    expect(isoWeekNumber(new Date("2026-12-28T12:00:00Z"))).toBe(53);
  });

  test("year boundaries", () => {
    // 2027-01-04 is Monday of week 1 in 2027.
    expect(isoWeekNumber(new Date("2027-01-04T12:00:00Z"))).toBe(1);
  });
});

describe("themeForDate", () => {
  test("is deterministic — same date returns same theme", () => {
    const d = new Date("2026-05-01T00:00:00Z");
    expect(themeForDate(d).id).toBe(themeForDate(d).id);
  });

  test("rotates across weeks", () => {
    const seen = new Set<string>();
    for (let w = 0; w < 20; w++) {
      const d = new Date("2026-01-01T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + w * 7);
      seen.add(themeForDate(d).id);
    }
    // Across 20 weeks we should see at least 4 distinct themes from
    // the rotation (which excludes default-week).
    expect(seen.size).toBeGreaterThanOrEqual(4);
    // default-week is the anchor and never returned.
    expect(seen.has("default-week")).toBe(false);
  });

  test("never returns the default-week anchor", () => {
    for (let w = 0; w < 60; w++) {
      const d = new Date("2026-01-01T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + w * 7);
      expect(themeForDate(d).id).not.toBe("default-week");
    }
  });
});

describe("activeTheme", () => {
  test("returns the rotation theme when no override", () => {
    expect(activeTheme(null).id).not.toBe("default-week");
  });

  test("honors admin override stored in arc.meta.themeOverride", () => {
    const arc = {
      meta: { themeOverride: "the-hungry-wyrm" },
    } as unknown as MetaArc;
    const t = activeTheme(arc);
    expect(t.id).toBe("the-hungry-wyrm");
    expect(t.feedMultiplier).toBe(2.0);
  });

  test("falls through to rotation when override id is unknown", () => {
    const arc = {
      meta: { themeOverride: "does-not-exist" },
    } as unknown as MetaArc;
    expect(activeTheme(arc).id).not.toBe("default-week");
  });
});

describe("findTheme", () => {
  test("returns each catalog entry by id", () => {
    for (const t of WEEKLY_THEMES) {
      expect(findTheme(t.id)?.id).toBe(t.id);
    }
  });

  test("returns undefined for unknown ids", () => {
    expect(findTheme("does-not-exist")).toBeUndefined();
  });
});

describe("theme catalog shape", () => {
  test("each theme has the required keys", () => {
    for (const t of WEEKLY_THEMES) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.label).toBe("string");
      expect(typeof t.feedMultiplier).toBe("number");
      expect(typeof t.starveMultiplier).toBe("number");
      expect(t.feedMultiplier).toBeGreaterThanOrEqual(0);
      expect(t.starveMultiplier).toBeGreaterThanOrEqual(0);
    }
  });

  test("multipliers are bounded reasonably", () => {
    for (const t of WEEKLY_THEMES) {
      expect(t.feedMultiplier).toBeLessThanOrEqual(3);
      expect(t.starveMultiplier).toBeLessThanOrEqual(3);
    }
  });
});
