/**
 * Safety guardrails — verify the cap on form-state accumulation.
 */
import { checkPrecondition, SAFETY_CAPS } from "@/lib/game/tools";
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
});
