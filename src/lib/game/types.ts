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
    }
  | { kind: "healed"; target: Target; amount: number }
  | { kind: "form_state.changed"; field: string; delta: number }
  | { kind: "inventory.added"; itemId: string; qty: number }
  | { kind: "inventory.removed"; itemId: string; qty: number }
  | { kind: "moved"; fromRoom: string; toRoom: string }
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
  | { kind: "session.ended"; reason: "death" | "win" | "cap" };

export type EventKind = Event["kind"];

export type ToolCall =
  | { name: "apply_damage"; target: Target; amount: number; source: string }
  | { name: "heal"; target: Target; amount: number }
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
    stats: Record<string, number>;
    state: Record<string, number>;
  };
  location: {
    id: string;
    roomId: string;
    discovered: string[];
  };
  inventory: Array<{ itemId: string; qty: number }>;
  npcs: Record<
    string,
    { name: string; relationship: number } & Record<string, unknown>
  >;
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

export interface NarrateInput {
  projection: Projection;
  lastEvents: Event[];
  roll: RollResult;
  intent: string;
  relevantMemories: Memory[];
}

export interface NarrateOutput {
  text: string;
  toolCalls: ToolCall[];
}

export interface Narrator {
  narrate(input: NarrateInput): Promise<NarrateOutput>;
}
