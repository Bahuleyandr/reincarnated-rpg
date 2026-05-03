/**
 * Haiku 4.5 classifier — Day 9 upgrade.
 *
 * Free-text → verb (from form whitelist) + confidence. Cheap (~$0.0005
 * per call). Falls back to the regex classifier if confidence < 0.5.
 *
 * The regex classifier (`classify` in classify.ts) remains the M1
 * default; this only activates when NARRATOR=remote (or via explicit
 * call from turn.ts).
 *
 * Uses tool_choice to force structured output. Now provider-agnostic
 * via `getProvider()` — works with Anthropic or OpenAI-compatible.
 */
import { getProvider } from "../ai/factory";
import type { AIProvider, ProviderTool } from "../ai/provider";
import type { Db } from "../db/client";
import { recordAiCall } from "../util/ai-telemetry";

import { classify, type ClassifierResult } from "./classify";
import type { FormTemplate } from "./types";

/** BYO-LLM extension: optional `provider` (override) and `model`
 *  (override the hard-coded haiku model — needed for non-Anthropic
 *  backends that don't speak haiku-4-5). */
export async function classifyHaiku(
  input: string,
  form: FormTemplate,
  telemetry?: {
    db: Db;
    sessionId?: string;
    userId?: string | null;
    presetId?: string | null;
  },
  opts?: { provider?: AIProvider; model?: string },
): Promise<ClassifierResult> {
  const verbs = form.verbs;
  const verbList = verbs.map((v) => `- ${v}`).join("\n");
  const tools: ProviderTool[] = [
    {
      name: "classify",
      description:
        "Pick the single verb from the form's whitelist that best matches the player's intent.",
      input_schema: {
        type: "object",
        properties: {
          verb: { type: "string", enum: verbs },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "0-1. <0.5 falls back to regex; lower confidences flag intent ambiguity.",
          },
        },
        required: ["verb", "confidence"],
      },
    },
  ];

  const provider = opts?.provider ?? getProvider();
  const model = opts?.model ?? "claude-haiku-4-5";
  const t0 = Date.now();
  try {
    const response = await provider.complete({
      model,
      maxTokens: 256,
      tools,
      toolChoice: { type: "tool", name: "classify" },
      messages: [
        {
          role: "user",
          content: `Player intent: "${input}"

Form: ${form.id}
Available verbs:
${verbList}

Pick the verb that best matches. Use lower confidence (<0.7) when the input is ambiguous, off-topic, or not clearly attemptable as one of the listed verbs.`,
        },
      ],
    });

    if (telemetry?.db) {
      await recordAiCall(telemetry.db, {
        sessionId: telemetry.sessionId,
        userId: telemetry.userId,
        presetId: telemetry.presetId,
        callType: "classifier",
        model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheCreateTokens: response.usage.cacheCreateTokens,
        durationMs: Date.now() - t0,
      });
    }

    const tool = response.toolUses.find((t) => t.name === "classify");
    if (tool) {
      const data = tool.input as { verb: string; confidence: number };
      if (!verbs.includes(data.verb)) return classify(input, form);
      if (data.confidence < 0.5) return classify(input, form);
      return { verb: data.verb, confidence: data.confidence };
    }
  } catch (err) {
    if (telemetry?.db) {
      await recordAiCall(telemetry.db, {
        sessionId: telemetry.sessionId,
        userId: telemetry.userId,
        presetId: telemetry.presetId,
        callType: "classifier",
        model,
        durationMs: Date.now() - t0,
        success: false,
        errorMsg: err instanceof Error ? err.message : String(err),
      });
    }
    return classify(input, form);
  }

  return classify(input, form);
}
