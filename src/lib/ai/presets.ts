/**
 * Preset catalog for "bring your own LLM".
 *
 * Each preset describes a provider the user can pick from the
 * /settings page. The runtime config is then:
 *   { providerName, baseUrl, model, apiKey }
 *
 * `providerName: "anthropic"` uses the AnthropicProvider with the
 * user-supplied key. Everything else routes through the
 * OpenAICompatibleProvider (OpenAI itself, OpenRouter, MiniMax, Groq,
 * Together, Mistral, local Ollama, or a fully custom endpoint).
 *
 * The model field is a *suggested default*; users can override it on
 * the settings page.
 *
 * baseUrlEditable=false marks presets where the URL is fixed (the SDK
 * or API requires it). Users can still override the model in those
 * cases.
 */

export type ProviderKind = "anthropic" | "openai-compatible";

export interface LlmPreset {
  /** Stable id used in the prefs row + URLs. Lowercase, hyphenated. */
  id: string;
  /** Human-readable display label for the picker. */
  label: string;
  /** Underlying provider implementation. */
  kind: ProviderKind;
  /** Suggested base URL. Anthropic preset doesn't use this. */
  baseUrl?: string;
  /** Whether the user can edit the base URL on the settings page. */
  baseUrlEditable: boolean;
  /** Suggested default model. The user picks the actual model. */
  defaultModel: string;
  /** One-line description shown next to the preset in the picker. */
  blurb: string;
  /** True if this preset typically requires the user to bring an API
   *  key (everything except local-only Ollama). */
  needsApiKey: boolean;
}

export const PRESETS: LlmPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrlEditable: false,
    defaultModel: "claude-sonnet-4-6",
    blurb:
      "The default. Sonnet 4.6 narration, Haiku 4.5 classifier. Best prose quality.",
    needsApiKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    baseUrlEditable: false,
    defaultModel: "gpt-4o-mini",
    blurb: "OpenAI's chat completions endpoint. GPT-4o / GPT-4o-mini work well.",
    needsApiKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlEditable: false,
    defaultModel: "anthropic/claude-sonnet-4-6",
    blurb:
      "Routes to ~100 models behind one API. Use 'provider/model' format.",
    needsApiKey: true,
  },
  {
    id: "minimax",
    label: "MiniMax",
    kind: "openai-compatible",
    baseUrl: "https://api.minimax.io/v1",
    baseUrlEditable: true,
    defaultModel: "MiniMax-M2.7-highspeed",
    blurb:
      "MiniMax M2.7 reasoning model — ~100 tps, strong prose. <think>…</think> tags are stripped automatically.",
    needsApiKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    baseUrlEditable: false,
    defaultModel: "llama-3.3-70b-versatile",
    blurb: "Sub-second narration via custom inference silicon. Llama 3.x family.",
    needsApiKey: true,
  },
  {
    id: "together",
    label: "Together AI",
    kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    baseUrlEditable: false,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    blurb: "Open-weight model hosting; broad catalog including Llama and Mistral.",
    needsApiKey: true,
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    baseUrlEditable: false,
    defaultModel: "mistral-large-latest",
    blurb: "Mistral's official chat endpoint. Mistral Large + Codestral.",
    needsApiKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    baseUrlEditable: false,
    defaultModel: "deepseek-chat",
    blurb: "DeepSeek-V3 chat + reasoner. Strong cost/performance.",
    needsApiKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    baseUrlEditable: true,
    defaultModel: "llama3.2",
    blurb:
      "Run a model on your own machine. No API key needed; use 'ollama' as a placeholder.",
    needsApiKey: false,
  },
  {
    id: "custom",
    label: "Custom endpoint",
    kind: "openai-compatible",
    baseUrl: "",
    baseUrlEditable: true,
    defaultModel: "",
    blurb:
      "Any other OpenAI-compatible /chat/completions endpoint. Bring your own URL.",
    needsApiKey: true,
  },
];

export function findPreset(id: string): LlmPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function isValidPresetId(id: string): boolean {
  return PRESETS.some((p) => p.id === id);
}
