/**
 * Domain types for the game loop.
 *
 * These are the in-memory shapes the orchestrator and reducer work with —
 * distinct from the DB row shapes in `../db/schema.ts`. An `Event` is a
 * discriminated union; the DB stores `{ kind, payload, seed }` and we
 * marshal both directions in `events.ts`.
 *
 * The Event union here is the authoritative spec for day-3 onward;
 * `docs/PLAN.md` describes the same shape in narrative form. New event
 * kinds added here MUST also get a reducer arm in `projection.ts`.
 */

export type RollBand = "miss" | "partial" | "success";

export interface RollResult {
  d1: number;
  d2: number;
  mod: number;
  total: number;
  band: RollBand;
  seed: number;
  /** Phase 9 form-specific dice variants. "2d6" for legacy/default;
   *  forms can opt into 3d6kh2 / 2d6r1 / 1d12 via their JSON
   *  template. d1/d2 still carry "two dice the UI should show"
   *  regardless of variant; the variant id lets the UI label them
   *  and the narrator flavor the roll text. Optional for backward
   *  compat with replay events written before this field. */
  variant?: "2d6" | "3d6kh2" | "2d6r1" | "1d12";
  /** Cosmetic breakdown of where `mod` came from — stat bonus, race
   *  hook, adaptive difficulty bonus, bad-luck penalty. The UI uses
   *  this to label the modifier in the dice display so players can
   *  see why their roll got +N. The math is already baked into
   *  `mod`; this field is purely for display. Optional for replay
   *  back-compat — pre-existing events lack it and the UI falls
   *  back to a single anonymous +N. */
  modSources?: Array<{ source: string; delta: number }>;
}

export type SessionStatus = "active" | "dead" | "won" | "capped";

export type EntityKind = "npc" | "location" | "item" | "faction";

/**
 * A `target` of "$SELF" addresses the player; any other string is an entity
 * slug (e.g. "tunnel-rat-1"). Damage to non-$SELF entities is recorded
 * but does not alter the player projection — NPC HP is tracked in the
 * `entities.data` JSONB blob.
 */
export type Target = "$SELF" | (string & {});

