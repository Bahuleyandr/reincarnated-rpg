import { evaluateMemorability } from "@/lib/predicates/memorability";
import { initialProjection } from "@/lib/game/projection";
import type { Event, FormTemplate, LocationTemplate } from "@/lib/game/types";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: { cohesion: { max: 8, start: 8, death: 0 } },
  stats: {},
  verbs: [],
};
const LOC: LocationTemplate = {
  id: "collapsed-tunnel",
  entryRoomId: "seam",
  rooms: [{ id: "seam", exits: [] }],
};

function makeProjection() {
  return initialProjection({
    sessionId: "00000000-0000-0000-0000-000000000000",
    form: FORM,
    location: LOC,
  });
}

function turns(n: number): Event[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "turn.begun",
    turn: i + 1,
    input: "",
    inputSanitized: "",
  }));
}

describe("evaluateMemorability", () => {
  test("non-death sessions are never memorable", () => {
    const events: Event[] = [
      ...turns(10),
      { kind: "session.ended", reason: "win" },
    ];
    const r = evaluateMemorability({
      events,
      projection: makeProjection(),
      protagonistLabel: "the slime",
    });
    expect(r.memorable).toBe(false);
    expect(r.reasons).toEqual(["not-a-death"]);
  });

  test("trivial early death is not memorable", () => {
    const events: Event[] = [
      ...turns(2),
      { kind: "session.ended", reason: "death" },
    ];
    const r = evaluateMemorability({
      events,
      projection: makeProjection(),
      protagonistLabel: "the slime",
    });
    expect(r.memorable).toBe(false);
  });

  test("near-death after 30 turns is memorable", () => {
    const events: Event[] = [
      ...turns(35),
      {
        kind: "damage.applied",
        target: "$SELF",
        amount: 8,
        source: "rockfall",
      },
      { kind: "session.ended", reason: "death" },
    ];
    const projection = makeProjection();
    // Force final HP to 1 to trigger near-death.
    projection.form.vitals.cohesion = 1;
    const r = evaluateMemorability({
      events,
      projection,
      protagonistLabel: "the slime",
    });
    expect(r.memorable).toBe(true);
    expect(r.reasons).toContain("near-death-after-30");
    expect(r.headline).toMatch(/breath from making it through|fell to|died in|broke a/);
  });

  test("endurance >= 50 turns is memorable", () => {
    const events: Event[] = [
      ...turns(55),
      {
        kind: "damage.applied",
        target: "$SELF",
        amount: 8,
        source: "the air",
      },
      { kind: "session.ended", reason: "death" },
    ];
    const r = evaluateMemorability({
      events,
      projection: makeProjection(),
      protagonistLabel: "Embershade",
    });
    expect(r.memorable).toBe(true);
    expect(r.reasons).toContain("endurance-50");
    expect(r.headline).toMatch(/Embershade.*55/);
  });

  test("streak-break triggers memorability on its own", () => {
    const events: Event[] = [
      ...turns(5),
      { kind: "session.ended", reason: "death" },
    ];
    const r = evaluateMemorability({
      events,
      projection: makeProjection(),
      protagonistLabel: "the slime",
      streakBefore: 4,
    });
    expect(r.memorable).toBe(true);
    expect(r.reasons.some((s) => s.startsWith("streak-break"))).toBe(true);
    expect(r.headline).toMatch(/4-day streak/);
  });

  test("first-death-of-form is memorable", () => {
    const events: Event[] = [
      ...turns(8),
      { kind: "session.ended", reason: "death" },
    ];
    const r = evaluateMemorability({
      events,
      projection: makeProjection(),
      protagonistLabel: "Embershade",
      firstDeathOfForm: true,
    });
    expect(r.memorable).toBe(true);
    expect(r.reasons).toContain("first-death-of-form");
  });

  test("named killer (slug-shaped source) triggers", () => {
    const events: Event[] = [
      ...turns(15),
      {
        kind: "damage.applied",
        target: "$SELF",
        amount: 9,
        source: "tunnel-predator",
      },
      { kind: "session.ended", reason: "death" },
    ];
    const r = evaluateMemorability({
      events,
      projection: makeProjection(),
      protagonistLabel: "the slime",
    });
    expect(r.memorable).toBe(true);
    expect(r.reasons).toContain("named-killer");
    expect(r.headline).toMatch(/fell to/);
  });

  test("salience grows with reason count", () => {
    const events1: Event[] = [
      ...turns(12),
      { kind: "session.ended", reason: "death" },
    ];
    const events2: Event[] = [
      ...turns(55),
      {
        kind: "damage.applied",
        target: "$SELF",
        amount: 9,
        source: "tunnel-predator",
      },
      { kind: "session.ended", reason: "death" },
    ];
    const a = evaluateMemorability({
      events: events1,
      projection: makeProjection(),
      protagonistLabel: "x",
      streakBefore: 4,
    });
    const b = evaluateMemorability({
      events: events2,
      projection: makeProjection(),
      protagonistLabel: "x",
      streakBefore: 4,
    });
    expect(b.salience).toBeGreaterThan(a.salience);
  });
});
