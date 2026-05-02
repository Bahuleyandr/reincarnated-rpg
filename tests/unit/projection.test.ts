/**
 * Reducer tests — pure functions over a hand-rolled fixture. No DB.
 *
 * Day-3 acceptance: ≥10 reducer cases covering clamps and inventory edges.
 * This file ships ~25, including the realistic multi-event playthrough at
 * the end which is the main confidence test for the projection layer.
 */
import {
  applyEvents,
  initialProjection,
  reduce,
} from "@/lib/game/projection";
import type {
  Event,
  FormTemplate,
  LocationTemplate,
  Projection,
} from "@/lib/game/types";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: {
    cohesion: { max: 8, start: 8, death: 0 },
    essence: { max: 5, start: 5 },
  },
  stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
  verbs: ["absorb", "ooze", "sense_tremor"],
};

const LOC: LocationTemplate = {
  id: "collapsed-tunnel",
  entryRoomId: "seam",
  rooms: [
    { id: "seam", exits: [{ verb: "ooze", toRoomId: "slope" }] },
    { id: "slope", exits: [{ verb: "ooze", toRoomId: "seam" }] },
  ],
};

const fresh = (): Projection =>
  initialProjection({ sessionId: "test-session", form: FORM, location: LOC });

describe("initialProjection", () => {
  test("seeds vitals from start values and tracks vitalsMax", () => {
    const p = fresh();
    expect(p.form.vitals.cohesion).toBe(8);
    expect(p.form.vitals.essence).toBe(5);
    expect(p.form.vitalsMax.cohesion).toBe(8);
    expect(p.form.vitalsMax.essence).toBe(5);
    expect(p.location.roomId).toBe("seam");
    expect(p.location.discovered).toEqual(["seam"]);
    expect(p.status).toBe("active");
    expect(p.turn).toBe(0);
    expect(p.xp).toBe(0);
    expect(p.inventory).toEqual([]);
  });
});

describe("metadata events do not mutate", () => {
  test("session.started leaves state unchanged (initial projection already set)", () => {
    const p = fresh();
    const next = reduce(p, {
      kind: "session.started",
      formId: "lesser-slime",
      seed: 1,
    });
    expect(next).toEqual(p);
  });

  test("intent / roll / sensed / narration / tool_validation_failed are no-ops", () => {
    const p = fresh();
    const events: Event[] = [
      { kind: "intent.classified", verb: "ooze", confidence: 0.9 },
      {
        kind: "roll.resolved",
        roll: {
          d1: 4,
          d2: 3,
          mod: 0,
          total: 7,
          band: "partial",
          seed: 1,
        },
        against: "viscosity",
      },
      { kind: "sensed", modality: "vibration", detail: "drip" },
      { kind: "narration.emitted", text: "...", toolCallsApplied: 0 },
      {
        kind: "tool_validation_failed",
        tool: "absorb",
        error: "no such item",
      },
      { kind: "memory.created", memoryId: "m1", summary: "..." },
    ];
    expect(applyEvents(p, events)).toEqual(p);
  });
});

describe("turn.begun", () => {
  test("increments turn", () => {
    const next = reduce(fresh(), {
      kind: "turn.begun",
      turn: 1,
      input: "I taste the air",
      inputSanitized: "I taste the air",
    });
    expect(next.turn).toBe(1);
  });
});