export type Event =
  | { kind: "session.started"; formId: string; seed: number }
  | {
      kind: "turn.begun";
      turn: number;
      input: string;
      inputSanitized: string;
    }
  | { kind: "intent.classified"; verb: string; confidence: number }
  | { kind: "roll.resolved"; roll: RollResult; against: string }
  | {
      kind: "damage.applied";
      target: Target;
      amount: number;
      source: string;
      /** Which vital is hit. Defaults to the form's primary death vital
       * (the first vital with a non-null death threshold). */
      vital?: string;
    }
  | {
      kind: "healed";
      target: Target;
      amount: number;
      /** Which vital is restored. Defaults to the form's primary death
       * vital (matches damage.applied). */
      vital?: string;
    }
  | { kind: "form_state.changed"; field: string; delta: number }
  | { kind: "inventory.added"; itemId: string; qty: number }
  | { kind: "inventory.removed"; itemId: string; qty: number }
  | {
      /** Phase 5.5 Day 31. Player renamed an item in their
       *  inventory. The custom name persists on that inventory
       *  slot until the item is dropped/absorbed. */
      kind: "inventory.renamed";
      itemId: string;
      customName: string;
    }
  | { kind: "moved"; fromRoom: string; toRoom: string }
  | {
      /** Phase 9 inter-city travel. Mutates projection.location to
       *  a new locationId + entry room. Companion time.passed
       *  event covers the energy cost (3 ticks). The session's
       *  beat pack does NOT auto-reload — free-form play in the
       *  new region until the player departs again. */
      kind: "region.changed";
      fromLocation: string;
      toLocation: string;
      toRoom: string;
    }
  | { kind: "time.passed"; ticks: number }
  | { kind: "sensed"; modality: string; detail: string }
  | { kind: "absorbed"; itemId: string; into: string }
  | { kind: "location.discovered"; locationId: string }
  | {
      kind: "npc.introduced";
      npcId: string;
      data: { name: string; relationship?: number } & Record<string, unknown>;
    }
  | {
      kind: "relationship.updated";
      npcId: string;
      delta: number;
      reason: string;
    }
  | {
      kind: "quest.objectiveUpdated";
      questId: string;
      objective: string;
      status: "open" | "done" | "failed";
    }
  | { kind: "xp.granted"; amount: number; reason: string }
  | { kind: "memory.created"; memoryId: string; summary: string }
  | { kind: "narration.emitted"; text: string; toolCallsApplied: number }
  | { kind: "tool_validation_failed"; tool: string; error: string }
  | { kind: "wonder.fired"; wonderId: string; flavor: string }
  | {
      /** Phase 5 Day 18-19. Coin balance increased — by trade, gather
       * sale, gift, etc. The `source` is a free-text tag for telemetry
       * (e.g. "vendor:halrik", "gather", "gift:from:user-x"). */
      kind: "coins.gained";
      amount: number;
      source: string;
    }
  | {
      /** Phase 5 Day 18-19. Coin balance decreased. `sink` is the dual
       * of `source` for inflow events. */
      kind: "coins.spent";
      amount: number;
      sink: string;
    }
  | {
      /** Phase 5 Day 18-19. Atomic buy/sell roundtrip with an NPC. The
       * NPC is identified by its in-projection slug; `coinsDelta` is the
       * net change in the player's coin balance (negative for buy,
       * positive for sell). The companion `coins.gained`/`coins.spent`
       * is also emitted in the same batch — this event exists for
       * audit/UI ("Halrik sold you 1 iron ingot for 12 coins"). */
      kind: "trade.completed";
      npcId: string;
      action: "buy" | "sell";
      itemId: string;
      qty: number;
      coinsDelta: number;
    }
  | {
      /** Phase 5 Day 21. Player gathered N of `resourceId` at the
       * current location. Companion `inventory.added` is also
       * emitted in the same batch. Skill XP (Day 23-24) hooks off
       * this event kind. */
      kind: "craft.gathered";
      resourceId: string;
      qty: number;
      locationId: string;
    }
  | {
      /** Phase 5 Day 22. Player crafted `recipeId` — consumed inputs,
       * produced output. Companion inventory.removed (per input) +
       * inventory.added (output) are emitted in the same batch. The
       * skill XP award flows through xp.granted with reason
       * `skill:<skill>`. */
      kind: "craft.completed";
      recipeId: string;
      skill: string;
      outputItemId: string;
      outputQty: number;
    }
  | {
      /** Phase 7 Day 42-43. Player pledged to a faction. One-shot;
       *  the user's row carries faction_id + faction_pledged_at
       *  (this event is audit + side-effect-trigger only).
       *  Companion coins.spent carries the 50-coin pledge fee. */
      kind: "faction.pledged";
      factionId: string;
    }
  | {
      /** Post-Phase-8 NPC dialogue. Player utterance addressed to
       *  an NPC. The narrator weaves the NPC's reply into prose;
       *  the orchestrator persists a dialogue_turns row so the
       *  next exchange has the recent context. No energy cost. */
      kind: "dialogue.exchanged";
      npcId: string;
      utterance: string;
    }
  | {
      /** Phase 9 marketplace audit. Companion inventory.removed
       *  carries the projection mutation; the orchestrator
       *  side-effect after events land inserts the
       *  marketplace_listings row. listingId is filled in by
       *  the post-event side-effect (not the validator) so
       *  replay-from-zero is deterministic given the event log. */
      kind: "marketplace.listed";
      itemId: string;
      qty: number;
      pricePerUnit: number;
      note: string | null;
    }
  | {
      /** Phase 5 Day 23-24. Player paid a trainer NPC and learned a
       *  new skill. Idempotent — second learn calls are no-ops on
       *  the user_skills row. Companion `coins.spent` carries the
       *  fee. */
      kind: "skill.learned";
      skillId: string;
      fromNpcId: string;
      fee: number;
    }
  | {
      /** Phase 5 Day 23-24. XP added to a known skill. The skill
       *  module recomputes level on this; emit
       *  `skill.leveled_up` separately when the level changes. */
      kind: "skill.xp_gained";
      skillId: string;
      amount: number;
    }
  | {
      /** Phase 5 Day 23-24. Crossed a level threshold. Triggered by
       *  awardXp side-effect in turn.ts after appendEvents. */
      kind: "skill.leveled_up";
      skillId: string;
      newLevel: number;
    }
  | { kind: "session.ended"; reason: "death" | "win" | "cap" };

