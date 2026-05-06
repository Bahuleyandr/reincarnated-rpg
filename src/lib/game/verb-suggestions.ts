/**
 * Verb-button suggestions for the /play page (Phase 11 P9).
 *
 * "Choice as illusion, direction as authored." Each turn surfaces
 * three preset buttons + an escape-hatch ("say something else…")
 * text input. The presets come from one of three sources, in
 * priority order:
 *
 *   1. **Active arc beat's `suggestedVerbs`** — when an authored
 *      moment is firing, the buttons are the arc-writer's three
 *      curated next-moves. Story-shaped.
 *   2. **Form's `iconicVerbs`** — when no beat is active, surface
 *      the form's three most-canonical verbs. Form-shaped.
 *   3. **First three entries of `form.verbs[]`** — pure fallback.
 *
 * The escape hatch is always present and routes to the LLM
 * narrator (via /api/turn/stream's body.useRemoteNarrator path
 * when env supports it).
 *
 * Pure — no DB, no events. Called from /api/state and the
 * /api/turn/stream done payload so the play page never needs a
 * separate fetch.
 */
import type { Beat, BeatPack, SuggestedVerb, SuggestedVerbsField } from "./beats";
import { evaluate as evaluateTrigger } from "./beats";
import type { Event, FormTemplate, Projection } from "./types";

export interface VerbSuggestion {
  verb: string;
  label: string;
  description: string;
  /** Where this came from — useful for telemetry and the UI to
   *  render a subtle marker ("▸ from arc" vs "iconic"). */
  source: "beat" | "iconic" | "fallback";
  /** Pulled through from beat.suggestedVerbs[].advancesArc when
   *  the source is "beat". Falsy otherwise. */
  advancesArc?: boolean | string;
}

const HUMAN_LABELS: Record<string, { label: string; description: string }> = {
  // Slime
  absorb: { label: "absorb", description: "fold something into your essence" },
  ooze: { label: "ooze forward", description: "let your edge thin and pour" },
  split: { label: "split", description: "two boundaries around one essence" },
  sense_tremor: { label: "sense", description: "widen your boundary; let the room write itself" },
  dissolve: { label: "dissolve", description: "your acids find weakness" },
  smother: { label: "smother", description: "spread across what breathes" },
  mimic_shape: { label: "mimic the floor", description: "become a part of the stone" },
  // Dungeon-core
  spawn_minion: { label: "spawn a minion", description: "weave moss-and-stone into a body" },
  shape_room: { label: "shape a new room", description: "push the chamber outward" },
  lure: { label: "lure", description: "set a small enticement at the corridor's mouth" },
  sense_intruder: { label: "sense for intruders", description: "let the dungeon's stone report back" },
  weave_illusion: { label: "weave an illusion", description: "show what isn't there" },
  drain_mana: { label: "drain mana", description: "pull warmth from an intruder" },
  bleed_integrity: { label: "spend integrity", description: "trade a sliver of yourself" },
  deepen_chamber: { label: "deepen the chamber", description: "more dungeon than there was a moment ago" },
  siphon_intruder: { label: "siphon", description: "take a measured warmth from them" },
  false_room: { label: "conjure a false room", description: "an illusion they walk through" },
  bind_minion: { label: "bind a minion", description: "tether will to a creature in the dark" },
  wyrm_signal: { label: "signal the Wyrm", description: "send a low pulse through the stone" },
  // Cursed-book
  fall_open: { label: "fall open to a page", description: "let the wind decide" },
  snap_shut: { label: "snap shut", description: "close on what they were not ready for" },
  flutter_pages: { label: "flutter your pages", description: "as if a wind that isn't" },
  absorb_word: { label: "absorb a word", description: "take a word that wasn't yours" },
  bleed_ink: { label: "bleed ink", description: "weep onto the lectern" },
  rewrite_self: { label: "rewrite yourself", description: "edit a line in real time" },
  decode_passage: { label: "decode a passage", description: "a cipher unlatches" },
  bind_reader: { label: "bind the reader", description: "press a thought into their mind" },
  spark_marginalia: { label: "spark marginalia", description: "a note brightens for a second" },
  wyrm_inscription: { label: "wyrm inscription", description: "an older hand writes through you" },
  wait_for_a_reader: { label: "wait for a reader", description: "let one slow at your lectern" },
  // Dragon-egg
  rock: { label: "rock", description: "shift inside your shell" },
  hum_low: { label: "hum low", description: "a note builds in the shell" },
  kindle_glow: { label: "kindle a glow", description: "warm yourself from within" },
  listen: { label: "listen", description: "the world arrives as pressures" },
  absorb_warmth: { label: "absorb warmth", description: "the dam's wing-warmth crosses the membrane" },
  dream_outward: { label: "dream outward", description: "past the shell, past the cliff" },
  hatch_partial: { label: "hatch partially", description: "a crack walks across your shell" },
  warmth_pulse: { label: "pulse warmth", description: "out and back" },
  shell_song: { label: "ring the shell", description: "a note older than the dam" },
  memory_dream: { label: "dream a memory", description: "one that isn't yours" },
  wyrm_kin_call: { label: "call the Wyrm-kin", description: "young dragons call this way" },
  // Generic
  move: { label: "move", description: "shift position" },
  sense: { label: "sense", description: "let the world arrive" },
  act: { label: "act", description: "commit, and the act commits with you" },
  attack: { label: "attack", description: "strike at what's in front of you" },
  defend: { label: "defend", description: "set yourself against what's coming" },
  examine: { label: "examine", description: "give the thing your full attention" },
  speak: { label: "speak", description: "communicate, in whatever way your shape does" },
  emit: { label: "emit", description: "send something outward" },
  alter: { label: "alter", description: "change a thing" },
  contain: { label: "contain", description: "hold what was loose" },
  // Universal
  wait: { label: "wait", description: "let the moment pass" },
  // Ascended forms (light coverage; full descriptions live in JSON
  // labels when authored)
  refuse: { label: "refuse", description: "say no without ceremony" },
  watch: { label: "watch", description: "the road empties under your gaze" },
  leave: { label: "leave", description: "stand, walk out" },
  return: { label: "return", description: "back to the place you swore not to" },
  endure: { label: "endure", description: "hold the cost" },
  abide: { label: "abide", description: "hold your place" },
  regard: { label: "regard", description: "look upon them without standing" },
  permit: { label: "permit", description: "allow what was being asked" },
  withhold: { label: "withhold", description: "the name stays in you" },
  remember: { label: "remember", description: "bring a memory forward" },
  cure: { label: "cure", description: "set the salt on the rack" },
  stir: { label: "stir", description: "turn the brine" },
  taste: { label: "taste", description: "small spoon, careful palate" },
  stock: { label: "take stock", description: "count what's in the cool room" },
  descend: { label: "descend", description: "the shaft you know best" },
  feel: { label: "feel", description: "let your awareness widen against the rock" },
  rest: { label: "rest", description: "set yourself down" },
  surface: { label: "surface", description: "climb back toward daylight" },
  distill: { label: "distill", description: "the still does its work" },
  lead: { label: "lead", description: "lift the choir into the verse" },
  blend: { label: "blend", description: "two tinctures into one" },
  chant: { label: "chant", description: "take the line; the choir takes it after" },
  carry: { label: "carry the verse", description: "hold the line through the long passage" },
  bank: { label: "bank the fire", description: "green ash, slow oak, lid" },
  stoke: { label: "stoke", description: "the flame finds the new wood" },
  tend: { label: "tend", description: "walk the rows slowly" },
  prune: { label: "prune", description: "take the cuts the plants want taken" },
  sow: { label: "sow", description: "a finger's width into the soil" },
  forge: { label: "forge", description: "blank up to working heat" },
  temper: { label: "temper", description: "take it to the colour your master taught" },
  name: { label: "name", description: "settle a name into the iron" },
  mark: { label: "mark", description: "lay a mark for the rust to follow" },
  weather: { label: "weather", description: "leave the piece to time" },
  join: { label: "join", description: "forge two pieces into one" },
};