describe("damage and heal", () => {
  test("damage.applied to $SELF reduces cohesion", () => {
    const next = reduce(fresh(), {
      kind: "damage.applied",
      target: "$SELF",
      amount: 3,
      source: "rat-bite",
    });
    expect(next.form.vitals.cohesion).toBe(5);
    expect(next.status).toBe("active");
  });

  test("damage.applied clamps cohesion at 0 (HP floor)", () => {
    const seed: Projection = {
      ...fresh(),
      form: {
        ...fresh().form,
        vitals: { ...fresh().form.vitals, cohesion: 1 },
      },
    };
    const next = reduce(seed, {
      kind: "damage.applied",
      target: "$SELF",
      amount: 5,
      source: "fall",
    });
    expect(next.form.vitals.cohesion).toBe(0);
  });

  test("damage that drops cohesion to 0 sets status='dead'", () => {
    const seed: Projection = {
      ...fresh(),
      form: {
        ...fresh().form,
        vitals: { ...fresh().form.vitals, cohesion: 1 },
      },
    };
    const next = reduce(seed, {
      kind: "damage.applied",
      target: "$SELF",
      amount: 5,
      source: "fall",
    });
    expect(next.status).toBe("dead");
  });

  test("damage to a non-$SELF target is a no-op for projection", () => {
    const p = fresh();
    const next = reduce(p, {
      kind: "damage.applied",
      target: "tunnel-rat-1",
      amount: 3,
      source: "absorb",
    });
    expect(next).toEqual(p);
  });

  test("healed clamps at vitalsMax (HP ceiling)", () => {
    const seed: Projection = {
      ...fresh(),
      form: {
        ...fresh().form,
        vitals: { ...fresh().form.vitals, cohesion: 6 },
      },
    };
    const next = reduce(seed, {
      kind: "healed",
      target: "$SELF",
      amount: 5,
    });
    expect(next.form.vitals.cohesion).toBe(8);
  });

  test("healed below max increases by amount", () => {
    const seed: Projection = {
      ...fresh(),
      form: {
        ...fresh().form,
        vitals: { ...fresh().form.vitals, cohesion: 3 },
      },
    };
    const next = reduce(seed, {
      kind: "healed",
      target: "$SELF",
      amount: 2,
    });
    expect(next.form.vitals.cohesion).toBe(5);
  });

  test("damage with explicit `vital: 'essence'` hits essence", () => {
    const next = reduce(fresh(), {
      kind: "damage.applied",
      target: "$SELF",
      amount: 2,
      source: "drain",
      vital: "essence",
    });
    expect(next.form.vitals.essence).toBe(3);
    expect(next.form.vitals.cohesion).toBe(8);
  });

  test("damage to a non-death vital (essence) draining to 0 leaves status='active'", () => {
    const seed: Projection = {
      ...fresh(),
      form: {
        ...fresh().form,
        vitals: { ...fresh().form.vitals, essence: 1 },
      },
    };
    const next = reduce(seed, {
      kind: "damage.applied",
      target: "$SELF",
      amount: 5,
      source: "drain",
      vital: "essence",
    });
    expect(next.form.vitals.essence).toBe(0);
    expect(next.status).toBe("active");
  });

  test("healed with explicit vital='essence' clamps at vitalsMax.essence", () => {
    const seed: Projection = {
      ...fresh(),
      form: {
        ...fresh().form,
        vitals: { ...fresh().form.vitals, essence: 3 },
      },
    };
    const next = reduce(seed, {
      kind: "healed",
      target: "$SELF",
      amount: 100,
      vital: "essence",
    });
    expect(next.form.vitals.essence).toBe(5);
  });
});

describe("inventory", () => {
  test("inventory.added with new item appends entry", () => {
    const next = reduce(fresh(), {
      kind: "inventory.added",
      itemId: "iron-shard",
      qty: 2,
    });
    expect(next.inventory).toEqual([{ itemId: "iron-shard", qty: 2 }]);
  });

  test("inventory.added with existing item increments qty", () => {
    const seed: Projection = {
      ...fresh(),
      inventory: [{ itemId: "iron-shard", qty: 1 }],
    };
    const next = reduce(seed, {
      kind: "inventory.added",
      itemId: "iron-shard",
      qty: 3,
    });
    expect(next.inventory).toEqual([{ itemId: "iron-shard", qty: 4 }]);
  });

  test("inventory.removed decrements qty", () => {
    const seed: Projection = {
      ...fresh(),
      inventory: [{ itemId: "iron-shard", qty: 5 }],
    };
    const next = reduce(seed, {
      kind: "inventory.removed",
      itemId: "iron-shard",
      qty: 2,
    });
    expect(next.inventory).toEqual([{ itemId: "iron-shard", qty: 3 }]);
  });

  test("inventory.removed bringing qty to 0 deletes entry but preserves others", () => {
    const seed: Projection = {
      ...fresh(),
      inventory: [
        { itemId: "iron-shard", qty: 2 },
        { itemId: "moss", qty: 1 },
      ],
    };
    const next = reduce(seed, {
      kind: "inventory.removed",
      itemId: "iron-shard",
      qty: 5,
    });
    expect(next.inventory).toEqual([{ itemId: "moss", qty: 1 }]);
  });

  test("inventory.removed for unheld item is a silent no-op", () => {
    const p = fresh();
    const next = reduce(p, {
      kind: "inventory.removed",
      itemId: "ghost",
      qty: 1,
    });
    expect(next.inventory).toEqual(p.inventory);
  });
});