export type EventKind = Event["kind"];

export type ToolCall =
  | {
      name: "apply_damage";
      target: Target;
      amount: number;
      source: string;
      vital?: string;
    }
  | { name: "heal"; target: Target; amount: number; vital?: string }
  | { name: "change_form_state"; field: string; delta: number }
  | { name: "add_inventory"; itemId: string; qty: number }
  | { name: "remove_inventory"; itemId: string; qty: number }
  | { name: "absorb"; itemId: string; into: string }
  | { name: "move_to"; roomId: string }
  | { name: "pass_time"; ticks: number }
  | {
      name: "sense";
      modality: "vibration" | "chemical" | "thermal" | "light";
      detail: string;
    }
  | { name: "discover_location"; locationId: string }
  | { name: "introduce_npc"; templateId: string; attitude: number }
  | {
      name: "update_relationship";
      npcId: string;
      delta: number;
      reason: string;
    }
  | {
      name: "update_quest_objective";
      questId: string;
      objective: string;
      status: "open" | "done" | "failed";
    }
  | { name: "grant_xp"; amount: number; reason: string }
  | { name: "create_memory"; summary: string; salience?: number }
  | {
      /** Phase 5 Day 18-19. Buy or sell with an NPC vendor. Validated
       * against the NPC's catalog (content/npcs/<id>.json under
       * metadata.catalog) and the player's coin balance + inventory. */
      name: "trade_with_npc";
      npcId: string;
      action: "buy" | "sell";
      itemId: string;
      qty: number;
    }
  | {
      /** Phase 5 Day 21. Gather a resource available at the player's
       *  current location. Quantity is server-rolled 1-3 from a
       *  per-turn seed so replay-from-zero is deterministic. The
       *  narrator passes only resourceId; consumes 1 craft credit. */
      name: "gather_resource";
      resourceId: string;
    }
  | {
      /** Phase 5 Day 22. Craft a recipe by id (smelt, smith, mill,
       *  alchemy, cook, etc.). The recipe carries skill +
       *  requiredLevel + inputs + output. Validator checks player
       *  has inputs, the right skill, and (if set) the right
       *  location. Consumes 1 craft credit. */
      name: "craft_recipe";
      recipeId: string;
    }
  | {
      /** Phase 5 Day 23-24. Pay an NPC trainer to learn a skill.
       *  The validator confirms the NPC is in scene, has
       *  metadata.teachesSkill set, and the player has the fee +
       *  doesn't already know the skill. Skill is cross-run. */
      name: "learn_skill_from";
      npcId: string;
    }
  | {
      /** Phase 5.5 Day 31. Rename an item in the player's
       *  inventory. The narrator subsequently uses the custom
       *  name. 1-32 chars, moderation-checked. No energy cost. */
      name: "rename_inventory";
      itemId: string;
      customName: string;
    }
  | {
      /** Phase 7 Day 42-43. Pledge to a faction. One-shot per user;
       *  costs 50 coins. Subsequent crafts in faction-aligned
       *  skills get +10% XP. */
      name: "pledge_faction";
      factionId: "choristers" | "rust_hand" | "idle" | "forsaken";
    }
  | {
      /** Post-Phase-8 dialogue tool. The narrator emits this when
       *  the player addresses words to a specific NPC. The
       *  orchestrator persists the exchange so the next reply
       *  reads recent context (last 8 turns) without re-deriving
       *  from the event log. */
      name: "speak_to";
      npcId: string;
      utterance: string;
    }
  | {
      /** Phase 9 marketplace tool. Escrow an item from the player's
       *  inventory and post it as a marketplace listing. Companion
       *  inventory.removed carries the projection mutation; the
       *  marketplace_listings row is inserted by the orchestrator
       *  side-effect after events land. 7-day TTL; cancel returns
       *  the item via inventory.added. */
      name: "list_item";
      itemId: string;
      qty: number;
      pricePerUnit: number;
      note?: string;
    }
  | {
      /** Phase 9 inter-city travel. Move the active session to a
       *  different location. Costs 3 turns of energy (server-
       *  enforced via companion time.passed). The narrator can
       *  optionally summon road-encounter prose; the orchestrator
       *  does not currently script road beats. */
      name: "travel_to";
      locationId: string;
    }
  | { name: "narrate_only" };

