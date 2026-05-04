/**
 * Tool registry - Zod validators per ToolCall plus state/content guardrails.
 *
 * `validateToolsToEvents` is the core path used by the turn orchestrator:
 * it validates a whole narrator tool batch and returns in-memory events
 * without touching the database. The accepted turn is then appended in one
 * batch by `runTurn`.
 *
 * `applyTools` is kept as a legacy wrapper for tests and scripts that still
 * want "validate then append" behavior.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { Db } from "../db/client";
import { uuidv7 } from "../util/uuidv7";

import { appendEvents, type AppendedEvent } from "./events";
import { inventoryCapacity, inventoryUsed, SAFETY_CAPS } from "./safety";
import type {
  Event,
  FormTemplate,
  LocationTemplate,
  Projection,
  RollBand,
  ToolCall,
} from "./types";

export { inventoryCapacity, inventoryUsed, SAFETY_CAPS } from "./safety";

const targetSchema = z.string().min(1);
const slugSchema = z.string().regex(/^[a-z0-9-]+$/i, "lowercase-kebab slug");
const nonEmptyString = z.string().min(1);

const toolSchemas = {
  heal: z.object({
    name: z.literal("heal"),
    target: targetSchema,
    amount: z.number().int().min(0).max(SAFETY_CAPS.healPerCallMax),
    vital: z.string().optional(),
  }),
  apply_damage: z.object({
    name: z.literal("apply_damage"),
    target: targetSchema,
    amount: z.number().int().min(0).max(SAFETY_CAPS.damagePerCallMax),
    source: nonEmptyString,
    vital: z.string().optional(),
  }),
  change_form_state: z.object({
    name: z.literal("change_form_state"),
    field: nonEmptyString,
    delta: z.number().int().min(-10).max(10),
  }),
  add_inventory: z.object({
    name: z.literal("add_inventory"),
    itemId: slugSchema,
    qty: z.number().int().min(1).max(SAFETY_CAPS.invQtyPerCallMax),
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
    amount: z.number().int().min(0).max(SAFETY_CAPS.grantXpPerCallMax),
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

export type ValidateToolsResult =
  | { ok: true; events: Event[] }
  | { ok: false; failure: ToolValidationFailure };

export interface ToolValidationContext {
  form?: FormTemplate;
  location?: LocationTemplate;
  intent?: string;
  rollBand?: RollBand;
  /** The repo has no canonical item catalog yet; pass this once one exists. */
  knownItemIds?: ReadonlySet<string>;
}

export interface ValidateToolsArgs extends ToolValidationContext {
  projection: Projection;
  tools: ToolCall[];
}

export async function applyTools(
  db: Db,
  sessionId: string,
  projection: Projection,
  tools: ToolCall[],
  context: ToolValidationContext = {},
): Promise<ApplyToolsResult> {
  const validated = validateToolsToEvents({
    projection,
    tools,
    ...context,
  });
  if (!validated.ok) {
    await appendEvents(db, sessionId, [
      {
        kind: "tool_validation_failed",
        tool: validated.failure.tool,
        error: validated.failure.error,
      },
    ]);
    return validated;
  }

  const inserted = await appendEvents(db, sessionId, validated.events);
  return { ok: true, events: inserted };
}

