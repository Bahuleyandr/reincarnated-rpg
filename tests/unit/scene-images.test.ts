import {
  capForTier,
  checkBudget,
  monthKey,
  SCENE_IMAGE_FREE_CAP,
  SCENE_IMAGE_PATRON_CAP,
  SCENE_IMAGE_SUPPORTER_CAP,
} from "@/lib/images/caps";
import { detectSceneTriggers } from "@/lib/images/triggers";
import type { Event } from "@/lib/game/types";

describe("monthKey", () => {
  test("UTC year-month formatted correctly", () => {
    expect(monthKey(new Date("2026-05-04T12:00:00Z"))).toBe("2026-05");
  });
  test("zero-pads single-digit months", () => {
    expect(monthKey(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
  });
  test("rolls at UTC month boundary", () => {
    expect(monthKey(new Date("2026-04-30T23:59:59Z"))).toBe("2026-04");
    expect(monthKey(new Date("2026-05-01T00:00:00Z"))).toBe("2026-05");
  });
});

describe("capForTier", () => {
  test("free is 0 (toggle persists, generation blocked)", () => {
    expect(capForTier("free")).toBe(SCENE_IMAGE_FREE_CAP);
    expect(capForTier("free")).toBe(0);
  });
  test("supporter is 50", () => {
    expect(capForTier("supporter")).toBe(SCENE_IMAGE_SUPPORTER_CAP);
  });
  test("patron is 250", () => {
    expect(capForTier("patron")).toBe(SCENE_IMAGE_PATRON_CAP);
  });
  test("unknown tier defaults to free cap", () => {
    expect(capForTier("xyz")).toBe(0);
  });
});

describe("checkBudget", () => {
  const now = new Date("2026-05-04T12:00:00Z");
  test("disabled user → not allowed regardless of tier/count", () => {
    const r = checkBudget(
      { enabled: "false", count: 0, monthKey: "2026-05", tier: "patron" },
      now,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("disabled");
  });
  test("free tier → not allowed even when enabled", () => {
    const r = checkBudget(
      { enabled: "true", count: 0, monthKey: "2026-05", tier: "free" },
      now,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("tier_zero");
  });
  test("supporter under cap → allowed", () => {
    const r = checkBudget(
      { enabled: "true", count: 5, monthKey: "2026-05", tier: "supporter" },
      now,
    );
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("ok");
    expect(r.cap).toBe(50);
    expect(r.used).toBe(5);
  });
  test("supporter at cap → not allowed", () => {
    const r = checkBudget(
      { enabled: "true", count: 50, monthKey: "2026-05", tier: "supporter" },
      now,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("monthly_cap");
  });
  test("month rolled over → reset signaled, count starts fresh", () => {
    const r = checkBudget(
      { enabled: "true", count: 50, monthKey: "2026-04", tier: "supporter" },
      now,
    );
    expect(r.resetCount).toBe(true);
    expect(r.used).toBe(0);
    expect(r.allowed).toBe(true);
  });
  test("patron under cap → allowed", () => {
    const r = checkBudget(
      { enabled: "true", count: 100, monthKey: "2026-05", tier: "patron" },
      now,
    );
    expect(r.allowed).toBe(true);
    expect(r.cap).toBe(250);
  });
  test("null monthKey → resetCount triggered", () => {
    const r = checkBudget(
      { enabled: "true", count: 10, monthKey: null, tier: "supporter" },
      now,
    );
    expect(r.resetCount).toBe(true);
  });
});

describe("detectSceneTriggers", () => {
  const ctx = {
    formId: "lesser-slime",
    locationId: "collapsed-tunnel",
    reincarnatedAs: null,
    turn: 1,
  };

  test("turn 1 fires the awakening trigger", () => {
    const triggers = detectSceneTriggers([], false, ctx);
    expect(triggers.some((t) => t.trigger === "awakening")).toBe(true);
    const awake = triggers.find((t) => t.trigger === "awakening")!;
    expect(awake.prompt).toMatch(/lesser slime/i);
    expect(awake.prompt).toMatch(/collapsed tunnel/i);
  });

  test("turn 2+ does NOT fire awakening", () => {
    const triggers = detectSceneTriggers([], false, { ...ctx, turn: 5 });
    expect(triggers.some((t) => t.trigger === "awakening")).toBe(false);
  });

  test("first npc.introduced in a session fires first_npc", () => {
    const events: Event[] = [
      {
        kind: "npc.introduced",
        npcId: "n1",
        data: { name: "Kethra" },
      },
    ];
    const triggers = detectSceneTriggers(events, false, { ...ctx, turn: 3 });
    expect(triggers.some((t) => t.trigger === "first_npc")).toBe(true);
    const fn = triggers.find((t) => t.trigger === "first_npc")!;
    expect(fn.prompt).toMatch(/Kethra/);
  });

  test("npc fires only when hasNpcsAlready is false (subsequent turns skip)", () => {
    const events: Event[] = [
      { kind: "npc.introduced", npcId: "n2", data: { name: "Halrik" } },
    ];
    const triggers = detectSceneTriggers(events, true, { ...ctx, turn: 3 });
    expect(triggers.some((t) => t.trigger === "first_npc")).toBe(false);
  });

  test("session.ended death fires death trigger", () => {
    const events: Event[] = [{ kind: "session.ended", reason: "death" }];
    const triggers = detectSceneTriggers(events, false, { ...ctx, turn: 8 });
    expect(triggers.some((t) => t.trigger === "death")).toBe(true);
  });

  test("session.ended win fires win trigger", () => {
    const events: Event[] = [{ kind: "session.ended", reason: "win" }];
    const triggers = detectSceneTriggers(events, false, { ...ctx, turn: 8 });
    expect(triggers.some((t) => t.trigger === "win")).toBe(true);
  });

  test("session.ended cap fires neither death nor win", () => {
    const events: Event[] = [{ kind: "session.ended", reason: "cap" }];
    const triggers = detectSceneTriggers(events, false, { ...ctx, turn: 10 });
    expect(triggers.some((t) => t.trigger === "death" || t.trigger === "win")).toBe(false);
  });

  test("reincarnatedAs declaration overrides form fallback in prompt", () => {
    const triggers = detectSceneTriggers([], false, {
      ...ctx,
      reincarnatedAs: "a candle still burning at the bottom of a well",
    });
    expect(triggers[0].prompt).toMatch(/candle/);
  });

  test("multiple triggers can fire on the same turn", () => {
    const events: Event[] = [
      { kind: "npc.introduced", npcId: "n1", data: { name: "Halrik" } },
      { kind: "session.ended", reason: "death" },
    ];
    const triggers = detectSceneTriggers(events, false, { ...ctx, turn: 1 });
    const kinds = new Set(triggers.map((t) => t.trigger));
    expect(kinds.has("awakening")).toBe(true);
    expect(kinds.has("first_npc")).toBe(true);
    expect(kinds.has("death")).toBe(true);
  });
});
