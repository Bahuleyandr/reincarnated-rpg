import type { AIProvider, CompleteArgs, CompleteResponse } from "@/lib/ai/provider";
import { loadForm, loadLocation } from "@/lib/game/content";
import { initialProjection } from "@/lib/game/projection";
import { RemoteNarrator } from "@/lib/narrator/remote";

describe("RemoteNarrator", () => {
  test("sends the current sanitized player input, not just the classifier verb", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const projection = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });

    let userMessage = "";
    const provider: AIProvider = {
      providerName: "test",
      async complete(args: CompleteArgs): Promise<CompleteResponse> {
        userMessage = args.messages[0]?.content ?? "";
        return {
          text: "You move.",
          toolUses: [],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
          stopReason: "end_turn",
          rawModel: "test",
        };
      },
    };

    const narrator = new RemoteNarrator({ form, location, provider });
    await narrator.narrate({
      projection,
      lastEvents: [],
      playerInputSanitized: "ooze toward the shining crack",
      roll: { d1: 6, d2: 4, mod: 0, total: 10, band: "success", seed: 1 },
      intent: "ooze",
      relevantMemories: [],
    });

    expect(userMessage).toContain("ooze toward the shining crack");
    expect(userMessage).toContain("classifier_verb: ooze");
  });

  test("Phase 9 tool list includes speak_to + pledge_faction", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const projection = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });

    let toolNames: string[] = [];
    const provider: AIProvider = {
      providerName: "test",
      async complete(args: CompleteArgs): Promise<CompleteResponse> {
        toolNames = (args.tools ?? []).map((t) => t.name);
        return {
          text: "ok",
          toolUses: [],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
          stopReason: "end_turn",
          rawModel: "test",
        };
      },
    };

    const narrator = new RemoteNarrator({ form, location, provider });
    await narrator.narrate({
      projection,
      lastEvents: [],
      playerInputSanitized: "say hi",
      roll: { d1: 3, d2: 4, mod: 0, total: 7, band: "success", seed: 1 },
      intent: "speak",
      relevantMemories: [],
    });

    // Phase 9 follow-up: orchestrator already accepts these, but
    // the narrator must also advertise them so the model can call
    // them. Without these, the dialogue + faction features stay
    // unreachable from prose.
    expect(toolNames).toContain("speak_to");
    expect(toolNames).toContain("pledge_faction");
    // Spot-check existing tools didn't disappear.
    expect(toolNames).toContain("apply_damage");
    expect(toolNames).toContain("narrate_only");
  });

  test("repairs tool-only responses instead of falling back immediately", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const projection = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });

    let calls = 0;
    let repairPrompt = "";
    let repairTools: CompleteArgs["tools"];
    const provider: AIProvider = {
      providerName: "test",
      async complete(args: CompleteArgs): Promise<CompleteResponse> {
        calls += 1;
        if (calls === 2) {
          repairPrompt = args.messages[0]?.content ?? "";
          repairTools = args.tools;
          return {
            text: "You settle low against the stone and learn the room by pressure.",
            toolUses: [],
            usage: {
              inputTokens: 10,
              outputTokens: 8,
              cacheReadTokens: 0,
              cacheCreateTokens: 0,
            },
            stopReason: "stop",
            rawModel: "test",
          };
        }
        return {
          text: "",
          toolUses: [{ id: "t1", name: "pass_time", input: { ticks: 1 } }],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
          stopReason: "tool_calls",
          rawModel: "test",
        };
      },
    };

    const narrator = new RemoteNarrator({ form, location, provider });
    const out = await narrator.narrate({
      projection,
      lastEvents: [],
      playerInputSanitized: "barley malt, rye meal",
      roll: { d1: 2, d2: 5, mod: 0, total: 7, band: "partial", seed: 1 },
      intent: "wait",
      relevantMemories: [],
    });

    expect(calls).toBe(2);
    expect(out.text).toContain("pressure");
    expect(out.toolCalls).toEqual([{ name: "pass_time", ticks: 1 }]);
    expect(repairPrompt).toContain("<empty_narration_repair>");
    expect(repairPrompt).toContain('"name":"pass_time"');
    expect(repairTools).toBeUndefined();
  });

  test("rejects empty prose only after the repair also fails", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const projection = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form,
      location,
    });

    const provider: AIProvider = {
      providerName: "test",
      async complete(): Promise<CompleteResponse> {
        return {
          text: "",
          toolUses: [{ id: "t1", name: "pass_time", input: { ticks: 1 } }],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
          stopReason: "tool_calls",
          rawModel: "test",
        };
      },
    };

    const narrator = new RemoteNarrator({ form, location, provider });
    await expect(
      narrator.narrate({
        projection,
        lastEvents: [],
        playerInputSanitized: "barley malt, rye meal",
        roll: { d1: 2, d2: 5, mod: 0, total: 7, band: "partial", seed: 1 },
        intent: "wait",
        relevantMemories: [],
      }),
    ).rejects.toThrow("remote narrator returned empty narration");
  });
});
