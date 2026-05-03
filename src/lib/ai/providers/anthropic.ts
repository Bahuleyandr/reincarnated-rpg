/**
 * Anthropic provider. Default for all our prod paths.
 * Maps `CompleteArgs` 1:1 to the Messages API.
 */
import Anthropic from "@anthropic-ai/sdk";

import type {
  AIProvider,
  CompleteArgs,
  CompleteResponse,
  ProviderToolUse,
} from "../provider";
import { env } from "../../util/env";

let cached: Anthropic | null = null;
function getClient(apiKey: string): Anthropic {
  if (!cached) cached = new Anthropic({ apiKey });
  return cached;
}

export class AnthropicProvider implements AIProvider {
  readonly providerName = "anthropic";

  async complete(args: CompleteArgs): Promise<CompleteResponse> {
    const apiKey = env().ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY required for AnthropicProvider. Set NARRATOR=template or AI_PROVIDER=openai-compatible.",
      );
    }
    const client = getClient(apiKey);

    const tools = args.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));

    const toolChoice =
      args.toolChoice?.type === "tool"
        ? ({ type: "tool", name: args.toolChoice.name } as const)
        : args.toolChoice?.type === "any"
          ? ({ type: "any" } as const)
          : args.toolChoice?.type === "auto"
            ? ({ type: "auto" } as const)
            : undefined;

    const response = await client.messages.create({
      model: args.model,
      max_tokens: args.maxTokens,
      system: args.system?.map((s) => ({
        type: "text",
        text: s.text,
        ...(s.cache_control ? { cache_control: s.cache_control } : {}),
      })),
      messages: args.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools,
      tool_choice: toolChoice,
    });

    let text = "";
    const toolUses: ProviderToolUse[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text: text.trim(),
      toolUses,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      stopReason: response.stop_reason ?? "unknown",
      rawModel: response.model,
    };
  }
}
