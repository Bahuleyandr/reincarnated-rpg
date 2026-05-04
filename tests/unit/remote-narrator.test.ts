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
});
