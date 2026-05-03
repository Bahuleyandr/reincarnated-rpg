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

export const campaignStatus = pgEnum("campaign_status", [
  "active",
  "completed",
  "abandoned",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    formId: text("form_id").notNull(),
    /** Free-text declaration ("a cursed armor", "a cartographer's
     *  ghost"). Threaded into the narrator prompt so prose flavors
     *  correctly when formId='generic-creature'. Null for typed forms
     *  (slime, future cursed-book) where the form template carries the
     *  identity itself. */
    reincarnatedAs: text("reincarnated_as"),
    locationId: text("location_id").notNull().default("collapsed-tunnel"),
    status: campaignStatus("status").notNull().default("active"),
    /** Pinned at create time from the user's then-current /settings.
     *  All turns in this campaign keep using these to preserve voice
     *  continuity even if the user later switches their /settings to
     *  a different preset/model. Null = use whatever the user's
     *  current prefs are (legacy behavior). */
    pinnedPresetId: text("pinned_preset_id"),
    pinnedNarrationModel: text("pinned_narration_model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (t) => [index("campaigns_user_idx").on(t.userId)],
);

export const entityKind = pgEnum("entity_kind", [
  "npc",
  "location",
  "item",
  "faction",
]);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    cookieHmac: text("cookie_hmac").notNull().unique(),
    formId: text("form_id").notNull(),
    /** Null for legacy anon sessions; set for sessions created within
     *  a logged-in user's campaign. Anon → campaign claim happens via
     *  POST /api/campaigns/claim. */
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "cascade",
    }),
    /** Per-session location for anon runs (no campaign row to attach
     *  to). Logged-in sessions read this from the campaign instead.
     *  Defaulted to the legacy starter so old sessions keep working. */
    locationId: text("location_id").notNull().default("collapsed-tunnel"),
    /** Free-text reincarnation declaration for anon runs. Threaded into
     *  the narrator just like the campaign field. Null for the default
     *  "first slime" anon flow and pre-feature legacy sessions. */
    reincarnatedAs: text("reincarnated_as"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    turnCount: integer("turn_count").notNull().default(0),
    status: sessionStatus("status").notNull().default("active"),
  },
  (t) => [index("sessions_campaign_idx").on(t.campaignId)],
);

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

/**
 * Per-LLM-call telemetry. One row per request to Anthropic / Voyage /
 * future providers. Lets us answer "what did this turn cost?" without
 * grepping JSON-line logs.
 *
 * Token fields match the Anthropic Messages API usage shape:
 *   - inputTokens     = un-cached prompt tokens (full price)
 *   - cacheReadTokens = served-from-cache tokens (~0.1× price)
 *   - cacheCreateTokens = written-to-cache tokens (~1.25× price for 5m TTL)
 *   - outputTokens    = generation tokens
 */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    /** Set when the call originated under a logged-in user. Lets the
     *  cost panel answer "what has $USER spent on AI calls in the last
     *  N days" without N+1 joining session→campaign→user. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Preset id from src/lib/ai/presets.ts when the call hit a BYO
     *  provider. Null for env-default calls. Powers the per-provider
     *  eval leaderboard later. */
    presetId: text("preset_id"),
    callType: text("call_type").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheCreateTokens: integer("cache_create_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    success: text("success").notNull().default("true"),
    errorMsg: text("error_msg"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_calls_session_idx").on(t.sessionId),
    index("ai_calls_user_idx").on(t.userId),
    index("ai_calls_created_at_idx").on(t.createdAt),
  ],
);

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
export type AiCallRow = typeof aiCalls.$inferSelect;
export type NewAiCallRow = typeof aiCalls.$inferInsert;
/**
 * Per-user "bring your own LLM" config. One row per user; the user
 * picks a preset (anthropic / openai / minimax / openrouter / ollama /
 * custom / ...) on /settings, optionally tweaks model + base URL, and
 * pastes their API key. The key is encrypted at rest with a
 * SESSION_SECRET-derived AES-256-GCM key (see lib/util/crypto.ts).
 *
 * Per-call-type model split:
 *   - `model` is the narration model (smart, expensive, mandatory).
 *   - `classifierModel` and `toneModel` are optional cheap-model
 *     overrides used when those LLM-judge paths are turned on. When
 *     null, the runtime substitutes `model` for them (i.e. one model
 *     does everything — backward-compat default).
 *
 * When this row is absent, the runtime falls back to the env-default
 * provider — preserving the existing AI_PROVIDER + ANTHROPIC_API_KEY
 * deployment story.
 */
export const userLlmPrefs = pgTable("user_llm_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Preset id from src/lib/ai/presets.ts (anthropic, openai, minimax, ...). */
  presetId: text("preset_id").notNull(),
  /** Underlying impl: "anthropic" or "openai-compatible". */
  providerKind: text("provider_kind").notNull(),
  /** Effective base URL. Null only for the anthropic preset. */
  baseUrl: text("base_url"),
  /** Narration model id (per-provider format). */
  model: text("model").notNull(),
  /** Classifier model — when set + useLlmClassifier, used in place of
   *  the regex `classify()`. Null = use narration model (or, with
   *  useLlmClassifier off, fall back to regex). */
  classifierModel: text("classifier_model"),
  /** Tone judge model — when set + useLlmTone, runs the second-pass
   *  judge after the regex check. Same null-fallback as classifier. */
  toneModel: text("tone_model"),
  /** Opt-in: route classify() through the LLM tool path. Costs a
   *  cheap call per turn but recovers ambiguity the regex misses. */
  useLlmClassifier: text("use_llm_classifier").notNull().default("false"),
  /** Opt-in: run the tone judge as a second pass after the regex
   *  layer. Only fires when the regex layer says ok=true (so it's a
   *  quality gate, not the primary check). */
  useLlmTone: text("use_llm_tone").notNull().default("false"),
  /** AES-256-GCM ciphertext of the API key. Null for ollama-local
   *  (or any future preset where needsApiKey=false). */
  apiKeyEnc: text("api_key_enc"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type UserLlmPrefs = typeof userLlmPrefs.$inferSelect;
export type NewUserLlmPrefs = typeof userLlmPrefs.$inferInsert;

export const _sql = sql; // re-export for migration writers if needed