/**
 * Resolve a verb id into a button label + description. Prefers
 * the static HUMAN_LABELS table (hand-curated copy); falls back
 * to a generic label if the verb is unknown.
 */
function describeVerb(verb: string): { label: string; description: string } {
  const found = HUMAN_LABELS[verb];
  if (found) return found;
  // Convert snake_case to space-separated; capitalise nothing
  // (the rest of the UI is lowercase).
  const label = verb.replace(/_/g, " ");
  return { label, description: "" };
}

/**
 * Pick the active beat (if any) — same evaluator as matchBeats but
 * returns at most one (the first triggered, in declaration order).
 * The orchestrator already advances past fired beats; this is the
 * "what beat is the player IN right now" lookup.
 */
function pickActiveBeat(
  pack: BeatPack | null,
  projection: Projection,
  firedBeatIds: Set<string>,
): Beat | null {
  if (!pack) return null;
  for (const beat of pack.beats) {
    // For suggestion purposes we WANT to include once-per-session
    // beats that have already fired — they're the beat the player
    // is currently in, and the suggested verbs are still relevant
    // until the beat's trigger no longer matches.
    if (evaluateTrigger(beat.trigger, projection)) {
      // Prefer not-yet-fired beats; if the only matching beat is
      // already fired, return null and let the form's iconic
      // verbs take over.
      if (!beat.oncePerSession || !firedBeatIds.has(beat.id)) {
        return beat;
      }
    }
  }
  return null;
}

/**
 * Resolves a beat's `suggestedVerbs` field into a flat list for the
 * current form. Two shapes supported:
 *
 *   - Flat `SuggestedVerb[]` → used as-is (form-specific arc).
 *   - Per-form record (`{ formId: [...], default?: [...] }`) →
 *     looks up `formId`, then `default`, then null.
 *
 * Returns null when nothing is available for this form (caller
 * falls through to the form's iconicVerbs).
 */
