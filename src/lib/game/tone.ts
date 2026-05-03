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
 *      layer 1 passed).
 *      Asks Haiku whether the prose is in second-person and on-form.
 *      Returns a 1-5 score plus a one-line reason.
 *
 * Per PLAN.md, a failing tone check should trigger one regen of the
 * narrator. Day 9 implements the detector; the regen wiring lands in
 * turn.ts on Day 12.
 */
import Anthropic from "@anthropic-ai/sdk";

import { env } from "../util/env";
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

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = env().ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for tone judge");
    client = new Anthropic({ apiKey });
  }
  return client;
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
): Promise<ToneResult> {
  const fast = checkToneFast(narration, form);
  if (!fast.ok) return fast;

  const tools: Anthropic.Tool[] = [
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

  try {
    const response = await getClient().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      tools,
      tool_choice: { type: "tool", name: "judge_tone" },
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

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "judge_tone") {
        const data = block.input as { score: number; reason: string };
        return {
          ok: data.score >= 3,
          violations: [],
          score: data.score,
          reason: data.reason,
        };
      }
    }
  } catch {
    // Judge unavailable; trust layer 1.
    return fast;
  }
  return fast;
}
