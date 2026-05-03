/**
 * Safety guardrails — verify the cap on form-state accumulation.
 */
import { checkPrecondition, SAFETY_CAPS, toolCallSchema } from "@/lib/game/tools";
import type { Projection, ToolCall } from "@/lib/game/types";

function fakeProjection(state: Record<string, number> = {}): Projection {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    upToSeq: 0,
    form: {
      id: "lesser-slime",
      vitals: { cohesion: 8, essence: 5 },
      vitalsMax: { cohesion: 8, essence: 5 },
      vitalsDeath: { cohesion: 0, essence: null },
      stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
      state,
    },
    location: { id: "collapsed-tunnel", roomId: "x", discovered: ["x"] },
    inventory: [],
    npcs: {},
    quest: { id: null, objectives: {} },
    xp: 0,
    turn: 0,
    status: "active",
    reincarnatedAs: null,
  };
}

describe("change_form_state safety cap", () => {
  test("allows accumulation up to the cap", () => {
    const p = fakeProjection({ wyrm_attuned: SAFETY_CAPS.formStateAbsMax - 1 });
    const tool: ToolCall = {
      name: "change_form_state",
      field: "wyrm_attuned",
      delta: 1,
    };
    expect(checkPrecondition(tool, p)).toBeNull();
  });

  test("rejects accumulation past the cap", () => {
    const p = fakeProjection({ wyrm_attuned: SAFETY_CAPS.formStateAbsMax });
    const tool: ToolCall = {
      name: "change_form_state",
      field: "wyrm_attuned",
      delta: 1,
    };
    const err = checkPrecondition(tool, p);
    expect(err).not.toBeNull();
    expect(err).toMatch(/safety cap/i);
  });

  test("rejects negative accumulation past the cap", () => {
    const p = fakeProjection({ exposed: -SAFETY_CAPS.formStateAbsMax });
    const tool: ToolCall = {
      name: "change_form_state",
      field: "exposed",
      delta: -1,
    };
    expect(checkPrecondition(tool, p)).toMatch(/safety cap/i);
  });

  test("a fresh field can hop straight to within cap", () => {
    const p = fakeProjection({});
    const tool: ToolCall = {
      name: "change_form_state",
      field: "new_field",
      delta: 5,
    };
    expect(checkPrecondition(tool, p)).toBeNull();
  });

  test("cap is exposed as a constant", () => {
    expect(typeof SAFETY_CAPS.formStateAbsMax).toBe("number");
    expect(SAFETY_CAPS.formStateAbsMax).toBeGreaterThan(0);
    expect(SAFETY_CAPS.damagePerCallMax).toBe(10);
    expect(SAFETY_CAPS.healPerCallMax).toBe(5);
  });

  test("maxToolsPerTurn cap is exposed", () => {
    expect(typeof SAFETY_CAPS.maxToolsPerTurn).toBe("number");
    expect(SAFETY_CAPS.maxToolsPerTurn).toBeGreaterThan(0);
    // Sanity bound: a turn that emits more than this many tools is
    // almost certainly a model burst, not an intentional choreography.
    expect(SAFETY_CAPS.maxToolsPerTurn).toBeLessThanOrEqual(10);
  });

  test("grantXpPerCallMax tightens the per-call XP grant", () => {
    expect(SAFETY_CAPS.grantXpPerCallMax).toBe(50);
    // The zod schema must mirror this — validate via the discriminated
    // union: an XP grant of 999 should now fail validation.
    const ok = toolCallSchema.safeParse({
      name: "grant_xp",
      amount: 50,
      reason: "boundary",
    });
    expect(ok.success).toBe(true);
    const overflow = toolCallSchema.safeParse({
      name: "grant_xp",
      amount: 999,
      reason: "should be rejected",
    });
    expect(overflow.success).toBe(false);
  });
});