function pickFormSuggestions(
  field: SuggestedVerbsField,
  formId: string,
): SuggestedVerb[] | null {
  if (Array.isArray(field)) return field.length > 0 ? field : null;
  const byForm = field[formId];
  if (byForm && byForm.length > 0) return byForm;
  const fallback = field.default;
  if (fallback && fallback.length > 0) return fallback;
  return null;
}

interface SuggestArgs {
  form: FormTemplate;
  projection: Projection;
  /** The arc's beat pack, when one is loaded for this campaign.
   *  Pass null when there's no active arc. */
  beatPack?: BeatPack | null;
  /** Beat ids that have already fired this session — used to skip
   *  oncePerSession beats. */
  firedBeatIds?: Set<string>;
  /** Maximum number of suggestions to return. Default 3 (matches
   *  the play-page UI). */
  limit?: number;
}

export function suggestVerbs(args: SuggestArgs): VerbSuggestion[] {
  const limit = args.limit ?? 3;
  const beat = pickActiveBeat(
    args.beatPack ?? null,
    args.projection,
    args.firedBeatIds ?? new Set(),
  );

  // Source 1 — beat's suggestedVerbs (flat array OR per-form record).
  if (beat?.suggestedVerbs) {
    const list = pickFormSuggestions(beat.suggestedVerbs, args.form.id);
    if (list) {
      return list.slice(0, limit).map((s) => ({
        verb: s.verb,
        label: s.label,
        description: s.description,
        source: "beat" as const,
        advancesArc: s.advancesArc,
      }));
    }
  }

  // Source 2a — form's iconicVerbsByCondition (state-aware).
  // Evaluated in declaration order; first matching condition wins.
  // Empty verbs[] is treated as "no match" so authors can use it
  // as a placeholder.
  if (args.form.iconicVerbsByCondition) {
    for (const cond of args.form.iconicVerbsByCondition) {
      if (cond.verbs.length === 0) continue;
      if (evaluateTrigger(cond.when, args.projection)) {
        return cond.verbs.slice(0, limit).map((verb) => {
          const desc = describeVerb(verb);
          return {
            verb,
            label: desc.label,
            description: desc.description,
            source: "iconic" as const,
          };
        });
      }
    }
  }

  // Source 2b — form's static iconicVerbs.
  if (args.form.iconicVerbs && args.form.iconicVerbs.length > 0) {
    return args.form.iconicVerbs.slice(0, limit).map((verb) => {
      const desc = describeVerb(verb);
      return {
        verb,
        label: desc.label,
        description: desc.description,
        source: "iconic" as const,
      };
    });
  }

  // Source 3 — first N verbs from form.verbs[].
  return (args.form.verbs ?? []).slice(0, limit).map((verb) => {
    const desc = describeVerb(verb);
    return {
      verb,
      label: desc.label,
      description: desc.description,
      source: "fallback" as const,
    };
  });
}

/**
 * Phase 11+ T(B) — branch resolution.
 *
 * When a player picks a preset verb whose `suggestedVerb.advancesArc`
 * matches the literal `branch:<id>` shape, this helper emits a
 * `form_state.changed` event setting `branch_<id>` += 1. Beats can
 * then trigger on `form.state.branch_<id>: ">=1"` to fork the arc
 * onto an authored alternate path.
 *
 * Returns an empty array (not null) when:
 *   - no presetVerb supplied (free-text input, LLM narrator path),
 *   - no active beat for the projection,
 *   - the chosen verb isn't in the active beat's suggestedVerbs,
 *   - the chosen verb's `advancesArc` is missing / `true` / `false`
 *     (those don't create branches; `true` just means "this verb
 *     advances the arc to the next beat" which is the default).
 *
 * Multiple `branch:<id>` markers can accumulate across an arc —
 * the field convention `branch_<id>` is per-branch, so a player
 * who picks both `branch:withdrawn` (beat 02) and `branch:claim`
 * (beat 05) ends with both `form.state.branch_withdrawn=1` and
 * `form.state.branch_claim=1`.
 */
export function extractBranchEvents(args: {
  beatPack: BeatPack | null | undefined;
  projection: Projection;
  formId: string;
  firedBeatIds: Set<string>;
  presetVerb: string | null | undefined;
}): Event[] {
  if (!args.presetVerb || !args.beatPack) return [];
  const beat = pickActiveBeat(args.beatPack, args.projection, args.firedBeatIds);
  if (!beat?.suggestedVerbs) return [];
  const list = pickFormSuggestions(beat.suggestedVerbs, args.formId);
  if (!list) return [];
  const chosen = list.find((s) => s.verb === args.presetVerb);
  if (!chosen) return [];
  const adv = chosen.advancesArc;
  if (typeof adv !== "string" || !adv.startsWith("branch:")) return [];
  const branchId = adv.slice("branch:".length).trim();
  if (!branchId) return [];
  return [
    {
      kind: "form_state.changed",
      field: `branch_${branchId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      delta: 1,
    },
  ];
}
