/**
 * AIProvider — single low-level boundary between our code and any
 * LLM API. Everything above this layer (RemoteNarrator,
 * classify-haiku, tone judge, eval judge) only sees this interface;
 * the concrete provider (Anthropic / OpenAI-compatible / future
 * Bedrock+Vertex+local) is selected via env at startup.
 *
 * Shapes track Anthropic's because that's our default — the
 * OpenAICompatibleProvider translates internally.
 *
 * Per the paperclip-version's comparison: the provider stays
 * stateless. Telemetry recording (writing to ai_calls) is the
 * caller's job — providers just return their usage block.
 */

export interface ProviderTool {
  name: string;
  description: string;
  /** JSON Schema. Anthropic calls this `input_schema`; OpenAI calls
   *  it `parameters`. We normalize on the Anthropic shape; the
   *  OpenAI provider translates. */
  input_schema: Record<string, unknown>;
}

export interface ProviderSystemPart {
  type: "text";
  text: string;
  /** Anthropic-specific cache hint. OpenAI providers may ignore. */
  cache_control?: { type: "ephemeral" };
}

export interface ProviderMessage {
  role: "user" | "assistant";
  content: string;
}

export type ToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

export interface CompleteArgs {
  model: string;
  system?: ProviderSystemPart[];
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  toolChoice?: ToolChoice;
  maxTokens: number;
}

export interface ProviderToolUse {
  /** A stable id for matching tool_use ↔ tool_result. Optional —
   *  the orchestrator doesn't need it for our flow but the OpenAI
   *  provider populates it from `tool_calls[].id`. */
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface CompleteResponse {
  text: string;
  toolUses: ProviderToolUse[];
  usage: ProviderUsage;
  stopReason: string;
  rawModel: string;
}

export interface CompleteStreamEvents {
  /** Fires for each text delta as it arrives. Concatenating every
   *  delta yields the final text. Implementations are NOT required to
   *  guarantee any particular chunk size or word boundary. */
  onText?: (delta: string) => void;
  /** Fires when a tool_use block completes (Anthropic) or when the
   *  tool_calls array is finalized (OpenAI-compat). For OpenAI-compat
   *  this typically fires once at the end since tool_calls arrive
   *  fully formed in the final delta — for Anthropic, it can fire
   *  multiple times as separate tool_use blocks finish. */
  onToolUse?: (toolUse: ProviderToolUse) => void;
}

export interface AIProvider {
  /** Provider identifier — written to ai_calls.model for routing
   *  (the per-call model string is also written separately). */
  readonly providerName: string;

  complete(args: CompleteArgs): Promise<CompleteResponse>;

  /** Optional streaming variant. When implemented, the provider fires
   *  `events.onText(delta)` as text chunks arrive and resolves with the
   *  full CompleteResponse once the stream finishes. Callers that
   *  don't care about streaming can keep using `complete()`. */
  completeStream?(
    args: CompleteArgs,
    events: CompleteStreamEvents,
  ): Promise<CompleteResponse>;
}
