/**
 * Tone drift detector — Day 9.
 *
 * Two layers, cheap-first:
 *
 *   1. Negative-vocab regex check (free, deterministic).
 *      If any banned word from the form's negativeVocab appears in
 *      narration as a word boundary match, fail immediately.
 *
 *   2. Haiku 4.5 1-shot judge (~$0.0005, only if NARRATOR=remote and
 *      layer 1 passed). Asks Haiku whether the prose is in second-
 *      person and on-form. Returns a 1-5 score plus a one-line reason.
 *
 * Provider-agnostic via `getProvider()` — works with Anthropic or
 * OpenAI-compatible.
 */
import { getProvider } from "../ai/factory";
import type { ProviderTool } from "../ai/provider";
import type { Db } from "../db/client";
import { recordAiCall } from "../util/ai-telemetry";

import type { FormTemplate } from "./types";

export interface ToneResult {
  ok: boolean;
  /** Negative-vocab matches found, if any. */
  violations: string[];
  /** Optional 1-5 judge score (only set when Haiku check ran). */
  score?: number;
  /** Optional judge reason. */
  reason?: string;
}

interface FormWithNegativeVocab extends FormTemplate {
  negativeVocab?: { words: string[] };
}

export function checkNegativeVocab(
  narration: string,
  form: FormTemplate,
): string[] {
  const banned = (form as FormWithNegativeVocab).negativeVocab?.words ?? [];
  const lowered = narration.toLowerCase();
  const hits: string[] = [];
  for (const word of banned) {
    const re = new RegExp(`\\b${escapeRe(word.toLowerCase())}\\b`);
    if (re.test(lowered)) hits.push(word);
  }
  return hits;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Layer-1 only — sync, free. Use when NARRATOR=template or you don't
 * want to pay for the Haiku judge.
 */
export function checkToneFast(
  narration: string,
  form: FormTemplate,
): ToneResult {
  const violations = checkNegativeVocab(narration, form);
  return { ok: violations.length === 0, violations };
}

/**
 * Layer-1 + layer-2. Used when NARRATOR=remote. Returns ok=false on
 * either negativeVocab violation OR judge score <= 2.
 */
export async function checkTone(
  narration: string,
  form: FormTemplate,
  telemetry?: { db: Db; sessionId?: string },
): Promise<ToneResult> {
  const fast = checkToneFast(narration, form);
  if (!fast.ok) return fast;

  const tools: ProviderTool[] = [
    {
      name: "judge_tone",
      description:
        "Judge whether the narration is in second-person and on-form.",
      input_schema: {
        type: "object",
        properties: {
          score: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "1=clearly off-form, 5=excellent on-form",
          },
          reason: {
            type: "string",
            description: "One sentence explaining the score.",
          },
        },
        required: ["score", "reason"],
      },
    },
  ];

  const provider = getProvider();
  const t0 = Date.now();
  try {
    const response = await provider.complete({
      model: "claude-haiku-4-5",
      maxTokens: 256,
      tools,
      toolChoice: { type: "tool", name: "judge_tone" },
      messages: [
        {
          role: "user",
          content: `Form: ${form.id}
Narration to judge:
"${narration}"

Score 1-5: is this second-person and tonally on-form for the slime form? A slime has no body, no language, no vision in human terms — it senses through chemistry, vibration, and thermal contact. Penalize human-flavored verbs about the player, but NPCs may still have eyes/voices/etc.`,
        },
      ],
    });

    if (telemetry?.db) {
      await recordAiCall(telemetry.db, {
        sessionId: telemetry.sessionId,
        callType: "tone_judge",
        model: "claude-haiku-4-5",
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheCreateTokens: response.usage.cacheCreateTokens,
        durationMs: Date.now() - t0,
      });
    }

    const tool = response.toolUses.find((t) => t.name === "judge_tone");
    if (tool) {
      const data = tool.input as { score: number; reason: string };
      return {
        ok: data.score >= 3,
        violations: [],
        score: data.score,
        reason: data.reason,
      };
    }
  } catch (err) {
    if (telemetry?.db) {
      await recordAiCall(telemetry.db, {
        sessionId: telemetry.sessionId,
        callType: "tone_judge",
        model: "claude-haiku-4-5",
        durationMs: Date.now() - t0,
        success: false,
        errorMsg: err instanceof Error ? err.message : String(err),
      });
    }
    return fast;
  }
  return fast;
}
