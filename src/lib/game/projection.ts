/**
 * Projection: snapshot + delta.
 *
 * `reduce(state, event)` is a pure function — exhaustively matches the
 * Event union and returns a new Projection. Every event kind has an arm;
 * adding a kind in `types.ts` without updating this switch is a TS error
 * (the `_exhaustive: never` branch).
 *
 * `loadProjection` reads the cached snapshot then replays any events with
 * `seq > snapshot.upToSeq`. Cold reads (or after schema bumps) replay
 * from zero; the snapshot is a cache, never the source of truth.
 *
 * `writeSnapshot` upserts after each successful turn so the next turn's
 * read is O(1) instead of O(N events).
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";

import { projections } from "../db/schema";

import { readLog, rowToEvent } from "./events";
import type {
  Event,
  FormTemplate,
  LocationTemplate,
  Projection,
  SessionStatus,
} from "./types";

type Db = ReturnType<typeof drizzle>;

export function initialProjection(args: {
  sessionId: string;
  form: FormTemplate;
  location: LocationTemplate;
}): Projection {
  const vitals: Record<string, number> = {};
  const vitalsMax: Record<string, number> = {};
  for (const [name, v] of Object.entries(args.form.vitals)) {
    vitals[name] = v.start;
    vitalsMax[name] = v.max;
  }
  return {
    sessionId: args.sessionId,
    upToSeq: 0,
    form: {
      id: args.form.id,
      vitals,
      vitalsMax,
      stats: { ...args.form.stats },
      state: {},
    },
    location: {
      id: args.location.id,
      roomId: args.location.entryRoomId,
      discovered: [args.location.entryRoomId],
    },
    inventory: [],
    npcs: {},
    quest: { id: null, objectives: {} },
    xp: 0,
    turn: 0,
    status: "active",
  };
}

export function applyEvents(state: Projection, events: Event[]): Projection {
  return events.reduce((s, e) => reduce(s, e), state);
}

export function reduce(state: Projection, event: Event): Projection {
  switch (event.kind) {
    // Metadata events — no projection mutation.
    case "session.started":
    case "intent.classified":
    case "roll.resolved":
    case "sensed":
    case "memory.created":
    case "narration.emitted":
    case "tool_validation_failed":
      return state;

    case "turn.begun":
      return { ...state, turn: state.turn + 1 };

    case "damage.applied":
      return reduceDamage(state, event);

    case "healed":
      return reduceHealed(state, event);

    case "form_state.changed": {
      const cur = state.form.state[event.field] ?? 0;
      return {
        ...state,
        form: {
          ...state.form,
          state: { ...state.form.state, [event.field]: cur + event.delta },
        },
      };
    }

    case "inventory.added":
      return reduceInventoryAdded(state, event);

    case "inventory.removed":
      return reduceInventoryRemoved(state, event);

    case "moved":
      return reduceMoved(state, event);

    case "time.passed":
      return {
        ...state,
        form: {
          ...state.form,
          state: {
            ...state.form.state,
            ticks: (state.form.state.ticks ?? 0) + event.ticks,
          },
        },
      };

    case "absorbed":
      return reduceAbsorbed(state, event);

    case "location.discovered": {
      if (state.location.discovered.includes(event.locationId)) return state;
      return {
        ...state,
        location: {
          ...state.location,
          discovered: [...state.location.discovered, event.locationId],
        },
      };
    }

    case "npc.introduced": {
      if (state.npcs[event.npcId]) return state; // already known
      const { name, relationship = 0, ...rest } = event.data;
      return {
        ...state,
        npcs: {
          ...state.npcs,
          [event.npcId]: { name, relationship, ...rest },
        },
      };
    }

    case "relationship.updated": {
      const npc = state.npcs[event.npcId];
      if (!npc) return state; // can't change relationship for unknown NPC
      return {
        ...state,
        npcs: {
          ...state.npcs,
          [event.npcId]: {
            ...npc,
            relationship: npc.relationship + event.delta,
          },
        },
      };
    }

    case "quest.objectiveUpdated":
      return {
        ...state,
        quest: {
          id: state.quest.id ?? event.questId,
          objectives: {
            ...state.quest.objectives,
            [event.objective]: event.status,
          },
        },
      };

    case "xp.granted":
      return { ...state, xp: state.xp + event.amount };

    case "session.ended": {
      const nextStatus: SessionStatus =
        event.reason === "death"
          ? "dead"
          : event.reason === "win"
            ? "won"
            : "capped";
      return { ...state, status: nextStatus };
    }

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

function reduceDamage(
  state: Projection,
  event: Extract<Event, { kind: "damage.applied" }>,
): Projection {
  if (event.target !== "$SELF") return state; // NPC HP lives on entities, not projection
  // Damage hits cohesion (the slime form's primary survivability vital);
  // future forms may target different vitals, in which case we'll add a
  // `vital?: string` field to the event payload. Day-3 scope: cohesion only.
  const cur = state.form.vitals.cohesion ?? 0;
  const next = Math.max(0, cur - event.amount);
  const updated: Projection = {
    ...state,
    form: {
      ...state.form,
      vitals: { ...state.form.vitals, cohesion: next },
    },
  };
  if (next === 0) updated.status = "dead";
  return updated;
}

function reduceHealed(
  state: Projection,
  event: Extract<Event, { kind: "healed" }>,
): Projection {
  if (event.target !== "$SELF") return state;
  const cur = state.form.vitals.cohesion ?? 0;
  const max = state.form.vitalsMax.cohesion ?? cur;
  const next = Math.min(max, cur + event.amount);
  return {
    ...state,
    form: {
      ...state.form,
      vitals: { ...state.form.vitals, cohesion: next },
    },
  };
}

function reduceInventoryAdded(
  state: Projection,
  event: Extract<Event, { kind: "inventory.added" }>,
): Projection {
  if (event.qty <= 0) return state;
  const idx = state.inventory.findIndex((i) => i.itemId === event.itemId);
  if (idx === -1) {
    return {
      ...state,
      inventory: [...state.inventory, { itemId: event.itemId, qty: event.qty }],
    };
  }
  const next = [...state.inventory];
  next[idx] = { ...next[idx], qty: next[idx].qty + event.qty };
  return { ...state, inventory: next };
}

function reduceInventoryRemoved(
  state: Projection,
  event: Extract<Event, { kind: "inventory.removed" }>,
): Projection {
  if (event.qty <= 0) return state;
  const idx = state.inventory.findIndex((i) => i.itemId === event.itemId);
  if (idx === -1) return state; // not held; no-op (validation should have caught it)
  const remaining = state.inventory[idx].qty - event.qty;
  const next = [...state.inventory];
  if (remaining <= 0) {
    next.splice(idx, 1);
  } else {
    next[idx] = { ...next[idx], qty: remaining };
  }
  return { ...state, inventory: next };
}

function reduceMoved(
  state: Projection,
  event: Extract<Event, { kind: "moved" }>,
): Projection {
  const discovered = state.location.discovered.includes(event.toRoom)
    ? state.location.discovered
    : [...state.location.discovered, event.toRoom];
  return {
    ...state,
    location: {
      ...state.location,
      roomId: event.toRoom,
      discovered,
    },
  };
}

function reduceAbsorbed(
  state: Projection,
  event: Extract<Event, { kind: "absorbed" }>,
): Projection {
  // Remove absorbed item from inventory if present.
  const idx = state.inventory.findIndex((i) => i.itemId === event.itemId);
  let inventory = state.inventory;
  if (idx !== -1) {
    inventory = [...state.inventory];
    const remaining = inventory[idx].qty - 1;
    if (remaining <= 0) inventory.splice(idx, 1);
    else inventory[idx] = { ...inventory[idx], qty: remaining };
  }
  // Apply benefit per `into` channel.
  const next: Projection = { ...state, inventory };
  if (event.into === "essence" || event.into === "cohesion") {
    const cur = next.form.vitals[event.into] ?? 0;
    const max = next.form.vitalsMax[event.into] ?? cur + 1;
    next.form = {
      ...next.form,
      vitals: { ...next.form.vitals, [event.into]: Math.min(max, cur + 1) },
    };
  }
  // For other `into` values (traits, future expansion) we record but leave
  // projection alone; the trait gets surfaced via form_state.changed.
  return next;
}

export async function loadProjection(
  db: Db,
  sessionId: string,
  form: FormTemplate,
  location: LocationTemplate,
): Promise<Projection> {
  const [snap] = await db
    .select()
    .from(projections)
    .where(eq(projections.sessionId, sessionId));

  let state: Projection;
  let fromSeq = 0;
  if (snap) {
    state = snap.state as Projection;
    fromSeq = snap.upToSeq;
  } else {
    state = initialProjection({ sessionId, form, location });
  }

  const tail = await readLog(db, sessionId, fromSeq);
  if (tail.length === 0) return state;

  const events = tail.map(rowToEvent);
  const next = applyEvents(state, events);
  next.upToSeq = tail[tail.length - 1].seq;
  return next;
}

export async function writeSnapshot(
  db: Db,
  projection: Projection,
): Promise<void> {
  const now = new Date();
  await db
    .insert(projections)
    .values({
      sessionId: projection.sessionId,
      upToSeq: projection.upToSeq,
      state: projection,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projections.sessionId,
      set: {
        upToSeq: projection.upToSeq,
        state: projection,
        updatedAt: now,
      },
    });
}
