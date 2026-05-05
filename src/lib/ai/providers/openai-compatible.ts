/**
 * OpenAI-compatible provider. Targets the /v1/chat/completions
 * API spoken by OpenAI itself, OpenRouter, Together, vLLM,
 * llama.cpp's server mode, and Ollama (with --api-mode openai).
 *
 * Uses fetch directly to avoid pulling in the openai SDK as a dep.
 * Trade-off: less ergonomic streaming, but our flow uses the
 * non-streaming path so this is fine.
 *
 * Configure via:
 *   AI_PROVIDER=openai-compatible
 *   OPENAI_BASE_URL=https://openrouter.ai/api/v1   # or http://localhost:11434/v1 for Ollama
 *   OPENAI_API_KEY=sk-...                          # bearer; set to "ollama" for local
 *   OPENAI_MODEL=anthropic/claude-sonnet-4-6       # provider-prefixed for OpenRouter, etc.
 *
 * Translation gotchas vs Anthropic:
 *   - System prompt: Anthropic accepts an array of text parts each
 *     with cache_control. OpenAI accepts ONE system message string.
 *     We concatenate parts with double-newline; cache_control is
 *     dropped (OpenAI's prompt caching is automatic on long prefixes).
 *   - Tools: Anthropic uses `input_schema`; OpenAI nests JSON Schema
 *     under `function.parameters`. Same schema body either way.
 *   - tool_choice: Anthropic uses {type:"tool",name}; OpenAI uses
 *     {type:"function",function:{name}}.
 *   - Tool calls: Anthropic returns content[] with tool_use blocks;
 *     OpenAI returns choices[0].message.tool_calls[] with arguments
 *     as a JSON-encoded string (we parse). Multiple tool_calls per
 *     response are supported; we collect them all.
 */
import type {
  AIProvider,
  CompleteArgs,
  CompleteResponse,
  CompleteStreamEvents,
  ProviderToolUse,
} from "../provider";
import { withRetry } from "../../util/retry";
import {
  createReasoningFilter,
  stripReasoningTags,
} from "../strip-reasoning-tags";

interface OpenAIChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  max_tokens: number;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?:
    | "auto"
    | "required"
    | "none"
    | { type: "function"; function: { name: string } };
}

interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Some providers (notably OpenAI itself) report cached prompt
     *  tokens here. Optional. */
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly providerName = "openai-compatible";

  constructor(
    private baseUrl: string = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    private apiKey: string = process.env.OPENAI_API_KEY ?? "",
  ) {
    if (!this.apiKey) {
      throw new Error(
        "OPENAI_API_KEY required for OpenAICompatibleProvider. Use 'ollama' for local Ollama.",
      );
    }
  }

  async complete(args: CompleteArgs): Promise<CompleteResponse> {
    const systemText = args.system?.map((s) => s.text).join("\n\n") ?? "";

    const messages: OpenAIChatRequest["messages"] = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    for (const m of args.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const tools = args.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const toolChoice: OpenAIChatRequest["tool_choice"] =
      args.toolChoice?.type === "tool"
        ? { type: "function", function: { name: args.toolChoice.name } }
        : args.toolChoice?.type === "any"
          ? "required"
          : args.toolChoice?.type === "auto"
            ? "auto"
            : undefined;

    const body: OpenAIChatRequest = {
      model: args.model,
      messages,
      max_tokens: args.maxTokens,
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };

    const data = await withRetry<OpenAIChatResponse>(async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text();
        const err = new Error(
          `OpenAI-compatible API ${response.status}: ${text.slice(0, 500)}`,
        ) as Error & { status?: number };
        err.status = response.status; // exposed for isRetryableError
        throw err;
      }
      return (await response.json()) as OpenAIChatResponse;
    });
    const choice = data.choices[0];
    if (!choice) {
      throw new Error("OpenAI-compatible response had no choices");
    }

    // Reasoning-model output (MiniMax-M2.7, DeepSeek-R1, QwQ, etc.)
    // wraps chain-of-thought in `<think>…</think>` blocks. Strip
    // before returning so the narrator gets only the answer.
    const text = stripReasoningTags(choice.message.content ?? "");
    const toolUses: ProviderToolUse[] = (choice.message.tool_calls ?? []).map(
      (tc) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          // Some local backends emit malformed JSON on the first try.
          // Surface as empty input; the orchestrator's Zod validation
          // will catch the missing required fields and retry.
          input = {};
        }
        return { id: tc.id, name: tc.function.name, input };
      },
    );

    return {
      text: text.trim(),
      toolUses,
      usage: {
        inputTokens:
          data.usage.prompt_tokens -
          (data.usage.prompt_tokens_details?.cached_tokens ?? 0),
        outputTokens: data.usage.completion_tokens,
        cacheReadTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
        // OpenAI-compatible API doesn't separately report cache writes —
        // caching is automatic and not billed differently per request.
        cacheCreateTokens: 0,
      },
      stopReason: choice.finish_reason,
      rawModel: data.model,
    };
  }

  /**
   * Streaming variant. Sends the same body with `stream: true`,
   * parses the SSE response line-by-line, fires onText for each
   * `delta.content` chunk, and accumulates tool_calls for the final
   * resolution. The OpenAI streaming protocol delivers tool_call
   * arguments incrementally — we buffer them by index and flush at
   * end-of-stream.
   *
   * Falls back to non-streaming complete() if the response isn't
   * SSE (some self-hosted backends ignore stream:true).
   */
  async completeStream(
    args: CompleteArgs,
    events: CompleteStreamEvents,
  ): Promise<CompleteResponse> {
    const systemText = args.system?.map((s) => s.text).join("\n\n") ?? "";
    const messages: OpenAIChatRequest["messages"] = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    for (const m of args.messages)
      messages.push({ role: m.role, content: m.content });

    const tools = args.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
    const toolChoice: OpenAIChatRequest["tool_choice"] =
      args.toolChoice?.type === "tool"
        ? { type: "function", function: { name: args.toolChoice.name } }
        : args.toolChoice?.type === "any"
          ? "required"
          : args.toolChoice?.type === "auto"
            ? "auto"
            : undefined;

    const body = {
      model: args.model,
      messages,
      max_tokens: args.maxTokens,
      stream: true,
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(
        `OpenAI-compatible API ${response.status}: ${text.slice(0, 500)}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    if (!response.body) {
      // Some backends drop the stream body; fall through to non-streaming.
      return this.complete(args);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    // Reasoning-model output filter — drops `<think>…</think>` blocks
    // chunk-by-chunk so the player never sees a chain-of-thought
    // monologue, even mid-stream. No-op for non-reasoning models.
    const reasoningFilter = createReasoningFilter();
    let stopReason = "stop";
    let rawModel = args.model;
    let usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    } = {};
    // tool_calls arrive in chunks per index; we buffer arguments as
    // strings and parse the JSON once at end-of-stream.
    const toolBuffers = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE messages are separated by \n\n. Each starts with "data: ".
      let nl: number;
      while ((nl = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          let json: {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            model?: string;
            usage?: typeof usage;
          };
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          if (json.model) rawModel = json.model;
          if (json.usage) usage = json.usage;
          const choice = json.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) stopReason = choice.finish_reason;
          const delta = choice.delta;
          if (!delta) continue;
          if (delta.content) {
            // Filter out <think>…</think> chunks before storing or
            // emitting. The full final text passes through the
            // streaming filter chunk by chunk; visible deltas are
            // what the user-facing onText callback receives.
            const visible = reasoningFilter.feed(delta.content);
            if (visible) {
              text += visible;
              events.onText?.(visible);
            }
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const cur = toolBuffers.get(tc.index) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name = tc.function.name;
              if (tc.function?.arguments)
                cur.arguments += tc.function.arguments;
              toolBuffers.set(tc.index, cur);
            }
          }
        }
      }
    }

    const toolUses: ProviderToolUse[] = [];
    for (const [, t] of toolBuffers) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(t.arguments);
      } catch {
        input = {};
      }
      const tu = { id: t.id, name: t.name, input };
      toolUses.push(tu);
      events.onToolUse?.(tu);
    }

    // Drain any tail held by the reasoning-filter (a partial open
    // tag that turned out to just be literal text, etc.). Empty
    // when the stream ended mid-think — the filter intentionally
    // drops that.
    const tail = reasoningFilter.end();
    if (tail) {
      text += tail;
      events.onText?.(tail);
    }

    return {
      text: text.trim(),
      toolUses,
      usage: {
        inputTokens:
          (usage.prompt_tokens ?? 0) -
          (usage.prompt_tokens_details?.cached_tokens ?? 0),
        outputTokens: usage.completion_tokens ?? 0,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreateTokens: 0,
      },
      stopReason,
      rawModel,
    };
  }
}
