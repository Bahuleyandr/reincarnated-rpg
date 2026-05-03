/**
 * LLM-as-judge — Sonnet 4.6 grades narration against the form's
 * sample corpus. Used by the eval runner for `tone.toneMatch` 1-5
 * scoring.
 *
 * Self-grading caveat: same model family judging itself biases
 * toward the model's own style. Treat scores as a smoke test, not a
 * ground truth — supplement with manual spot-check on every prompt
 * change.
 *
 * Returns null when no provider API key is configured so the eval
 * runner can skip rubric scoring without erroring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getProvider } from "../src/lib/ai/factory";
import type { ProviderTool } from "../src/lib/ai/provider";
import type { Db } from "../src/lib/db/client";
import { recordAiCall } from "../src/lib/util/ai-telemetry";
import { env } from "../src/lib/util/env";

interface JudgeArgs {
  formId: string;
  scenarioId: string;
  narration: string;
  /** Optional telemetry sink. */
  telemetry?: { db: Db; sessionId?: string };
}

export interface JudgeResult {
  toneMatch: number;
  reason: string;
}

export async function judgeNarration(
  args: JudgeArgs,
): Promise<JudgeResult | null> {
  // Skip if neither provider has a key — the runner just won't have
  // a tone score for this scenario.
  const hasAnthropic = !!env().ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  if (!hasAnthropic && !hasOpenAI) return null;

  const formJson = JSON.parse(
    readFileSync(
      join(process.cwd(), "content", "forms", `${args.formId}.json`),
      "utf8",
    ),
  ) as {
    sampleCorpus: { passages: Array<{ id: string; text: string }> };
    negativeVocab: { words: string[] };
  };

  const corpus = formJson.sampleCorpus.passages
    .map((p) => `--- ${p.id} ---\n${p.text}`)
    .join("\n\n");

  const tools: ProviderTool[] = [
    {
      name: "score",
      description:
        "Score the narration for tonal match against the form's sample corpus.",
      input_schema: {
        type: "object",
        properties: {
          tone_match: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description:
              "1=very off-form (humanoid prose, 1st person, stiff). 5=indistinguishable from the sample corpus.",
          },
          reason: { type: "string" },
        },
        required: ["tone_match", "reason"],
      },
    },
  ];

  const provider = getProvider();
  const model = "claude-sonnet-4-6";
  const t0 = Date.now();
  let response;
  try {
    response = await provider.complete({
      model,
      maxTokens: 512,
      tools,
      toolChoice: { type: "tool", name: "score" },
      messages: [
        {
          role: "user",
          content: `You are judging a narration generated for the ${args.formId} form. Score it 1-5 on how well it matches the tone, register, sentence cadence, and vocabulary of the sample corpus below.

Penalize: humanoid verbs about the player ("hand", "see", "speak", "walk"), first-person voice (the player is "you"), stiff or generic fantasy prose. Reward: chemistry/vibration/thermal sensing, second-person voice, in-form vocabulary.

Sample corpus (the gold standard):
${corpus}

Narration to score (scenario ${args.scenarioId}):
"${args.narration}"`,
        },
      ],
    });
  } catch (err) {
    if (args.telemetry?.db) {
      await recordAiCall(args.telemetry.db, {
        sessionId: args.telemetry.sessionId,
        callType: "judge",
        model,
        durationMs: Date.now() - t0,
        success: false,
        errorMsg: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  if (args.telemetry?.db) {
    await recordAiCall(args.telemetry.db, {
      sessionId: args.telemetry.sessionId,
      callType: "judge",
      model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheCreateTokens: response.usage.cacheCreateTokens,
      durationMs: Date.now() - t0,
    });
  }

  const tool = response.toolUses.find((t) => t.name === "score");
  if (tool) {
    const data = tool.input as { tone_match: number; reason: string };
    return { toneMatch: data.tone_match, reason: data.reason };
  }
  return null;
}
