/**
 * Onboarding nudges — POLISH_PLAN 0c.5.
 *
 * Each catalog entry asserts:
 *   - the predicate fires at the expected state
 *   - it does NOT fire at adjacent states (false-positive guard)
 *   - dismissal suppresses it
 *   - priority order is respected when multiple match
 */
import { findNudgeById, NUDGES, pickNudge } from "@/lib/onboarding/nudges";
import type { Event, Projection } from "@/lib/game/types";

function makeProj(overrides?: Partial<Projection>): Projection {
  const base: Projection = {
    sessionId: "s1",
    upToSeq: 0,
    form: {
      id: "lesser-slime",
      vitals: { cohesion: 8, essence: 5 },
      vitalsMax: { cohesion: 8, essence: 5 },
      vitalsDeath: { cohesion: 0, essence: null },
      stats: {},
      state: {},
    },
    npcs: {},
    turn: 0,
    xp: 0,
    quest: { id: null, objectives: {} },
    status: "active",
    location: { id: "collapsed-tunnel", roomId: "seam", discovered: ["seam"] },
    inventory: [],
    reincarnatedAs: null,
  };
  return { ...base, ...(overrides ?? {}) };
}

function turnBegan(turn: number): Event {
  return {
    kind: "turn.begun",
    turn,
    input: "...",
    inputSanitized: "...",
  } as Event;
}

function narrationEmitted(): Event {
  return {
    kind: "narration.emitted",
    text: "...",
    toolCallsApplied: 0,
  } as Event;
}

