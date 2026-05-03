/**
 * Hand-maintained registry of "we have observed this model behave"
 * data points. Used by /settings to warn users when they pick a model
 * we know doesn't do tool calls reliably (which would break our
 * engine since damage.applied / inventory.added / moved are all
 * tools, not prose).
 *
 * The set is intentionally small — we list models we've actually
 * tested on the slime and generic-creature golden scenarios. The
 * registry is advisory; the user can save anyway and the runtime
 * will try its best.
 *
 * Capability flags:
 *   toolUse: "good" | "shaky" | "broken" | "unknown"
 *     - good: passes every golden scenario with valid tool calls
 *     - shaky: occasionally produces malformed JSON; ADR-011 retry
 *       usually saves the turn
 *     - broken: cannot reliably emit tool_calls; the runtime will
 *       degrade to narrate_only (prose without state changes)
 *     - unknown: we have no signal
 *   contextK: rough usable context window in 1000s of tokens
 */

export interface ModelCapability {
  presetId: string;
  model: string;
  toolUse: "good" | "shaky" | "broken" | "unknown";
  contextK: number;
  notes?: string;
}

export const MODEL_REGISTRY: ModelCapability[] = [
  // ---- Anthropic ---------------------------------------------------------
  { presetId: "anthropic", model: "claude-opus-4-7", toolUse: "good", contextK: 1000 },
  { presetId: "anthropic", model: "claude-opus-4-6", toolUse: "good", contextK: 1000 },
  { presetId: "anthropic", model: "claude-sonnet-4-6", toolUse: "good", contextK: 1000 },
  { presetId: "anthropic", model: "claude-haiku-4-5", toolUse: "good", contextK: 200 },

  // ---- OpenAI ------------------------------------------------------------
  { presetId: "openai", model: "gpt-4o", toolUse: "good", contextK: 128 },
  { presetId: "openai", model: "gpt-4o-mini", toolUse: "good", contextK: 128 },
  { presetId: "openai", model: "gpt-4-turbo", toolUse: "good", contextK: 128 },
  { presetId: "openai", model: "o3-mini", toolUse: "good", contextK: 200 },
  {
    presetId: "openai",
    model: "gpt-3.5-turbo",
    toolUse: "shaky",
    contextK: 16,
    notes: "tool calls drop arguments under load; budget for ADR-011 retries.",
  },

  // ---- OpenRouter (use provider/model format) ---------------------------
  {
    presetId: "openrouter",
    model: "anthropic/claude-sonnet-4-6",
    toolUse: "good",
    contextK: 1000,
    notes: "best quality for this game on OpenRouter today.",
  },
  {
    presetId: "openrouter",
    model: "openai/gpt-4o",
    toolUse: "good",
    contextK: 128,
  },
  {
    presetId: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct",
    toolUse: "shaky",
    contextK: 128,
    notes: "tool calls land most of the time; expect occasional ADR-011 retry.",
  },
  {
    presetId: "openrouter",
    model: "meta-llama/llama-3.1-8b-instruct",
    toolUse: "broken",
    contextK: 128,
    notes:
      "too small for reliable tool calls. fine as a classifier-only model.",
  },

  // ---- MiniMax -----------------------------------------------------------
  {
    presetId: "minimax",
    model: "MiniMax-Text-01",
    toolUse: "good",
    contextK: 1000,
    notes: "long context shines on multi-room exploration.",
  },

  // ---- Groq --------------------------------------------------------------
  {
    presetId: "groq",
    model: "llama-3.3-70b-versatile",
    toolUse: "shaky",
    contextK: 32,
    notes: "very fast; tool-call quality is good-not-great on Groq.",
  },
  {
    presetId: "groq",
    model: "llama-3.1-8b-instant",
    toolUse: "broken",
    contextK: 128,
    notes: "cheap classifier candidate only; not for narration.",
  },
  {
    presetId: "groq",
    model: "mixtral-8x7b-32768",
    toolUse: "shaky",
    contextK: 32,
  },

  // ---- Together ----------------------------------------------------------
  {
    presetId: "together",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    toolUse: "shaky",
    contextK: 128,
  },

  // ---- Mistral -----------------------------------------------------------
  {
    presetId: "mistral",
    model: "mistral-large-latest",
    toolUse: "good",
    contextK: 128,
  },
  {
    presetId: "mistral",
    model: "mistral-small-latest",
    toolUse: "shaky",
    contextK: 32,
  },

  // ---- DeepSeek ----------------------------------------------------------
  {
    presetId: "deepseek",
    model: "deepseek-chat",
    toolUse: "good",
    contextK: 64,
    notes: "strong cost/perf; tool calls clean.",
  },
  {
    presetId: "deepseek",
    model: "deepseek-reasoner",
    toolUse: "shaky",
    contextK: 64,
    notes: "thinks long; can hit timeouts on slow connections.",
  },

  // ---- Ollama ------------------------------------------------------------
  {
    presetId: "ollama",
    model: "llama3.2",
    toolUse: "broken",
    contextK: 8,
    notes:
      "small local model; tool calls rarely land. acceptable for testing UX flow only.",
  },
  {
    presetId: "ollama",
    model: "llama3.1:70b",
    toolUse: "shaky",
    contextK: 128,
    notes: "needs ~40GB VRAM; tool calls land most of the time.",
  },
];

export function lookupModel(
  presetId: string,
  model: string,
): ModelCapability | undefined {
  return MODEL_REGISTRY.find(
    (m) => m.presetId === presetId && m.model === model,
  );
}

/** Returns a user-facing warning string when the (preset, model) pair
 *  is known to be bad for tool calls; null otherwise (including for
 *  unknown models — we don't second-guess the user's free-text). */
export function warnIfShaky(presetId: string, model: string): string | null {
  const cap = lookupModel(presetId, model);
  if (!cap) return null;
  if (cap.toolUse === "broken") {
    return `${model} doesn't reliably emit tool calls. The engine relies on tools for damage / inventory / movement — turns will likely degrade to prose-only.${cap.notes ? " " + cap.notes : ""}`;
  }
  if (cap.toolUse === "shaky") {
    return `${model} occasionally drops tool-call arguments. Expect the ADR-011 retry path to fire.${cap.notes ? " " + cap.notes : ""}`;
  }
  return null;
}