describe("movement and discovery", () => {
  test("moved updates roomId and adds toRoom to discovered", () => {
    const next = reduce(fresh(), {
      kind: "moved",
      fromRoom: "seam",
      toRoom: "slope",
    });
    expect(next.location.roomId).toBe("slope");
    expect(next.location.discovered).toContain("slope");
    expect(next.location.discovered).toContain("seam");
  });

  test("moved into a previously-discovered room does not duplicate", () => {
    const seed: Projection = {
      ...fresh(),
      location: { ...fresh().location, discovered: ["seam", "slope"] },
    };
    const next = reduce(seed, {
      kind: "moved",
      fromRoom: "slope",
      toRoom: "seam",
    });
    expect(next.location.discovered.filter((r) => r === "seam")).toHaveLength(
      1,
    );
  });

  test("location.discovered is idempotent", () => {
    const a = reduce(fresh(), {
      kind: "location.discovered",
      locationId: "moss-vault",
    });
    const b = reduce(a, {
      kind: "location.discovered",
      locationId: "moss-vault",
    });
    expect(b.location.discovered).toEqual(["seam", "moss-vault"]);
  });
});

describe("form_state and time", () => {
  test("form_state.changed accumulates delta", () => {
    const a = reduce(fresh(), {
      kind: "form_state.changed",
      field: "exposed",
      delta: 1,
    });
    const b = reduce(a, {
      kind: "form_state.changed",
      field: "exposed",
      delta: -1,
    });
    expect(b.form.state.exposed).toBe(0);
  });

  test("time.passed accumulates ticks starting from undefined", () => {
    const a = reduce(fresh(), { kind: "time.passed", ticks: 1 });
    const b = reduce(a, { kind: "time.passed", ticks: 3 });
    expect(b.form.state.ticks).toBe(4);
  });
});

describe("absorb", () => {
  test("absorbed removes 1 of itemId from inventory and increments essence", () => {
    const seed: Projection = {
      ...fresh(),
      inventory: [{ itemId: "moss", qty: 1 }],
      form: {
        ...fresh().form,
        vitals: { ...fresh().form.vitals, essence: 3 },
      },
    };
    const next = reduce(seed, {
      kind: "absorbed",
      itemId: "moss",
      into: "essence",
    });
    expect(next.inventory).toEqual([]);
    expect(next.form.vitals.essence).toBe(4);
  });

  test("absorbed clamps essence at vitalsMax", () => {
    const seed: Projection = {
      ...fresh(),
      inventory: [{ itemId: "moss", qty: 1 }],
    };
    const next = reduce(seed, {
      kind: "absorbed",
      itemId: "moss",
      into: "essence",
    });
    expect(next.form.vitals.essence).toBe(5);
  });

  test("absorbed of multi-qty stack decrements rather than nukes the row", () => {
    const seed: Projection = {
      ...fresh(),
      inventory: [{ itemId: "moss", qty: 3 }],
    };
    const next = reduce(seed, {
      kind: "absorbed",
      itemId: "moss",
      into: "essence",
    });
    expect(next.inventory).toEqual([{ itemId: "moss", qty: 2 }]);
  });
});

