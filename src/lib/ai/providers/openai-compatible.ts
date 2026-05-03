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
  ProviderToolUse,
} from "../provider";
import { withRetry } from "../../util/retry";

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

    const text = choice.message.content ?? "";
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
}
