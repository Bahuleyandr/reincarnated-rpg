/**
 * LLM-as-judge — Sonnet 4.6 grades narration against the form's
 * sample corpus. Used by the eval runner for `tone.toneMatch` 1-5
 * scoring.
 *
 * Self-grading caveat: same model family judging itself biases
 * toward the model's own style. Treat scores as a smoke test, not a
 * ground truth — supplement with manual spot-check on every prompt
 * change. This is what ARCHITECTURE.md / EVAL.md flag as a known
 * weakness of LLM-as-judge.
 *
 * Returns null when ANTHROPIC_API_KEY is unset so the eval runner
 * can skip rubric scoring without erroring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import type { Db } from "../src/lib/db/client";
import { recordAiCall } from "../src/lib/util/ai-telemetry";
import { env } from "../src/lib/util/env";

interface JudgeArgs {
  formId: string;
  scenarioId: string;
  narration: string;
  /** Optional telemetry sink — sessionId is just the scenario id here
   *  since judge calls aren't tied to a real session. */
  telemetry?: { db: Db; sessionId?: string };
}

export interface JudgeResult {
  toneMatch: number;
  reason: string;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = env().ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function judgeNarration(
  args: JudgeArgs,
): Promise<JudgeResult | null> {
  if (!env().ANTHROPIC_API_KEY) return null;

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

  const tools: Anthropic.Tool[] = [
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

  const t0 = Date.now();
  let response;
  try {
    response = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      tools,
      tool_choice: { type: "tool", name: "score" },
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
        model: "claude-sonnet-4-6",
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
      model: "claude-sonnet-4-6",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - t0,
    });
  }

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "score") {
      const data = block.input as { tone_match: number; reason: string };
      return { toneMatch: data.tone_match, reason: data.reason };
    }
  }
  return null;
}
