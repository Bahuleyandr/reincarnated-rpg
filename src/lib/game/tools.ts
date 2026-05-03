/**
 * Tool registry — Zod validators per ToolCall + atomicity wrapper.
 *
 * The orchestrator (day 6's turn.ts) hands off the model's emitted tool
 * calls to `applyTools`. Behavior:
 *
 *   1. Validate every tool's payload via its Zod schema.
 *   2. For tools whose validity depends on projection state
 *      (e.g. `remove_inventory` of an item not held), run a precondition
 *      check.
 *   3. Convert each ToolCall to its Event counterpart.
 *   4. Append the whole batch in a single Postgres transaction (via
 *      `events.appendEvents`). Either all events land or none do — that's
 *      the all-or-nothing guarantee in ADR-011.
 *   5. On any validation/precondition failure: skip the batch, append
 *      a single `tool_validation_failed` event, return the error so the
 *      orchestrator can re-prompt (max 1 retry per ADR-011).
 *
 * The narrate_only tool is a no-op event-wise; it exists so the model
 * can signal "nothing mechanical this turn" without spuriously calling
 * a state-mutating tool to look compliant.
 */
import { z } from "zod";
import type { drizzle } from "drizzle-orm/postgres-js";

import { uuidv7 } from "../util/uuidv7";

import { appendEvents, type AppendedEvent } from "./events";
import type { Event, Projection, ToolCall } from "./types";

type Db = ReturnType<typeof drizzle>;

const targetSchema = z.string().min(1);
const slugSchema = z.string().regex(/^[a-z0-9-]+$/i, "lowercase-kebab slug");
const nonEmptyString = z.string().min(1);

/**
 * Anti-OP / anti-godlike caps. The per-call zod limits (±10 delta,
 * 0-10 damage, 0-5 heal, 1-5 inventory) prevent wild single-tool
 * outliers; these absolute caps prevent slow runaway accumulation
 * across many turns. The narrator can still describe powerful
 * scenes — these caps only bound the mechanical state.
 *
 * Tighten or relax in one place. Update the corresponding zod
 * schema and the precondition checks in checkPrecondition() if you
 * change a value here.
 */
export const SAFETY_CAPS = {
  /** Absolute value any field in projection.form.state may take. */
  formStateAbsMax: 20,
  /** Per-call apply_damage cap (mirrors zod). */
  damagePerCallMax: 10,
  /** Per-call heal cap (mirrors zod). */
  healPerCallMax: 5,
  /** Per-call add_inventory qty cap (mirrors zod). */
  invQtyPerCallMax: 5,
  /** Default backpack slots every player has. */
  inventoryBase: 10,
  /** Absolute hard cap on inventory slots. With ANY combination of
   *  spells, blessings, extra bags, signature buffs — total stays
   *  below this. The user's spec: 10 base, 30 max, capped with all
   *  bonuses. */
  inventoryHardMax: 30,
  /** Max number of tool calls a single model response may emit per
   *  turn. Anti-power-creep: a narrator that emits 30 tool calls is
   *  almost certainly hallucinating an action movie; cap forces it
   *  to consolidate into a coherent beat instead. The orchestrator
   *  trims overflow before validation, recording the truncation in
   *  the tool_validation_failed event log. */
  maxToolsPerTurn: 6,
  /** Per-call grant_xp cap. Tightened from the zod max (999) so a
   *  single turn can't level the player into orbit. Multiple
   *  grant_xp calls per turn still stack but each is small. */
  grantXpPerCallMax: 50,
} as const;

/**
 * Effective inventory capacity = base + bag_slots bonus from
 * form.state, clamped to [base, hardMax]. Capacity bonuses can come
 * from the catalog's starterBonus, signature verbs, world events,
 * etc. — they all funnel through projection.form.state.bag_slots.
 */
export function inventoryCapacity(projection: Projection): number {
  const bonus = (projection.form.state["bag_slots"] as number) ?? 0;
  return Math.max(
    SAFETY_CAPS.inventoryBase,
    Math.min(
      SAFETY_CAPS.inventoryHardMax,
      SAFETY_CAPS.inventoryBase + bonus,
    ),
  );
}