export function validateToolsToEvents(args: ValidateToolsArgs): ValidateToolsResult {
  const { projection, tools } = args;
  if (tools.length === 0) return { ok: true, events: [] };

  if (tools.length > SAFETY_CAPS.maxToolsPerTurn) {
    return {
      ok: false,
      failure: {
        tool: "(batch)",
        error: `too many tool calls in one turn: ${tools.length} > ${SAFETY_CAPS.maxToolsPerTurn}`,
      },
    };
  }

  const parsedTools: ToolCall[] = [];
  for (const tool of tools) {
    const parsed = toolCallSchema.safeParse(tool);
    if (!parsed.success) {
      return {
        ok: false,
        failure: {
          tool: (tool as { name?: string }).name ?? "unknown",
          error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      };
    }

    const precondError = checkPrecondition(parsed.data, projection, args);
    if (precondError) {
      return {
        ok: false,
        failure: { tool: parsed.data.name, error: precondError },
      };
    }
    parsedTools.push(parsed.data);
  }

  const events: Event[] = [];
  for (const tool of parsedTools) {
    const evt = toolToEvent(tool, projection);
    if (evt) events.push(evt);
  }
  return { ok: true, events };
}

export function checkPrecondition(
  tool: ToolCall,
  projection: Projection,
  context: ToolValidationContext = {},
): string | null {
  const allowanceError = checkToolAllowance(tool, context);
  if (allowanceError) return allowanceError;

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
        if (!exists) return `${tool.name}: form has no vital '${tool.vital}'`;
      }
      if (tool.target !== "$SELF" && !projection.npcs[tool.target]) {
        return `${tool.name}: unknown target entity: ${tool.target}`;
      }
      return null;
    }
    case "change_form_state": {
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
      if (context.knownItemIds && !context.knownItemIds.has(tool.itemId)) {
        return `add_inventory: unknown item: ${tool.itemId}`;
      }
      const capacity = inventoryCapacity(projection);
      const used = inventoryUsed(projection);
      const next = used + tool.qty;
      if (next > capacity) {
        return `add_inventory: backpack full (${used}/${capacity}). need to drop or absorb something first.`;
      }
      return null;
    }
    case "move_to": {
      const location = context.location;
      if (!location) return null;
      const current = location.rooms.find((r) => r.id === projection.location.roomId);
      if (!current) {
        return `move_to: current room missing from location: ${projection.location.roomId}`;
      }
      const target = location.rooms.find((r) => r.id === tool.roomId);
      if (!target) return `move_to: unknown room: ${tool.roomId}`;
      const connected = current.exits.some((e) => e.toRoomId === tool.roomId);
      if (!connected) {
        return `move_to: room ${tool.roomId} is not connected to ${projection.location.roomId}`;
      }
      return null;
    }
    case "discover_location": {
      const location = context.location;
      if (location && !location.rooms.some((r) => r.id === tool.locationId)) {
        return `discover_location: unknown room/location: ${tool.locationId}`;
      }
      return null;
    }
    case "introduce_npc": {
      if (!npcTemplateExists(tool.templateId)) {
        return `introduce_npc: unknown npc template: ${tool.templateId}`;
      }
      return null;
    }
    case "pass_time":
    case "sense":
    case "update_quest_objective":
    case "grant_xp":
    case "create_memory":
    case "narrate_only":
      return null;
  }
}

function checkToolAllowance(tool: ToolCall, context: ToolValidationContext): string | null {
  const { form, intent } = context;
  if (!form || !intent) return null;
  if (tool.name === "narrate_only" || tool.name === "create_memory") return null;

  const allowed = new Set<string>(form.verbMappings?.[intent]?.tools ?? []);
  const hardMoveTools = toolsFromHardMoves(form.hardMoves);
  for (const name of hardMoveTools) allowed.add(name);

  if (context.rollBand === "partial" || context.rollBand === "miss") {
    allowed.add("apply_damage");
    allowed.add("change_form_state");
    allowed.add("introduce_npc");
    allowed.add("move_to");
    allowed.add("pass_time");
    allowed.add("sense");
  }

  if (allowed.size > 0 && !allowed.has(tool.name)) {
    return `tool ${tool.name} is not allowed for form=${form.id} intent=${intent} band=${context.rollBand ?? "unknown"}`;
  }
  return null;
}

function toolsFromHardMoves(hardMoves: FormTemplate["hardMoves"]): Set<string> {
  const out = new Set<string>();
  const maybeMoves =
    hardMoves && typeof hardMoves === "object" ? (hardMoves as { moves?: unknown[] }).moves : null;
  if (!Array.isArray(maybeMoves)) return out;
  for (const move of maybeMoves) {
    if (!move || typeof move !== "object") continue;
    const raw = move as {
      tool?: unknown;
      tools?: Array<{ name?: unknown } | string>;
    };
    if (typeof raw.tool === "string") out.add(raw.tool);
    if (!Array.isArray(raw.tools)) continue;
    for (const tool of raw.tools) {
      if (typeof tool === "string") out.add(tool);
      else if (tool && typeof tool.name === "string") out.add(tool.name);
    }
  }
  return out;
}

const npcTemplateCache = new Map<string, boolean>();

function npcTemplateExists(templateId: string): boolean {
  const cached = npcTemplateCache.get(templateId);
  if (cached !== undefined) return cached;
  const ok = existsSync(join(process.cwd(), "content", "npcs", `${templateId}.json`));
  npcTemplateCache.set(templateId, ok);
  return ok;
}

export function toolToEvent(tool: ToolCall, projection: Projection): Event | null {
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