describe("nudge catalog", () => {
  test("every nudge has a unique id", () => {
    const ids = NUDGES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("findNudgeById returns the right entry", () => {
    expect(findNudgeById("first-look")?.priority).toBe(10);
    expect(findNudgeById("nonexistent")).toBeNull();
  });
});

describe("first-look", () => {
  test("fires on turn 0 with no turn.begun events", () => {
    const proj = makeProj({ turn: 0 });
    const res = pickNudge({ events: [], projection: proj, dismissedIds: [] });
    expect(res.nudge?.id).toBe("first-look");
  });

  test("does not fire after the first turn", () => {
    const proj = makeProj({ turn: 1 });
    const res = pickNudge({
      events: [turnBegan(1)],
      projection: proj,
      dismissedIds: [],
    });
    expect(res.nudge?.id).not.toBe("first-look");
  });
});

describe("explore-an-exit", () => {
  test("fires after 3+ turns when only one room is discovered", () => {
    const proj = makeProj({
      turn: 4,
      location: {
        id: "x",
        roomId: "seam",
        discovered: ["seam"],
      },
    });
    const res = pickNudge({
      events: [turnBegan(1), turnBegan(2), turnBegan(3), turnBegan(4)],
      projection: proj,
      dismissedIds: [],
    });
    expect(res.nudge?.id).toBe("explore-an-exit");
  });

  test("does not fire when player has explored", () => {
    const proj = makeProj({
      turn: 4,
      location: {
        id: "x",
        roomId: "second",
        discovered: ["seam", "second"],
      },
    });
    const res = pickNudge({
      events: [turnBegan(1), turnBegan(2), turnBegan(3), turnBegan(4)],
      projection: proj,
      dismissedIds: [],
    });
    expect(res.nudge?.id).not.toBe("explore-an-exit");
  });
});

describe("try-free-text", () => {
  test("fires at turn 4+ with multiple narration events", () => {
    const proj = makeProj({
      turn: 4,
      // explore-an-exit is gated below on no exits — give them an extra room.
      location: { id: "x", roomId: "second", discovered: ["seam", "second"] },
    });
    const events = [
      turnBegan(1),
      narrationEmitted(),
      turnBegan(2),
      narrationEmitted(),
      turnBegan(3),
      narrationEmitted(),
      turnBegan(4),
      narrationEmitted(),
    ];
    const res = pickNudge({ events, projection: proj, dismissedIds: [] });
    expect(res.nudge?.id).toBe("try-free-text");
  });

  test("does not fire before turn 4", () => {
    const proj = makeProj({ turn: 3 });
    const res = pickNudge({
      events: [turnBegan(1), turnBegan(2), turnBegan(3)],
      projection: proj,
      dismissedIds: [],
    });
    expect(res.nudge?.id).not.toBe("try-free-text");
  });
});

describe("vital-low", () => {
  test("fires when primary vital drops to 30% of max", () => {
    const proj = makeProj({
      form: {
        ...makeProj().form,
        vitals: { cohesion: 2, essence: 5 }, // 2/8 = 25%
      },
    });
    const res = pickNudge({ events: [], projection: proj, dismissedIds: [] });
    expect(res.nudge?.id).toBe("vital-low");
  });

  test("does not fire when vital is healthy", () => {
    const proj = makeProj();
    const res = pickNudge({ events: [], projection: proj, dismissedIds: [] });
    expect(res.nudge?.id).not.toBe("vital-low");
  });

  test("vital-low outranks first-look (priority 5 < 10)", () => {
    const proj = makeProj({
      turn: 0,
      form: {
        ...makeProj().form,
        vitals: { cohesion: 1, essence: 5 },
      },
    });
    const res = pickNudge({ events: [], projection: proj, dismissedIds: [] });
    expect(res.nudge?.id).toBe("vital-low");
  });

  test("ignores vitals with null death threshold", () => {
    // essence is non-lethal (death=null). Even at 0 it shouldn't
    // trigger the nudge by itself.
    const proj = makeProj({
      form: {
        ...makeProj().form,
        vitals: { cohesion: 8, essence: 0 },
      },
    });
    const res = pickNudge({ events: [], projection: proj, dismissedIds: [] });
    expect(res.nudge?.id).not.toBe("vital-low");
  });
});

describe("wyrm-watching", () => {
  test("fires when form.state.wyrm_attuned >= 1", () => {
    // Past first-look's window (turn>=1) and have explored, so the
    // higher-priority hint nudges don't crowd this out.
    const proj = makeProj({
      turn: 2,
      location: { id: "x", roomId: "second", discovered: ["seam", "second"] },
      form: { ...makeProj().form, state: { wyrm_attuned: 1 } },
    });
    const res = pickNudge({
      events: [turnBegan(1), turnBegan(2)],
      projection: proj,
      dismissedIds: [],
    });
    expect(res.nudge?.id).toBe("wyrm-watching");
  });
});

describe("branch-taken", () => {
  test("fires when any form.state.branch_<id> >= 1", () => {
    const proj = makeProj({
      turn: 4,
      location: { id: "x", roomId: "seam", discovered: ["seam", "second"] },
      form: { ...makeProj().form, state: { branch_withdrawn: 1 } },
    });
    const res = pickNudge({
      events: [turnBegan(1), turnBegan(2), turnBegan(3), turnBegan(4)],
      projection: proj,
      dismissedIds: ["try-free-text"],
    });
    expect(res.nudge?.id).toBe("branch-taken");
  });
});

describe("dismissal", () => {
  test("dismissed nudge id is suppressed; next-priority surfaces", () => {
    // first-look would normally fire (turn 0, no events). Dismiss it
    // and the runner should pick nothing else (no other matches).
    const proj = makeProj({ turn: 0 });
    const res = pickNudge({
      events: [],
      projection: proj,
      dismissedIds: ["first-look"],
    });
    expect(res.nudge).toBeNull();
  });

  test("higher-priority match wins over a lower-priority undismissed match", () => {
    // wyrm-watching matches at any turn; vital-low (priority 5)
    // should win when both fire.
    const proj = makeProj({
      form: {
        ...makeProj().form,
        vitals: { cohesion: 1, essence: 5 },
        state: { wyrm_attuned: 1 },
      },
    });
    const res = pickNudge({ events: [], projection: proj, dismissedIds: [] });
    expect(res.nudge?.id).toBe("vital-low");
  });
});