/**
 * Form template — read from `templates_forms.data` JSONB. Only the fields
 * the reducer/initial-state code reads are typed here; the full content/json
 * shape is richer (negativeVocab, sampleCorpus, hardMoves, ...).
 */
export interface FormTemplate {
  id: string;
  vitals: Record<string, { max: number; start: number; death?: number | null }>;
  stats: Record<string, number>;
  verbs: string[];
  verbMappings?: Record<
    string,
    {
      rollStat: string | null;
      tools?: string[];
    }
  >;
  hardMoves?: unknown;
  /** Phase 9 form-specific dice variant. When unset, the form
   *  rolls the default 2d6. See src/lib/game/rules.ts for the
   *  catalog and rationale per form. */
  dice?: "2d6" | "3d6kh2" | "2d6r1" | "1d12";
  /** Phase 10 form-specific narrator phrase bank. Optional per-verb
   *  prose for each roll band. The TemplateNarrator picks a phrase
   *  deterministically by `seed % bank.length`. When a verb isn't
   *  in the bank, or the bank is missing entirely, the narrator
   *  falls back to a generic line that echoes the verb. The slime
   *  ships the original 8-verb bank in its JSON; new forms add
   *  their own. See src/lib/narrator/template.ts. */
  phraseBank?: Record<
    string,
    {
      success?: string[];
      partial?: string[];
      miss?: string[];
    }
  >;
  /** Phase 10 form-specific opening scene. Rendered on the play
   *  page when the transcript is empty (turn 0). 1-3 sentences in
   *  the form's voice. Falls back to a generic "you wake as <form>
   *  in <location>" hint when unset. */
  opening?: string;
}

export interface LocationRoom {
  id: string;
  exits: Array<{ verb: string; toRoomId: string; modifier?: number }>;
}

export interface LocationTemplate {
  id: string;
  entryRoomId: string;
  rooms: LocationRoom[];
}

/**
 * Per-session world snapshot. Replay-from-zero must reproduce this from the
 * event log; snapshots in the `projections` table are a cache.
 *
 * `vitalsMax` extends PLAN's draft Projection by carrying the form template's
 * cohesion/essence ceilings into state, so the reducer can clamp `healed`
 * without a template lookup. Set once at `session.started` (via
 * `initialProjection`) and never mutated thereafter.
 */
export interface Projection {
  sessionId: string;
  upToSeq: number;
  form: {
    id: string;
    vitals: Record<string, number>;
    vitalsMax: Record<string, number>;
    /** Per-vital death threshold; null means the vital is non-lethal
     * (e.g. slime's `essence` is mana-equivalent — empty doesn't kill). */
    vitalsDeath: Record<string, number | null>;
    stats: Record<string, number>;
    state: Record<string, number>;
  };
  /** Free-text identity from the player ("a cursed armor that
   *  remembers its owner"). Set when the campaign was created with a
   *  custom reincarnation; null for typed forms where the form
   *  template fully describes the identity. */
  reincarnatedAs?: string | null;
  location: {
    id: string;
    roomId: string;
    discovered: string[];
  };
  inventory: Array<{ itemId: string; qty: number; customName?: string }>;
  npcs: Record<string, { name: string; relationship: number } & Record<string, unknown>>;
  quest: {
    id: string | null;
    objectives: Record<string, "open" | "done" | "failed">;
  };
  xp: number;
  turn: number;
  status: SessionStatus;
}

export interface Memory {
  id: string;
  summary: string;
  salience: number;
  eventSeqRange: [number, number];
}

