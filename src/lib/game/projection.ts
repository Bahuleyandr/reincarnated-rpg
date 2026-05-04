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
  /** Override the room the player wakes in. Defaults to
   *  location.entryRoomId. Used by the random-start flow. */
  startingRoomId?: string;
  /** Free-text identity for the player; threaded into NarrateInput
   *  so the prose can flavor the run. */
  reincarnatedAs?: string | null;
  /** Initial form-state buffs from the reincarnation picker's
   *  starterBonus payload. e.g. picking "a candle in a well" stamps
   *  { kindling: 1 } into form.state at projection-init time. The
   *  safety guardrail (in tools.ts) caps each field's absolute value
   *  later during normal play. */
  starterFormState?: Record<string, number>;
}): Projection {
  const vitals: Record<string, number> = {};
  const vitalsMax: Record<string, number> = {};
  const vitalsDeath: Record<string, number | null> = {};
  for (const [name, v] of Object.entries(args.form.vitals)) {
    vitals[name] = v.start;
    vitalsMax[name] = v.max;
    vitalsDeath[name] = v.death ?? null;
  }
  const startingRoom =
    args.startingRoomId &&
    args.location.rooms.some((r) => r.id === args.startingRoomId)
      ? args.startingRoomId
      : args.location.entryRoomId;
  return {
    sessionId: args.sessionId,
    upToSeq: 0,
    form: {
      id: args.form.id,
      vitals,
      vitalsMax,
      vitalsDeath,
      stats: { ...args.form.stats },
      state: { ...(args.starterFormState ?? {}) },
    },
    location: {
      id: args.location.id,
      roomId: startingRoom,
      discovered: [startingRoom],
    },
    inventory: [],
    npcs: {},
    quest: { id: null, objectives: {} },
    xp: 0,
    turn: 0,
    status: "active",
    reincarnatedAs: args.reincarnatedAs ?? null,
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
    case "wonder.fired":
    // Coin balance lives on users.coins / sessions.coins, NOT on the
    // projection. Events are still emitted for audit + replay-from-zero
    // (the orchestrator scans them after each turn to apply the delta
    // to the persistent purse). Reducer no-op here keeps projection
    // determinism intact even though the side effect is external.
    case "coins.gained":
    case "coins.spent":
    case "trade.completed":
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

/**
 * Pick the vital that damage/heal target by default.
 * "Primary death vital" = the first vital with a non-null death threshold.
 * Slime: cohesion (death=0). Cursed Book: pages_intact. Etc.
 * Falls back to the first declared vital if no death-marked vital exists.
 */
function primaryDeathVital(state: Projection): string {
  for (const [name, threshold] of Object.entries(state.form.vitalsDeath)) {
    if (threshold !== null) return name;
  }
  const first = Object.keys(state.form.vitals)[0];
  return first ?? "cohesion";
}

function reduceDamage(
  state: Projection,
  event: Extract<Event, { kind: "damage.applied" }>,
): Projection {
  if (event.target !== "$SELF") return state; // NPC HP lives on entities, not projection
  const vital = event.vital ?? primaryDeathVital(state);
  const cur = state.form.vitals[vital] ?? 0;
  const next = Math.max(0, cur - event.amount);
  const updated: Projection = {
    ...state,
    form: {
      ...state.form,
      vitals: { ...state.form.vitals, [vital]: next },
    },
  };
  const threshold = state.form.vitalsDeath[vital];
  if (threshold !== null && threshold !== undefined && next <= threshold) {
    updated.status = "dead";
  }
  return updated;
}

function reduceHealed(
  state: Projection,
  event: Extract<Event, { kind: "healed" }>,
): Projection {
  if (event.target !== "$SELF") return state;
  const vital = event.vital ?? primaryDeathVital(state);
  const cur = state.form.vitals[vital] ?? 0;
  const max = state.form.vitalsMax[vital] ?? cur;
  const next = Math.min(max, cur + event.amount);
  return {
    ...state,
    form: {
      ...state.form,
      vitals: { ...state.form.vitals, [vital]: next },
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
  opts: {
    startingRoomId?: string;
    reincarnatedAs?: string | null;
    starterFormState?: Record<string, number>;
  } = {},
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
    state = initialProjection({
      sessionId,
      form,
      location,
      startingRoomId: opts.startingRoomId,
      reincarnatedAs: opts.reincarnatedAs,
      starterFormState: opts.starterFormState,
    });
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
