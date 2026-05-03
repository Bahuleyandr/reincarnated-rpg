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
 * Uses tool_choice to force structured output.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { FormTemplate } from "./types";
import { env } from "../util/env";

import { classify, type ClassifierResult } from "./classify";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = env().ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for Haiku classifier");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function classifyHaiku(
  input: string,
  form: FormTemplate,
): Promise<ClassifierResult> {
  const verbs = form.verbs;
  const verbList = verbs.map((v) => `- ${v}`).join("\n");
  const tools: Anthropic.Tool[] = [
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

  try {
    const response = await getClient().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      tools,
      tool_choice: { type: "tool", name: "classify" },
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

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "classify") {
        const data = block.input as { verb: string; confidence: number };
        // Verify the model returned a verb actually in the whitelist.
        if (!verbs.includes(data.verb)) {
          return classify(input, form);
        }
        if (data.confidence < 0.5) {
          // Low-confidence: fall back to regex which has a deterministic floor.
          return classify(input, form);
        }
        return { verb: data.verb, confidence: data.confidence };
      }
    }
  } catch {
    // Network / rate-limit — fall back gracefully.
    return classify(input, form);
  }

  return classify(input, form);
}
