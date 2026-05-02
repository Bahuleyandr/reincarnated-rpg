import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  bigint,
} from "drizzle-orm/pg-core";

// Postgres int4range column. drizzle-orm 0.45 has no native helper, so we declare it ourselves.
// On the wire we exchange the canonical Postgres literal `[lo,hi)` (lower inclusive, upper exclusive).
const int4range = customType<{ data: [number, number]; driverData: string }>({
  dataType() {
    return "int4range";
  },
  toDriver([lo, hi]) {
    return `[${lo},${hi})`;
  },
  fromDriver(raw) {
    const m = /^([\[\(])(-?\d+),(-?\d+)([\]\)])$/.exec(raw);
    if (!m) throw new Error(`int4range parse failed: ${raw}`);
    const lo = Number(m[2]) + (m[1] === "(" ? 1 : 0);
    const hi = Number(m[3]) + (m[4] === "]" ? 1 : 0);
    return [lo, hi];
  },
});

export const sessionStatus = pgEnum("session_status", [
  "active",
  "dead",
  "won",
  "capped",
]);

export const entityKind = pgEnum("entity_kind", [
  "npc",
  "location",
  "item",
  "faction",
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  cookieHmac: text("cookie_hmac").notNull().unique(),
  formId: text("form_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  turnCount: integer("turn_count").notNull().default(0),
  status: sessionStatus("status").notNull().default("active"),
});

// Append-only. A trigger installed by migration 0001 raises on UPDATE/DELETE.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    seed: bigint("seed", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("events_session_seq_uniq").on(t.sessionId, t.seq),
    index("events_session_idx").on(t.sessionId),
  ],
);

export const projections = pgTable("projections", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  upToSeq: integer("up_to_seq").notNull(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: entityKind("kind").notNull(),
    slug: text("slug").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("entities_session_kind_slug_uniq").on(
      t.sessionId,
      t.kind,
      t.slug,
    ),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    embedding: vector("embedding", { dimensions: 512 }),
    eventSeqRange: int4range("event_seq_range").notNull(),
    salience: real("salience").notNull().default(0.5),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("memories_session_idx").on(t.sessionId)],
);

export const templatesForms = pgTable("templates_forms", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templatesLocations = pgTable("templates_locations", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templatesNpcs = pgTable("templates_npcs", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templatesItems = pgTable("templates_items", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templatesQuests = pgTable("templates_quests", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type ProjectionRow = typeof projections.$inferSelect;
export type NewProjectionRow = typeof projections.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;
export type FormTemplateRow = typeof templatesForms.$inferSelect;
export type LocationTemplateRow = typeof templatesLocations.$inferSelect;
export type NpcTemplateRow = typeof templatesNpcs.$inferSelect;
export type ItemTemplateRow = typeof templatesItems.$inferSelect;
export type QuestTemplateRow = typeof templatesQuests.$inferSelect;

export const _sql = sql; // re-export for migration writers if needed
