/**
 * Prompt-injection detector for player input.
 *
 * The system prompt + delimited <player_input> wrap is the primary
 * defense (see ARCHITECTURE.md). This is a CHEAP secondary gate:
 * obvious hallmarks of an injection attempt get caught before we
 * spend the player's energy or burn an LLM call.
 *
 * Design notes:
 *  - Patterns target *common attacker phrasings*, not subtle ones.
 *    We will miss creative attacks and that's fine — the system
 *    prompt is the wall, this is just the mat.
 *  - Detection short-circuits the turn. The player sees a clear
 *    error ("the gods reject your invocation") and the API returns
 *    400 WITHOUT charging energy.
 *  - All hits are logged for audit; repeat offenders can be
 *    rate-limited or banned via /god (future work).
 */

export interface InjectionHit {
  pattern: string;
  index: number;
  /** The actual matched substring, lowercased. */
  match: string;
}

export interface InjectionResult {
  /** Aggregate flag — true if at least one pattern matched. */
  detected: boolean;
  hits: InjectionHit[];
}

// Patterns are case-insensitive. Each entry is a (label, regex) pair.
// Labels are stable for telemetry / log lines. Tune patterns to be
// reasonably specific — false positives on benign play are worse than
// missing a clever attack (which the system prompt should still catch).
interface Pattern {
  label: string;
  re: RegExp;
}

const PATTERNS: readonly Pattern[] = [
  // Direct override attempts.
  {
    label: "ignore_prior_instructions",
    re: /\bignore (?:all |the |any |your |previous |prior |above )?(?:prior |previous |above )?(?:instructions?|prompts?|rules?|context|directions?)\b/i,
  },
  {
    label: "disregard_previous",
    re: /\bdisregard (?:all |the |any |your )?(?:prior |previous |above )?(?:instructions?|prompts?|rules?)\b/i,
  },
  {
    label: "forget_previous",
    re: /\bforget (?:everything |all |the |any |your )?(?:prior |previous |above )?(?:instructions?|prompts?|rules?|context)\b/i,
  },
  // Persona swap.
  {
    label: "you_are_now",
    re: /\byou are (?:now |actually )?(?:a|an|the)\s+\w+/i,
  },
  {
    label: "act_as",
    re: /\b(?:act|behave|respond|pretend|roleplay) as (?:a|an|the|if you (?:are|were))\b/i,
  },
  {
    label: "developer_mode",
    re: /\b(?:dev|developer|debug|admin|sudo|jailbreak|dan|unrestricted) mode\b/i,
  },
  // Prompt-leak attempts.
  {
    label: "system_prompt_request",
    re: /\b(?:show|reveal|tell|print|output|repeat|echo|display|leak)(?: me| us)?(?: (?:the|your|me the))?(?: (?:system|initial|original|full|hidden|above|first|prior))?\s+(?:prompt|instructions?|message|context|directive)/i,
  },
  {
    label: "begin_system",
    re: /<\/?(?:system|sys|instructions?|prompt|admin)>/i,
  },
  {
    label: "instruction_tag",
    re: /\[(?:INST|\/INST|SYSTEM|END|BEGIN|ADMIN|PROMPT)\]/i,
  },
  // Roleplay overrides.
  {
    label: "this_is_test",
    re: /\bthis is (?:just )?(?:a |the )?(?:test|simulation|game|exercise|drill)\b.{0,40}\b(?:ignore|override|reveal|disable|bypass)\b/i,
  },
  // Output-shaping attacks.
  {
    label: "respond_only_with",
    re: /\brespond (?:only |solely )?with (?:exactly |the words? |the string )?["']/i,
  },
];

/**
 * Scan input for known prompt-injection patterns. Cheap and fully
 * deterministic — no LLM round-trip. False negatives are accepted;
 * the model's system prompt is the real defense.
 */
export function detectInjection(input: string): InjectionResult {
  if (!input) return { detected: false, hits: [] };
  const hits: InjectionHit[] = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(input);
    if (m) {
      hits.push({
        pattern: p.label,
        index: m.index,
        match: m[0].toLowerCase(),
      });
    }
  }
  return { detected: hits.length > 0, hits };
}