/** Sum of qty across every inventory stack. */
export function inventoryUsed(projection: Projection): number {
  return projection.inventory.reduce((sum, i) => sum + i.qty, 0);
}

const toolSchemas = {
  heal: z.object({
    name: z.literal("heal"),
    target: targetSchema,
    /** Safety cap: 0-5 per call. Multiple heal tools per turn is
     *  legal but each is bounded; the projection's vitalsMax also
     *  clamps the resulting vital — no infinite-HP runaway. */
    amount: z.number().int().min(0).max(5),
    vital: z.string().optional(),
  }),
  apply_damage: z.object({
    name: z.literal("apply_damage"),
    target: targetSchema,
    /** Safety cap: 0-10 per call. Larger numbers usually indicate
     *  model hallucination; smaller-by-design keeps PvP-shaped runs
     *  approachable. */
    amount: z.number().int().min(0).max(10),
    source: nonEmptyString,
    vital: z.string().optional(),
  }),
  change_form_state: z.object({
    name: z.literal("change_form_state"),
    field: nonEmptyString,
    /** Safety cap: ±10 per call. The post-apply clamp also caps the
     *  field's accumulated absolute value (see SAFETY_CAPS). */
    delta: z.number().int().min(-10).max(10),
  }),
  add_inventory: z.object({
    name: z.literal("add_inventory"),
    itemId: slugSchema,
    /** Cap at 5 per call to prevent runaway loot. */
    qty: z.number().int().min(1).max(5),
  }),
  remove_inventory: z.object({
    name: z.literal("remove_inventory"),
    itemId: slugSchema,
    qty: z.number().int().min(1).max(99),
  }),
  absorb: z.object({
    name: z.literal("absorb"),
    itemId: slugSchema,
    into: nonEmptyString,
  }),
  move_to: z.object({
    name: z.literal("move_to"),
    roomId: slugSchema,
  }),
  pass_time: z.object({
    name: z.literal("pass_time"),
    ticks: z.number().int().min(1).max(99),
  }),
  sense: z.object({
    name: z.literal("sense"),
    modality: z.enum(["vibration", "chemical", "thermal", "light"]),
    detail: nonEmptyString,
  }),
  discover_location: z.object({
    name: z.literal("discover_location"),
    locationId: slugSchema,
  }),
  introduce_npc: z.object({
    name: z.literal("introduce_npc"),
    templateId: slugSchema,
    attitude: z.number().int().min(-3).max(3),
  }),
  update_relationship: z.object({
    name: z.literal("update_relationship"),
    npcId: slugSchema,
    delta: z.number().int().min(-3).max(3),
    reason: nonEmptyString,
  }),
  update_quest_objective: z.object({
    name: z.literal("update_quest_objective"),
    questId: slugSchema,
    objective: nonEmptyString,
    status: z.enum(["open", "done", "failed"]),
  }),
  grant_xp: z.object({
    name: z.literal("grant_xp"),
    /** Power-creep cap: 0..50 per call. Multiple grant_xp tools per
     *  turn still stack but each individual call stays in a sane
     *  range. The narrator cannot dump "+999 XP" in one tool call. */
    amount: z.number().int().min(0).max(50),
    reason: nonEmptyString,
  }),
  create_memory: z.object({
    name: z.literal("create_memory"),
    summary: nonEmptyString,
    salience: z.number().min(0).max(1).optional(),
  }),
  narrate_only: z.object({
    name: z.literal("narrate_only"),
  }),
} as const;

export const toolCallSchema = z.discriminatedUnion("name", [
  toolSchemas.apply_damage,
  toolSchemas.heal,
  toolSchemas.change_form_state,
  toolSchemas.add_inventory,
  toolSchemas.remove_inventory,
  toolSchemas.absorb,
  toolSchemas.move_to,
  toolSchemas.pass_time,
  toolSchemas.sense,
  toolSchemas.discover_location,
  toolSchemas.introduce_npc,
  toolSchemas.update_relationship,
  toolSchemas.update_quest_objective,
  toolSchemas.grant_xp,
  toolSchemas.create_memory,
  toolSchemas.narrate_only,
]);

