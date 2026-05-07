import type { FormTemplate, TurnRisk } from "./types";

export interface ClassifyTurnRiskArgs {
  input: string;
  intent: string;
  form: FormTemplate;
  presetVerb?: string | null;
  hasRollOverride?: boolean;
}

const FORM_RISKY_VERBS: Record<string, ReadonlySet<string>> = {
  "lesser-slime": new Set([
    "dissolve",
    "smother",
    "split",
    "tide_up",
    "wyrm_listen",
  ]),
  "cursed-book": new Set([
    "bind_reader",
    "bleed_ink",
    "rewrite_self",
    "wyrm_inscription",
  ]),
  "dragon-egg": new Set(["hatch_partial", "wyrm_kin_call"]),
  "dungeon-core": new Set([
    "bleed_integrity",
    "siphon_intruder",
    "false_room",
    "wyrm_signal",
  ]),
  "generic-creature": new Set(["attack"]),
};

const GLOBAL_RISKY_VERBS = new Set([
  "attack",
  "bind_reader",
  "bleed_integrity",
  "dissolve",
  "hatch_partial",
  "smother",
  "siphon_intruder",
  "wyrm_signal",
]);

const RISKY_INPUT_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "violence",
    pattern:
      /\b(?:attack|ambush|bite|break|burn|charge|choke|crush|destroy|devour|fight|kill|maul|murder|shatter|slash|slay|smash|smother|stab|strike)\b/i,
  },
  {
    reason: "forced_control",
    pattern:
      /\b(?:bind|blackmail|coerce|command|compel|control|curse|dominate|force|possess|steal|trap)\b/i,
  },
  {
    reason: "body_or_self_cost",
    pattern:
      /\b(?:bleed|crack|dissolve|dive|drain|hatch|jump|leap|rush|sacrifice|shatter myself|split|siphon|tear myself)\b/i,
  },
  {
    reason: "major_world_change",
    pattern:
      /\b(?:collapse|flood|reshape|summon|wyrm)\b/i,
  },
];

/**
 * Decide whether this turn should expose the dice. The default is
 * intentionally generous: ordinary exploration, movement, sensing,
 * waiting, and most form-native actions cleanly advance the fiction.
 * Dice are for danger, coercion, self-cost, or explicit test/eval
 * overrides.
 */
export function classifyTurnRisk(args: ClassifyTurnRiskArgs): TurnRisk {
  if (args.hasRollOverride) {
    return { level: "risky", reason: "roll_override" };
  }

  const intent = args.intent;
  const formRisky = FORM_RISKY_VERBS[args.form.id];
  if (formRisky?.has(intent)) {
    return { level: "risky", reason: `verb:${intent}` };
  }
  if (GLOBAL_RISKY_VERBS.has(intent)) {
    return { level: "risky", reason: `verb:${intent}` };
  }

  if (args.presetVerb) {
    const preset = args.presetVerb;
    const presetRisky = FORM_RISKY_VERBS[args.form.id]?.has(preset) ?? false;
    if (presetRisky || GLOBAL_RISKY_VERBS.has(preset)) {
      return { level: "risky", reason: `preset:${preset}` };
    }
  }

  const input = args.input.toLowerCase();
  const matched = RISKY_INPUT_PATTERNS.find((entry) =>
    entry.pattern.test(input),
  );
  if (matched) {
    return { level: "risky", reason: `input:${matched.reason}` };
  }

  return { level: "safe", reason: "ordinary_action" };
}
