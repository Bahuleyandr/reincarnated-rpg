/**
 * Race-mechanic in-run hooks — pure-function tests.
 *
 * Each race's rule reduces to: given (raceId, intent, location,
 * room) → (delta, reason). Verifies the rule table at depth.
 */
import { applyRaceRollModifier } from "@/lib/race/run-hooks";

const ROOM_GENERIC = { id: "some-room" };
const LOC_TUNNEL = { id: "collapsed-tunnel" };
const LOC_HIGHFIELD = { id: "highfield-ascending" };
const LOC_ANCHORAGE = { id: "the-coral-anchorage" };
const LOC_INDICES = { id: "the-long-indices" };
const LOC_SALTGALE = { id: "saltgale" };
const LOC_THREADWARDEN = { id: "threadwarden" };

describe("applyRaceRollModifier — null / human", () => {
  test("null race always returns 0", () => {
    expect(
      applyRaceRollModifier({
        raceId: null,
        intent: "sail",
        location: LOC_ANCHORAGE,
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(0);
  });

  test("human always returns 0 (non-mechanical by design)", () => {
    expect(
      applyRaceRollModifier({
        raceId: "human",
        intent: "trade",
        location: LOC_THREADWARDEN,
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(0);
  });
});

describe("dwarven", () => {
  test("-1 in collapsed-tunnel (enclosed location)", () => {
    const r = applyRaceRollModifier({
      raceId: "dwarven",
      intent: "ooze",
      location: LOC_TUNNEL,
      room: ROOM_GENERIC,
    });
    expect(r.delta).toBe(-1);
    expect(r.reason).toBe("dwarven-enclosed");
  });

  test("-1 in spire-archive (enclosed room pattern)", () => {
    const r = applyRaceRollModifier({
      raceId: "dwarven",
      intent: "fall_open",
      location: { id: "sunless-spire" },
      room: { id: "spire-archive" },
    });
    expect(r.delta).toBe(-1);
  });

  test("-1 in hush-room", () => {
    const r = applyRaceRollModifier({
      raceId: "dwarven",
      intent: "decode_passage",
      location: LOC_INDICES,
      room: { id: "the-hush-room" },
    });
    expect(r.delta).toBe(-1);
  });

  test("+1 in highfield (open-air location)", () => {
    const r = applyRaceRollModifier({
      raceId: "dwarven",
      intent: "tend",
      location: LOC_HIGHFIELD,
      room: ROOM_GENERIC,
    });
    expect(r.delta).toBe(1);
    expect(r.reason).toBe("dwarven-open-air");
  });

  test("0 in unaffiliated indoors location", () => {
    const r = applyRaceRollModifier({
      raceId: "dwarven",
      intent: "trade",
      location: { id: "saltgale" },
      room: ROOM_GENERIC,
    });
    expect(r.delta).toBe(0);
  });
});

describe("halfling", () => {
  test("+1 on naval verbs", () => {
    expect(
      applyRaceRollModifier({
        raceId: "halfling",
        intent: "sail",
        location: { id: "elsewhere" },
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(1);
    expect(
      applyRaceRollModifier({
        raceId: "halfling",
        intent: "swim",
        location: { id: "elsewhere" },
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(1);
  });

  test("+1 at coastal locations regardless of verb", () => {
    expect(
      applyRaceRollModifier({
        raceId: "halfling",
        intent: "wait",
        location: LOC_ANCHORAGE,
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(1);
  });

  test("0 on non-naval verb in non-coastal location", () => {
    expect(
      applyRaceRollModifier({
        raceId: "halfling",
        intent: "weave",
        location: LOC_THREADWARDEN,
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(0);
  });
});

describe("orcish", () => {
  test("+1 on read/decode/sense verbs", () => {
    expect(
      applyRaceRollModifier({
        raceId: "orcish",
        intent: "decode",
        location: LOC_INDICES,
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(1);
    expect(
      applyRaceRollModifier({
        raceId: "orcish",
        intent: "sense_intruder",
        location: { id: "elsewhere" },
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(1);
  });

  test("0 on non-read verb", () => {
    expect(
      applyRaceRollModifier({
        raceId: "orcish",
        intent: "smother",
        location: LOC_INDICES,
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(0);
  });
});

describe("elven", () => {
  test("+1 on social verbs", () => {
    expect(
      applyRaceRollModifier({
        raceId: "elven",
        intent: "trade",
        location: LOC_SALTGALE,
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(1);
    expect(
      applyRaceRollModifier({
        raceId: "elven",
        intent: "negotiate",
        location: { id: "elsewhere" },
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(1);
  });

  test("0 on non-social verb", () => {
    expect(
      applyRaceRollModifier({
        raceId: "elven",
        intent: "ooze",
        location: { id: "elsewhere" },
        room: ROOM_GENERIC,
      }).delta,
    ).toBe(0);
  });
});