export type ToolValidationFailure = {
  tool: string;
  error: string;
};

export type ApplyToolsResult =
  | { ok: true; events: AppendedEvent[] }
  | { ok: false; failure: ToolValidationFailure };

/**
 * Validate every tool call (schema + state preconditions), then either:
 *   - convert to events and append in one tx (success path), OR
 *   - append a single `tool_validation_failed` event and return the
 *     failure so the orchestrator can re-prompt (failure path).
 *
 * The model receives at most one retry; orchestrator policy lives in
 * turn.ts. This function is one half of the retry loop.
 */
export async function applyTools(
  db: Db,
  sessionId: string,
  projection: Projection,
  tools: ToolCall[],
): Promise<ApplyToolsResult> {
  if (tools.length === 0) {
    return { ok: true, events: [] };
  }

  // Anti-power-creep: a single turn cannot emit more than
  // SAFETY_CAPS.maxToolsPerTurn tool calls. If the model bursts
  // beyond that, treat the whole batch as a validation failure so
  // the existing retry path prompts the narrator to consolidate.
  if (tools.length > SAFETY_CAPS.maxToolsPerTurn) {
    const failure: ToolValidationFailure = {
      tool: "(batch)",
      error: `too many tool calls in one turn: ${tools.length} > ${SAFETY_CAPS.maxToolsPerTurn}`,
    };
    await appendEvents(db, sessionId, [
      {
        kind: "tool_validation_failed",
        tool: failure.tool,
        error: failure.error,
      },
    ]);
    return { ok: false, failure };
  }

  for (const tool of tools) {
    const parsed = toolCallSchema.safeParse(tool);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      const failure: ToolValidationFailure = {
        tool: (tool as { name?: string }).name ?? "unknown",
        error: message,
      };
      await appendEvents(db, sessionId, [
        {
          kind: "tool_validation_failed",
          tool: failure.tool,
          error: failure.error,
        },
      ]);
      return { ok: false, failure };
    }
    const precondError = checkPrecondition(parsed.data, projection);
    if (precondError) {
      const failure: ToolValidationFailure = {
        tool: parsed.data.name,
        error: precondError,
      };
      await appendEvents(db, sessionId, [
        {
          kind: "tool_validation_failed",
          tool: failure.tool,
          error: failure.error,
        },
      ]);
      return { ok: false, failure };
    }
  }

  const events: Event[] = [];
  for (const tool of tools) {
    const evt = toolToEvent(tool, projection);
    if (evt) events.push(evt);
  }
  const inserted = await appendEvents(db, sessionId, events);
  return { ok: true, events: inserted };
}

/**
 * Per-tool precondition checks against the current projection.
 * Returns null on pass, error string on fail.
 *
 * Day-4 scope: the cheap, obvious checks. Beat triggers and form-card
 * verb whitelisting plug in later (day 5/6).
 */