describe("npcs and relationships", () => {
  test("npc.introduced adds entry with extra data passthrough", () => {
    const next = reduce(fresh(), {
      kind: "npc.introduced",
      npcId: "rat-1",
      data: {
        name: "Tunnel Rat",
        relationship: -2,
        templateId: "tunnel-rat",
      },
    });
    expect(next.npcs["rat-1"]).toMatchObject({
      name: "Tunnel Rat",
      relationship: -2,
      templateId: "tunnel-rat",
    });
  });

  test("npc.introduced is idempotent for same npcId", () => {
    const a = reduce(fresh(), {
      kind: "npc.introduced",
      npcId: "rat-1",
      data: { name: "Tunnel Rat", relationship: -2 },
    });
    const b = reduce(a, {
      kind: "npc.introduced",
      npcId: "rat-1",
      data: { name: "Other Rat", relationship: 0 },
    });
    expect(b.npcs["rat-1"].name).toBe("Tunnel Rat");
  });

  test("relationship.updated for known NPC adjusts relationship", () => {
    const seed = applyEvents(fresh(), [
      {
        kind: "npc.introduced",
        npcId: "rat-1",
        data: { name: "Rat", relationship: 0 },
      },
    ]);
    const next = reduce(seed, {
      kind: "relationship.updated",
      npcId: "rat-1",
      delta: -2,
      reason: "ate her brother",
    });
    expect(next.npcs["rat-1"].relationship).toBe(-2);
  });

  test("relationship.updated for unknown NPC is a silent no-op", () => {
    const next = reduce(fresh(), {
      kind: "relationship.updated",
      npcId: "ghost",
      delta: 1,
      reason: "?",
    });
    expect(next.npcs).toEqual({});
  });
});

describe("quest, xp, session.ended", () => {
  test("quest.objectiveUpdated sets the objective and remembers questId", () => {
    const next = reduce(fresh(), {
      kind: "quest.objectiveUpdated",
      questId: "survive-the-night",
      objective: "find-exit",
      status: "open",
    });
    expect(next.quest.id).toBe("survive-the-night");
    expect(next.quest.objectives["find-exit"]).toBe("open");
  });

  test("xp.granted accumulates", () => {
    const a = reduce(fresh(), {
      kind: "xp.granted",
      amount: 5,
      reason: "absorb",
    });
    const b = reduce(a, {
      kind: "xp.granted",
      amount: 3,
      reason: "discover",
    });
    expect(b.xp).toBe(8);
  });

  test("session.ended('death') sets status='dead'", () => {
    const next = reduce(fresh(), { kind: "session.ended", reason: "death" });
    expect(next.status).toBe("dead");
  });

  test("session.ended('win') sets status='won'", () => {
    const next = reduce(fresh(), { kind: "session.ended", reason: "win" });
    expect(next.status).toBe("won");
  });

  test("session.ended('cap') sets status='capped'", () => {
    const next = reduce(fresh(), { kind: "session.ended", reason: "cap" });
    expect(next.status).toBe("capped");
  });
});

describe("applyEvents — multi-event playthrough", () => {
  test("realistic 5-event slime turn reproduces expected projection", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 42 },
      {
        kind: "turn.begun",
        turn: 1,
        input: "ooze toward the slope",
        inputSanitized: "ooze toward the slope",
      },
      { kind: "moved", fromRoom: "seam", toRoom: "slope" },
      {
        kind: "damage.applied",
        target: "$SELF",
        amount: 1,
        source: "scrape",
      },
      { kind: "narration.emitted", text: "...", toolCallsApplied: 1 },
    ];
    const next = applyEvents(fresh(), events);
    expect(next.turn).toBe(1);
    expect(next.location.roomId).toBe("slope");
    expect(next.location.discovered).toEqual(["seam", "slope"]);
    expect(next.form.vitals.cohesion).toBe(7);
    expect(next.status).toBe("active");
  });
});