export interface PreviousAttempt {
  /** The narrator's prior text. */
  text: string;
  /** The tool calls the prior attempt emitted. */
  toolCalls: ToolCall[];
  /** Short reason: validation error or tone violation. */
  failureReason: string;
  /** What kind of failure this is — affects how the narrator should adjust.
   *  - "tool_validation": the toolCalls were invalid; the narrator should
   *    pick different tools.
   *  - "tone_drift": the prose used negativeVocab or read off-form; the
   *    narrator should rewrite the prose, tools may be re-emitted but
   *    will be ignored by the orchestrator. */
  failureKind: "tool_validation" | "tone_drift";
}

export interface NarrateInput {
  projection: Projection;
  lastEvents: Event[];
  /** The current turn's sanitized player action. Kept explicit so
   * remote narrators never confuse the classifier verb for what the
   * player actually typed. */
  playerInputSanitized: string;
  roll: RollResult;
  intent: string;
  relevantMemories: Memory[];
  /** Set on the second pass (one-shot retry per ADR-011 / day-9 tone). */
  previousAttempt?: PreviousAttempt;
}

/**
 * Map a free-text reincarnation declaration to the formId we'll use
 * for mechanics. Keyword-based — generous so common phrasings hit
 * typed forms with their full anti-drift scaffolding, and anything
 * we haven't authored falls back to generic-creature.
 *
 * Add a case here when you ship a new typed form.
 */
export function pickFormId(reincarnatedAs: string | null | undefined): string {
  if (!reincarnatedAs) return "lesser-slime";
  const s = reincarnatedAs.toLowerCase();

  // Order matters: more specific patterns FIRST. "dragon egg" must
  // route to dragon-egg, not get caught by a hypothetical "dragon"
  // pattern that lands on a generic dragon form.
  if (/\bdragon\b.*\begg\b|\begg\b.*\bdragon\b|\bwyrmling\s+egg\b/.test(s)) return "dragon-egg";
  if (/\bdungeon\s+core\b|\bdungeon-core\b|\bdungeon\s+heart\b|\bdungeon\s+crystal\b/.test(s))
    return "dungeon-core";
  if (/\b(?:cursed\s+)?book\b|\btome\b|\bgrimoire\b|\bcodex\b|\bjournal\b/.test(s))
    return "cursed-book";
  if (/\bslime\b|\booze\b|\bjelly\b|\bgel\b/.test(s)) return "lesser-slime";

  return "generic-creature";
}

/** Available locations a campaign can pick. Used by random-start.
 *  Phase-9 world expansion added the racial homelands + metropolis +
 *  10 small towns. The original six remain (the typed-form arcs
 *  use them); the new entries broaden the random-start surface. */
export const AVAILABLE_LOCATIONS = [
  // Original Phase-1 locations — remain canonical for the four typed
  // forms' starter arcs.
  "collapsed-tunnel",
  "forsaken-village",
  "sunless-spire",
  "drowned-orchard",
  "salt-cathedral",
  "hollow-market",
  // Phase-9 world atlas — metropolis + five racial homelands.
  "caelum-by-the-wash",
  "threadwarden",
  "saltgale",
  "highfield-ascending",
  "the-coral-anchorage",
  "the-long-indices",
  // Phase-9 small towns (one per spoke pair).
  "three-notches",
  "coldspoon",
  "mudmoth",
  "tallowfen",
  "cataract-mile",
  "quietmile",
  "furrowmouth",
  "knots-landing",
  "briny-bell",
  "crab-by-crab",
] as const;

export type LocationId = (typeof AVAILABLE_LOCATIONS)[number];

export interface NarrateOutput {
  text: string;
  toolCalls: ToolCall[];
}

export interface Narrator {
  narrate(input: NarrateInput): Promise<NarrateOutput>;
  /** Optional streaming variant. When implemented, `onText(delta)`
   *  fires as the narration text streams in from the provider; the
   *  promise resolves with the full NarrateOutput once the stream
   *  finishes. Tool calls are delivered in the resolution, not
   *  streamed. Callers fall back to `narrate()` when this is absent. */
  narrateStream?(input: NarrateInput, onText: (delta: string) => void): Promise<NarrateOutput>;
}