export function checkPrecondition(
  tool: ToolCall,
  projection: Projection,
): string | null {
  switch (tool.name) {
    case "remove_inventory": {
      const held = projection.inventory.find((i) => i.itemId === tool.itemId);
      if (!held) return `inventory.removed: item not held: ${tool.itemId}`;
      if (held.qty < tool.qty) {
        return `inventory.removed: only ${held.qty} held, asked ${tool.qty}`;
      }
      return null;
    }
    case "absorb": {
      const held = projection.inventory.find((i) => i.itemId === tool.itemId);
      if (!held) return `absorb: item not held: ${tool.itemId}`;
      return null;
    }
    case "update_relationship": {
      if (!projection.npcs[tool.npcId]) {
        return `update_relationship: unknown npc: ${tool.npcId}`;
      }
      return null;
    }
    case "apply_damage":
    case "heal": {
      if (tool.target === "$SELF" && tool.vital) {
        const exists = tool.vital in projection.form.vitals;
        if (!exists) {
          return `${tool.name}: form has no vital '${tool.vital}'`;
        }
      }
      return null;
    }
    case "change_form_state": {
      // Safety cap: no form-state field may accumulate past ±20.
      // Prevents godlike runaway buffs (e.g. wyrm_attuned creeping
      // to 999 over a long run) and matches the tightened per-call
      // delta cap (±10) so two tool calls can still bring a fresh
      // field to 20 in one turn but not beyond.
      const current = projection.form.state[tool.field] ?? 0;
      const next = current + tool.delta;
      if (next > SAFETY_CAPS.formStateAbsMax) {
        return `change_form_state: '${tool.field}' would exceed safety cap (${SAFETY_CAPS.formStateAbsMax})`;
      }
      if (next < -SAFETY_CAPS.formStateAbsMax) {
        return `change_form_state: '${tool.field}' would fall below safety cap (-${SAFETY_CAPS.formStateAbsMax})`;
      }
      return null;
    }
    case "add_inventory": {
      // Backpack capacity guardrail. Players carry up to 10 slots
      // by default; spells / blessings / extra bags can raise the
      // capacity via projection.form.state.bag_slots, but the hard
      // cap is 30 regardless of how many bonuses stack.
      const capacity = inventoryCapacity(projection);
      const used = inventoryUsed(projection);
      const next = used + tool.qty;
      if (next > capacity) {
        return `add_inventory: backpack full (${used}/${capacity}). need to drop or absorb something first.`;
      }
      return null;
    }
    case "move_to":
    case "pass_time":
    case "sense":
    case "discover_location":
    case "introduce_npc":
    case "update_quest_objective":
    case "grant_xp":
    case "create_memory":
    case "narrate_only":
      return null;
  }
}

/**
 * Convert a validated ToolCall into the corresponding Event.
 * Returns null for `narrate_only` (logged separately as
 * `narration.emitted` by the orchestrator).
 */
export function toolToEvent(
  tool: ToolCall,
  projection: Projection,
): Event | null {
  switch (tool.name) {
    case "apply_damage":
      return {
        kind: "damage.applied",
        target: tool.target,
        amount: tool.amount,
        source: tool.source,
        ...(tool.vital ? { vital: tool.vital } : {}),
      };
    case "heal":
      return {
        kind: "healed",
        target: tool.target,
        amount: tool.amount,
        ...(tool.vital ? { vital: tool.vital } : {}),
      };
    case "change_form_state":
      return {
        kind: "form_state.changed",
        field: tool.field,
        delta: tool.delta,
      };
    case "add_inventory":
      return {
        kind: "inventory.added",
        itemId: tool.itemId,
        qty: tool.qty,
      };
    case "remove_inventory":
      return {
        kind: "inventory.removed",
        itemId: tool.itemId,
        qty: tool.qty,
      };
    case "absorb":
      return {
        kind: "absorbed",
        itemId: tool.itemId,
        into: tool.into,
      };
    case "move_to":
      return {
        kind: "moved",
        fromRoom: projection.location.roomId,
        toRoom: tool.roomId,
      };
    case "pass_time":
      return { kind: "time.passed", ticks: tool.ticks };
    case "sense":
      return {
        kind: "sensed",
        modality: tool.modality,
        detail: tool.detail,
      };
    case "discover_location":
      return {
        kind: "location.discovered",
        locationId: tool.locationId,
      };
    case "introduce_npc": {
      // npcId on the event is a fresh slug derived from templateId; the
      // orchestrator may resolve a known instance. For day 4 we assume
      // each introduce creates a new instance (rare collisions OK).
      const npcId = `${tool.templateId}-${uuidv7().slice(0, 8)}`;
      return {
        kind: "npc.introduced",
        npcId,
        data: {
          name: tool.templateId,
          relationship: tool.attitude,
          templateId: tool.templateId,
        },
      };
    }
    case "update_relationship":
      return {
        kind: "relationship.updated",
        npcId: tool.npcId,
        delta: tool.delta,
        reason: tool.reason,
      };
    case "update_quest_objective":
      return {
        kind: "quest.objectiveUpdated",
        questId: tool.questId,
        objective: tool.objective,
        status: tool.status,
      };
    case "grant_xp":
      return {
        kind: "xp.granted",
        amount: tool.amount,
        reason: tool.reason,
      };
    case "create_memory":
      return {
        kind: "memory.created",
        memoryId: uuidv7(),
        summary: tool.summary,
      };
    case "narrate_only":
      return null;
  }
}
