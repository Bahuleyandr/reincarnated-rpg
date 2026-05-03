/**
 * Anthropic provider. Default for all our prod paths.
 * Maps `CompleteArgs` 1:1 to the Messages API.
 *
 * The constructor optionally takes a per-instance `apiKey` (used by the
 * BYO-LLM flow when a user has saved their own key on /settings); when
 * omitted it falls back to `env().ANTHROPIC_API_KEY` like before.
 */
import Anthropic from "@anthropic-ai/sdk";

import type {
  AIProvider,
  CompleteArgs,
  CompleteResponse,
  CompleteStreamEvents,
  ProviderToolUse,
} from "../provider";
import { env } from "../../util/env";
import { withRetry } from "../../util/retry";

export class AnthropicProvider implements AIProvider {
  readonly providerName = "anthropic";
  private client: Anthropic | null = null;
  private overrideKey?: string;

  constructor(opts: { apiKey?: string } = {}) {
    this.overrideKey = opts.apiKey;
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.overrideKey ?? env().ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY required for AnthropicProvider. Save a key on /settings, or set NARRATOR=template, or set AI_PROVIDER=openai-compatible.",
      );
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async complete(args: CompleteArgs): Promise<CompleteResponse> {
    const client = this.getClient();

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

    const response = await withRetry(() =>
      client.messages.create({
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
      }),
    );

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

  /**
   * Streaming variant. Uses the SDK's `client.messages.stream(...)`
   * helper which fires text + tool_use deltas as they arrive. We
   * accumulate locally and call back with each chunk so the API
   * route can pipe to SSE.
   *
   * Resolves with the same CompleteResponse shape as `complete()` —
   * callers that don't care about streaming can ignore the events
   * arg and treat this exactly like `complete`.
   */
  async completeStream(
    args: CompleteArgs,
    events: CompleteStreamEvents,
  ): Promise<CompleteResponse> {
    const client = this.getClient();

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

    const stream = client.messages.stream({
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

    if (events.onText) {
      stream.on("text", (delta) => {
        events.onText?.(delta);
      });
    }

    const final = await stream.finalMessage();

    let text = "";
    const toolUses: ProviderToolUse[] = [];
    for (const block of final.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        const tu = {
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
        toolUses.push(tu);
        events.onToolUse?.(tu);
      }
    }

    return {
      text: text.trim(),
      toolUses,
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheCreateTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
      stopReason: final.stop_reason ?? "unknown",
      rawModel: final.model,
    };
  }
}
