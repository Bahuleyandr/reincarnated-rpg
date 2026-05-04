import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  date,
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

export const sessionStatus = pgEnum("session_status", ["active", "dead", "won", "capped"]);

export const campaignStatus = pgEnum("campaign_status", ["active", "completed", "abandoned"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Game-mod / admin flag. Granted manually via SQL by the deploy
   *  operator. Lets the user nudge the meta-arc, inject world events,
   *  and tune the reincarnation picker's option weights from /god. */
  isAdmin: text("is_admin").notNull().default("false"),
  /** Energy tier — gates daily turn budget. See lib/energy/tiers.ts
   *  for the catalog. Default 'free'. Promotion to supporter/patron
   *  is admin-only in v1; payment integration TBD. */
  tier: text("tier").notNull().default("free"),
  /** Current energy. Decrements 1 per turn; refills continuously up
   *  to the tier max via the rate from tiers.ts. Set to free-tier max
   *  on insert (handled in register/auth). */
  energy: integer("energy").notNull().default(20),
  /** Last time the energy column was updated by a refill or spend.
   *  applyRegen() reads (now - this) and credits floor((delta) /
   *  regenInterval) ticks, advancing this timestamp by exactly that
   *  many intervals so partial intervals don't get lost. */
  energyUpdatedAt: timestamp("energy_updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Daily-streak count, 0..5. Bumped when the player takes their
   *  first turn on a UTC day immediately following a previous
   *  login day. Reset to 1 if they missed at least one day. Capped
   *  at 5. */
  streakCount: integer("streak_count").notNull().default(0),
  /** UTC date string (YYYY-MM-DD) of the last day this player took
   *  a turn. Null until the first turn ever. Compared as a string
   *  in lib/energy/streak.ts. */
  streakLastDayUtc: text("streak_last_day_utc"),
  /** Cross-run scars and gifts. Each death imprints (or stacks) a
   *  trait keyed on the slugs in content/legacy/traits.json. The
   *  next reincarnation reads this and applies the trait's
   *  starter form-state effect — see src/lib/legacy/apply.ts.
   *  Anon sessions never accumulate; only logged-in users have a
   *  durable soul. */
  legacyTraits: jsonb("legacy_traits").notNull().default({}),
  /** Slug of the title the player has chosen to pin (from
   *  content/achievements.json, achievement.titleAwarded). Validated
   *  on POST /api/settings/title against the player's actual
   *  unlocks. Null = no title displayed. */
  pinnedTitle: text("pinned_title"),
  /** Per-user narration mood preset: 'cozy' | 'standard' | 'brutal'.
   *  sessions.mood_preset (nullable) overrides per-campaign; null
   *  there falls back to this. Default 'standard'. */
  moodPreset: text("mood_preset").notNull().default("standard"),
  /** Count of consecutive recent deaths since the last non-death.
   *  Updated at run-end in persistRunToWorld. Used by the adaptive-
   *  difficulty layer to add +1 to roll modifiers after 3+ deaths.
   *  Phase 2 Day 12. */
  adaptiveDeathStreak: integer("adaptive_death_streak").notNull().default(0),
  /** Opt-in flag for inline scene images. Default 'false' — players
   *  must explicitly enable in /settings. Stored as text matching
   *  the isAdmin convention used elsewhere in this table.
   *  Phase 3 Day 14. */
  sceneImagesEnabled: text("scene_images_enabled").notNull().default("false"),
  /** Per-month image generation budget. Resets when month_key
   *  changes (YYYY-MM format). Free tier capped at SCENE_IMAGE_FREE_CAP;
   *  paid tiers higher. */
  sceneImagesMonthlyCount: integer("scene_images_monthly_count").notNull().default(0),
  sceneImagesMonthKey: text("scene_images_month_key"),
  /** User-level coin balance. Survives reincarnation. Default 50
   *  (enough for the tutorial vendor without grinding). Negative
   *  values blocked by CHECK constraint and lib/economy/coins.ts.
   *  Phase 5 Day 18-19. */
  coins: integer("coins").notNull().default(50),
  /** 0..10 pool of cheap craft actions before the next energy
   *  spend. Decrements per gather / smelt / smith action; when it
   *  hits 0 the next action charges 1 energy and refills the pool
   *  to 10 (net: 1 energy per 10 craft actions). Phase 5 Day 20. */
  craftCredits: integer("craft_credits").notNull().default(10),
  /** Per-form 24h cooldown audit (Phase 5.5 Day 29). Shape:
   *  Array<{ formId: string, diedAt: ISO timestamp }>. The
   *  reincarnation picker filters formIds whose latest entry is
   *  within 24h. Trimmed to last 7 days on each write. */
  recentFormDeaths: jsonb("recent_form_deaths").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    /** Which scripted beat pack this campaign is running. Picked
     *  randomly at create time from the (formId, locationId)-
     *  compatible pool in src/lib/game/arc-routing.ts. Null means
     *  no arc — narrator runs free-form. */
    arcId: text("arc_id"),
    /** Reincarnation catalog option id the player chose. Lets the
     *  recap show what the God offered AND lets us replay the
     *  starterBonus on first projection-init even after a snapshot
     *  reset (the value is also baked into the projection.form.state
     *  immediately). Null for free-text reincarnations not from the
     *  catalog. */
    reincarnationOptionId: text("reincarnation_option_id"),
    /** Starter bonus payload (single { field, value } from the
     *  catalog option). Stored as jsonb for forward-compat in case
     *  bonuses grow into multi-field arrays. */
    starterBonus: jsonb("starter_bonus"),
    /** Optional shareable token. Set when the player runs POST
     *  /api/campaigns/[id]/share; cleared by DELETE. The token is
     *  the only key in the URL — a 16-char random ID minted by
     *  randomBytes. UNIQUE partial index on (share_token) WHERE
     *  share_token IS NOT NULL. */
    shareToken: text("share_token"),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("campaigns_user_idx").on(t.userId),
    /** Hot query: liveDistribution() in reincarnation-picker (and the
     *  /god dashboard) groups active campaigns by formId in the last 7d.
     *  Composite (status, created_at) lets the planner skip seq-scan
     *  once we have meaningful campaign volume. */
    index("campaigns_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const entityKind = pgEnum("entity_kind", ["npc", "location", "item", "faction"]);

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
    /** Heartbeat — bumped by /api/presence/heartbeat. The /nearby
     *  endpoint considers a session "live" if last_active_at is
     *  within the last 90 seconds. Null on legacy sessions. */
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    /** Anon-session energy. Mirrors users.energy but scoped to the
     *  cookie-bound session for non-logged-in players. Logged-in
     *  sessions IGNORE this column and read from users.* instead. */
    energy: integer("energy").notNull().default(20),
    energyUpdatedAt: timestamp("energy_updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    /** Anon daily-streak count, 0..5. Same semantics as users.streak_count. */
    streakCount: integer("streak_count").notNull().default(0),
    streakLastDayUtc: text("streak_last_day_utc"),
    /** Per-session mood override. Null = fall back to users.moodPreset
     *  (or 'standard' for anon). Allows a logged-in user to start a
     *  one-off "brutal" run without flipping their global setting. */
    moodPreset: text("mood_preset"),
    /** Anon-session coin purse. Logged-in sessions IGNORE this and
     *  read from users.coins. On register/claim, anon coins migrate
     *  into users.coins via maybeClaimAnonSession. Default 0 — anon
     *  players earn coins through play (the user-tier 50-coin gift
     *  is meant as a registration incentive). Phase 5 Day 18-19. */
    coins: integer("coins").notNull().default(0),
    /** Anon craft credits pool — same semantics as users.craftCredits.
     *  Logged-in sessions IGNORE this. Phase 5 Day 20. */
    craftCredits: integer("craft_credits").notNull().default(10),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    turnLockToken: text("turn_lock_token"),
    turnLockExpiresAt: timestamp("turn_lock_expires_at", {
      withTimezone: true,
    }),
    turnCount: integer("turn_count").notNull().default(0),
    status: sessionStatus("status").notNull().default("active"),
  },
  (t) => [
    index("sessions_campaign_idx").on(t.campaignId),
    index("sessions_last_active_idx").on(t.lastActiveAt),
    index("sessions_turn_lock_expires_idx").on(t.turnLockExpiresAt),
  ],
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entities_session_kind_slug_uniq").on(t.sessionId, t.kind, t.slug)],
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
    /** Phase 4.5 Day 16. NULL = ordinary memory; integer = echo
     *  that surfaces only as `echoHint` until projection.turn
     *  reaches this value, then becomes a normal retrievable
     *  memory. */
    surfaceAfterTurn: integer("surface_after_turn"),
    /** 1-line redacted teaser shown while the echo is still
     *  pending. */
    echoHint: text("echo_hint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memories_session_idx").on(t.sessionId),
    index("memories_session_surface_idx").on(t.sessionId, t.surfaceAfterTurn),
  ],
);

export const templatesForms = pgTable("templates_forms", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templatesLocations = pgTable("templates_locations", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templatesNpcs = pgTable("templates_npcs", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templatesItems = pgTable("templates_items", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templatesQuests = pgTable("templates_quests", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_calls_session_idx").on(t.sessionId),
    index("ai_calls_user_idx").on(t.userId),
    index("ai_calls_created_at_idx").on(t.createdAt),
    /** Hot query: /api/leaderboard scans `WHERE call_type=X AND
     *  created_at >= since`. Composite (call_type, created_at)
     *  means we can answer the leaderboard from the index alone
     *  with a backward scan. */
    index("ai_calls_calltype_created_idx").on(t.callType, t.createdAt),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * World-layer persistence: NPCs the player has met across runs.
 *
 * "The world remembers what you did." Each user has their own world
 * — a per-user collection of NPCs they've encountered, with cumulative
 * relationship state (Berra remembers a slime saved her, twice, three
 * lifetimes ago). On a new campaign, recallWorld() looks up matching
 * NPCs and injects them into NarrateInput.relevantMemories so the
 * narrator can reference them.
 *
 * Slug is unique per user — same NPC appearing in five campaigns is
 * one row that gets updated, not five rows.
 *
 * Note: this is per-user world memory. A future global-shared world
 * (where Berra remembers EVERY player) would key off a sharedWorldId
 * column; for v0.1 each user has a private world.
 */
export const worldNpcs = pgTable(
  "world_npcs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Stable slug used to look this NPC up across campaigns. Comes
     *  from the original NPC template id when known; lowercase-name
     *  fallback otherwise. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Cumulative relationship score across all runs. Sum of every
     *  relationship.updated event delta the player ever produced. */
    relationshipScore: integer("relationship_score").notNull().default(0),
    /** Short prose memory — "Berra the smith. Once worked iron in a
     *  forsaken village. The slime you were saved her, twice." Hand-
     *  composed from run summaries or templated. */
    memorySummary: text("memory_summary"),
    /** Last seen status: 'alive' | 'dead' | 'unknown'. Inherits from
     *  the most recent campaign's last interaction. */
    lastSeenStatus: text("last_seen_status").notNull().default("alive"),
    /** Counters for cumulative interaction depth, useful for
     *  threshold-based hooks ("after 3 saves of Berra, …"). */
    timesMet: integer("times_met").notNull().default(1),
    timesHelped: integer("times_helped").notNull().default(0),
    timesHarmed: integer("times_harmed").notNull().default(0),
    firstMetCampaignId: uuid("first_met_campaign_id"),
    lastSeenCampaignId: uuid("last_seen_campaign_id"),
    /** Original NPC entity data (template id, attitude, etc) merged
     *  with accumulated facts. */
    data: jsonb("data").notNull(),
    /** Companion-bond timestamp. NULL = ordinary world NPC. Non-null
     *  = the relationship score crossed +3 in some run; promoted to
     *  recurring companion. Set once and never cleared (a bond
     *  survives even if relationshipScore later drops below the
     *  threshold — once they remember you, they remember). */
    bondedAt: timestamp("bonded_at", { withTimezone: true }),
    /** Personality card generated at bond time. Shape:
     *  { voice: string, mannerisms: string[], topicsOfInterest: string[],
     *    formMet: string }. Used by recall.ts to compose a 1-line
     *  history beat the narrator weaves into turn 1 of new
     *  campaigns. Generated once via a Haiku 4.5 call (cached). */
    personalityCard: jsonb("personality_card"),
    /** Phase 5.5 Day 34-35. Marks named antagonists / recurring NPCs
     *  (Rhozell, Kethra, etc.) so the appearance hook can read them
     *  cheaply via a partial index. Set on insert from the NPC
     *  template's `recurring: true` flag. */
    isRecurring: boolean("is_recurring").notNull().default(false),
    /** Per-user run-history audit for recurring NPCs. Each entry:
     *  { sessionId, outcome, at }. The antagonist hook composes a
     *  1-line "history beat" the narrator weaves in on first
     *  appearance ("Rhozell remembers your last face — a slime,
     *  drowned in the cistern."). Deterministic template, no LLM. */
    runHistory: jsonb("run_history").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("world_npcs_user_slug_uniq").on(t.userId, t.slug),
    index("world_npcs_user_idx").on(t.userId),
  ],
);

/**
 * World-layer episodic memories — short prose recalls of notable run
 * moments. Embedded for similarity retrieval in future campaigns.
 *
 * One row per session.ended (well, one summary per ended run).
 * Optional N more for "notable" mid-run beats (deaths of NPCs, quest
 * completions). Salience boosts heavy moments in the kNN retrieval.
 */
export const worldMemories = pgTable(
  "world_memories",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    embedding: vector("embedding", { dimensions: 512 }),
    /** Tags such as 'death', 'win', 'saved:berra', 'killed:wolf'. Used
     *  for filtering and for tying memories to NPCs. */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    salience: real("salience").notNull().default(0.5),
    sourceCampaignId: uuid("source_campaign_id"),
    sourceFormId: text("source_form_id"),
    sourceLocationId: text("source_location_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("world_memories_user_idx").on(t.userId)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type UserLlmPrefs = typeof userLlmPrefs.$inferSelect;
export type NewUserLlmPrefs = typeof userLlmPrefs.$inferInsert;
export type WorldNpc = typeof worldNpcs.$inferSelect;
export type NewWorldNpc = typeof worldNpcs.$inferInsert;
export type WorldMemory = typeof worldMemories.$inferSelect;
export type NewWorldMemory = typeof worldMemories.$inferInsert;

/**
 * Global world lore — the canonical ledger of major events that
 * happened in the world. Distinct from world_memories (which is
 * per-user); this is the SHARED knowledge that every player's
 * narrator references on first-turn recall.
 *
 * Filtering: only events that pass the lore judge get promoted
 * here. Trivial runs (player saved a kitten, player got dropped a
 * pebble) stay in their per-user world_memories. World-changing
 * runs (a city fell, an artifact was found, an NPC died at a
 * pivotal moment) get a row here.
 *
 * The ledger is append-only. Time-limited events (e.g., "the
 * cult is recruiting") may set expires_at to fall out of recall
 * naturally; permanent events (e.g., "the lighthouse keeper drowned
 * the cathedral") leave it null.
 */
export const worldLore = pgTable(
  "world_lore",
  {
    id: uuid("id").primaryKey(),
    /** 1-2 sentence canonical summary used by the narrator. */
    summary: text("summary").notNull(),
    /** Richer prose for the public /meta lore feed. Optional. */
    prose: text("prose"),
    /** Embedding for semantic retrieval. Optional — Voyage may be
     *  unavailable in dev. */
    embedding: vector("embedding", { dimensions: 512 }),
    /** Judge-scored 0..1. ≥0.6 is the promotion threshold. */
    salience: real("salience").notNull(),
    /** Category — useful for filtering on /meta. e.g. 'city-event',
     *  'artifact', 'npc-fate', 'cult', 'plague', 'wyrm-event'. */
    category: text("category"),
    /** Tags array — finer-grained than category. */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Attribution. NULL on admin-injected events. */
    sourceUserId: uuid("source_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceCampaignId: uuid("source_campaign_id"),
    sourceSessionId: uuid("source_session_id"),
    sourceLocationId: text("source_location_id"),
    sourceFormId: text("source_form_id"),
    /** The wyrm phase at the time the event happened. Lets future
     *  rendering color old lore by world-state. */
    sourcePhase: text("source_phase"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Bumped whenever an admin edits an entry via PUT /api/god/lore.
     *  Equal to createdAt on initial insert. The /meta UI shows
     *  "edited" when this differs. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Admin who last edited this entry. Null on initial promotion;
     *  set to admin user id on PUT. Display-only — for audit. */
    lastEditedByUserId: uuid("last_edited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Time-limited events — null = permanent. Set by:
     *   - the lore judge for genuinely time-limited events (rare),
     *   - admin via /god/lore/[id] DELETE (redact = set to NOW()). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Admin redaction flag (Phase 4.5 Day 15). When true, the entry
     *  is hidden from the public /lore feed regardless of age. The
     *  /god/lore admin UI flips this on griefing content. The 24h
     *  delay before public surfacing gives admins a window to do
     *  this without leaking the content first. */
    adminRedacted: boolean("admin_redacted").notNull().default(false),
  },
  (t) => [
    index("world_lore_salience_idx").on(t.salience, t.createdAt),
    index("world_lore_category_idx").on(t.category),
    index("world_lore_user_idx").on(t.sourceUserId),
    /** Phase 5.5 Day 30. Hot query: "recent epitaphs at <locationId>"
     *  used by the next-campaign turn-1 memory injection. */
    index("world_lore_location_category_idx").on(
      t.sourceLocationId,
      t.category,
      t.createdAt,
    ),
  ],
);

export type WorldLore = typeof worldLore.$inferSelect;
export type NewWorldLore = typeof worldLore.$inferInsert;

/**
 * Real-time chat messages, per-room. The MMORPG-shape OOC layer
 * (out-of-character — the narrator doesn't see these). Players
 * physically in the same (locationId, roomId) can speak; the chat
 * is shared between all PCs there.
 *
 * v1 design choices:
 *   - 280-char per message (Twitter-shaped). Soft limit on the
 *     server; UI hints at it.
 *   - ~1h read-window: every chat read filters to the last hour.
 *     Older messages stay in the table (audit trail) but aren't
 *     surfaced. A future cron can delete old rows.
 *   - displayName + formId snapshotted at send-time so renaming
 *     reincarnatedAs later doesn't rewrite history.
 *   - Chat is intentionally NOT injected into the narrator — that's
 *     a different design problem (mixing OOC + IC). Roleplay-style
 *     in-game speech remains the player's input typed through the
 *     normal turn flow.
 */
export const roomMessages = pgTable(
  "room_messages",
  {
    id: uuid("id").primaryKey(),
    locationId: text("location_id").notNull(),
    roomId: text("room_id").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    text: text("text").notNull(),
    /** Snapshot of the player's display name at send-time. For
     *  logged-in users, "username" is set separately; for anon
     *  this falls back to the reincarnatedAs / form humanization. */
    displayName: text("display_name").notNull(),
    /** Snapshot username for logged-in users. Null for anon. */
    username: text("username"),
    formId: text("form_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Hot query: WHERE location_id=X AND room_id=Y ORDER BY
     *  created_at DESC LIMIT N. Composite covers both eq's plus
     *  the ORDER. */
    index("room_messages_room_created_idx").on(t.locationId, t.roomId, t.createdAt),
    index("room_messages_session_idx").on(t.sessionId),
  ],
);

export type RoomMessage = typeof roomMessages.$inferSelect;
export type NewRoomMessage = typeof roomMessages.$inferInsert;

/**
 * Meta-arc — the over-arching shared story above all individual runs.
 *
 * One row per arc id. v0.1 ships a single arc, "long-wyrm". Every
 * player's outcome contributes a small delta (feed = positive,
 * starve = negative). When `progress` crosses a phase boundary, the
 * `phase` advances and every subsequent player sees a transformed
 * world (new ambient flavor in the system prompt, new hardMove
 * outcomes, etc).
 *
 * The arc is GLOBAL — not per-user. There is one Long Wyrm and every
 * player is in its world.
 */
export const metaArcs = pgTable("meta_arcs", {
  id: text("id").primaryKey(),
  /** Cumulative delta across all contributions. Bounded [0, max]. */
  progress: integer("progress").notNull().default(0),
  /** Active phase. Recomputed from progress on each contribution. */
  phase: text("phase").notNull().default("stirring"),
  /** Human-readable title for the current phase. UI-side. */
  phaseLabel: text("phase_label").notNull().default("Stirring"),
  /** Tally of "feed" contributions across all time. */
  totalFeeds: integer("total_feeds").notNull().default(0),
  /** Tally of "starve" contributions. */
  totalStarves: integer("total_starves").notNull().default(0),
  /** Distinct contributors. */
  contributorCount: integer("contributor_count").notNull().default(0),
  /** Free-form metadata: phase-specific flavor strings, last
   *  significant event, etc. */
  meta: jsonb("meta"),
  /** Raid HP. Every contribution (feed or starve) does damage equal
   *  to the absolute themed delta. When hp hits 0, the wyrm "falls":
   *  the arc rolls over with fresh hp + a wyrm.fallen audit row.
   *  Phase 3 Day 13. */
  hp: integer("hp").notNull().default(1000),
  hpMax: integer("hp_max").notNull().default(1000),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per ended-run contribution. Lets the /meta page show
 * "recent contributors" and lets us audit the progress total.
 *
 * userId can be null for anon contributions (we still credit them
 * via the session, but no display name).
 */
export const metaContributions = pgTable(
  "meta_contributions",
  {
    id: uuid("id").primaryKey(),
    arcId: text("arc_id")
      .notNull()
      .references(() => metaArcs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    /** Signed delta. +N = feed, -N = starve. */
    delta: integer("delta").notNull(),
    /** Tag like 'outcome:death', 'outcome:win', 'absorb-heavy', etc. */
    reason: text("reason").notNull(),
    /** Short prose for the public feed. */
    prose: text("prose"),
    /** Form + location at the time, for UI breakdowns. */
    formId: text("form_id"),
    locationId: text("location_id"),
    /** Phase the arc was in WHEN this contribution landed. Lets us
     *  show "rising-phase contributions" vs "feasting-phase". */
    phaseAtContribution: text("phase_at_contribution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meta_contributions_arc_idx").on(t.arcId, t.createdAt),
    index("meta_contributions_user_idx").on(t.userId),
  ],
);

export type MetaArc = typeof metaArcs.$inferSelect;
export type NewMetaArc = typeof metaArcs.$inferInsert;
export type MetaContribution = typeof metaContributions.$inferSelect;
export type NewMetaContribution = typeof metaContributions.$inferInsert;

/**
 * Audit trail for the per-session turn-lock primitive (see
 * `src/lib/game/turn-lock.ts`). Append-only — every acquire,
 * release, expiry-claim, and admin force-release writes a row.
 *
 * Letting this be a real table (vs. just JSON-line logs) means
 * forensic queries are SQL-trivial: which sessions hit the most
 * lock conflicts, how long does the average turn hold the lock,
 * which lock got force-released and why. Cheap; bounded by turn
 * volume × ~2 (acquire + release per turn).
 */
export const turnLockEvents = pgTable(
  "turn_lock_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** 'acquired' | 'released' | 'claimed_expired' | 'force_released' | 'release_no_op' */
    eventKind: text("event_kind").notNull(),
    token: text("token"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("turn_lock_events_session_idx").on(t.sessionId, t.at),
    index("turn_lock_events_kind_idx").on(t.eventKind, t.at),
  ],
);

export type TurnLockEvent = typeof turnLockEvents.$inferSelect;
export type NewTurnLockEvent = typeof turnLockEvents.$inferInsert;

/**
 * Per-user achievement unlocks. UNIQUE (user_id, achievement_id) so
 * the runner can be idempotent — duplicate unlocks are silently
 * absorbed by the constraint. evidence_event_ids carries the audit
 * trail (which events caused the match) for replay + UI attribution.
 */
export const achievementsUnlocked = pgTable(
  "achievements_unlocked",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
    campaignId: uuid("campaign_id").references(() => campaigns.id),
    evidenceEventIds: uuid("evidence_event_ids").array(),
  },
  (t) => [
    uniqueIndex("achievements_unique_per_user").on(t.userId, t.achievementId),
    index("achievements_user_idx").on(t.userId),
    index("achievements_unlocked_at_idx").on(t.unlockedAt),
  ],
);

export type AchievementUnlocked = typeof achievementsUnlocked.$inferSelect;
export type NewAchievementUnlocked = typeof achievementsUnlocked.$inferInsert;

/**
 * Daily / weekly objective progress per user per period. UNIQUE
 * (user_id, objective_id, period_key) ensures one row per
 * objective/period; the runner upserts increments. completed_at
 * fills in when progress meets target; reward_claimed_at fills in
 * after the player explicitly claims via /api/objectives/claim.
 */
export const objectiveProgress = pgTable(
  "objective_progress",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    objectiveId: text("objective_id").notNull(),
    /** 'YYYY-MM-DD' for daily; 'YYYY-Www' (ISO) for weekly. */
    periodKey: text("period_key").notNull(),
    progress: integer("progress").notNull().default(0),
    target: integer("target").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    rewardClaimedAt: timestamp("reward_claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("obj_user_obj_period_unique").on(t.userId, t.objectiveId, t.periodKey),
    index("obj_user_period_idx").on(t.userId, t.periodKey),
  ],
);

export type ObjectiveProgress = typeof objectiveProgress.$inferSelect;
export type NewObjectiveProgress = typeof objectiveProgress.$inferInsert;

/**
 * Player-to-player gifts (Phase 2 Day 9). Sender pays a per-day
 * rate-limit (1 send / day, enforced in lib/gifts/send.ts);
 * receiver explicitly redeems via /api/gifts/[id]/redeem. The
 * payload jsonb carries kind-specific data ({ amount: 5 } for
 * 'energy', etc.). 280-char message cap matches the epitaph cap +
 * Twitter-style discipline.
 */
export const gifts = pgTable("gifts", {
  id: uuid("id").primaryKey(),
  fromUserId: uuid("from_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 'energy' | 'cleanse' | 'blessing' */
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  message: text("message"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
});

export type Gift = typeof gifts.$inferSelect;
export type NewGift = typeof gifts.$inferInsert;

/**
 * Scene images (Phase 3 Day 14). Opt-in, cost-gated. Generated at
 * a small set of trigger moments (turn 1 awakening, first NPC,
 * death, win, wyrm-fell). UNIQUE on (session_id, trigger, turn) so
 * accidental re-fires don't double-spend.
 *
 * status:
 *   'pending'  — record created; provider call queued.
 *   'ready'    — image_url populated; serve it.
 *   'failed'   — provider rejected; error column has the reason.
 *   'skipped'  — preflight (cost cap, opt-out) chose not to call;
 *                no provider cost.
 */
export const sceneImages = pgTable(
  "scene_images",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    turn: integer("turn").notNull(),
    prompt: text("prompt").notNull(),
    imageUrl: text("image_url"),
    provider: text("provider"),
    model: text("model"),
    costUsd: real("cost_usd").notNull().default(0),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("scene_images_unique_per_trigger").on(t.sessionId, t.trigger, t.turn),
    index("scene_images_session_idx").on(t.sessionId, t.turn),
  ],
);

export type SceneImage = typeof sceneImages.$inferSelect;
export type NewSceneImage = typeof sceneImages.$inferInsert;

/**
 * Per-user skill rows (Phase 5 Day 23-24). Skills are cross-run —
 * once learned via `learn_skill_from(npcId)`, the player keeps the
 * skill across reincarnations. UNIQUE (user_id, skill_id) ensures
 * idempotent learn calls. XP accrues on craft/gather events; level
 * recomputes via floor(sqrt(xp/50)) — see lib/economy/skills.ts.
 */
export const userSkills = pgTable(
  "user_skills",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    learnedAt: timestamp("learned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Slug of the NPC who taught this skill — null when granted via
     *  admin or migration backfill. */
    learnedFromNpcId: text("learned_from_npc_id"),
  },
  (t) => [
    uniqueIndex("user_skills_user_skill_uniq").on(t.userId, t.skillId),
    index("user_skills_user_idx").on(t.userId),
  ],
);

export type UserSkill = typeof userSkills.$inferSelect;
export type NewUserSkill = typeof userSkills.$inferInsert;

/**
 * Asynchronous location notes (Phase 5.5 Day 32-33). Players
 * leave one-line notes pinned to a location; other players passing
 * through later see the top-voted ones. Auto-expire 30d. Notes
 * with 3+ distinct flagger votes auto-hide pending admin review.
 */
export const locationNotes = pgTable(
  "location_notes",
  {
    id: uuid("id").primaryKey(),
    locationId: text("location_id").notNull(),
    formId: text("form_id"),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    text: text("text").notNull(),
    votes: integer("votes").notNull().default(0),
    flagCount: integer("flag_count").notNull().default(0),
    flagged: boolean("flagged").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("location_notes_author_idx").on(t.authorUserId),
  ],
);

export type LocationNote = typeof locationNotes.$inferSelect;
export type NewLocationNote = typeof locationNotes.$inferInsert;

export const locationNoteVotes = pgTable(
  "location_note_votes",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => locationNotes.id, { onDelete: "cascade" }),
    voterUserId: uuid("voter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    voteKind: text("vote_kind").notNull().default("up"),
    votedAt: timestamp("voted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("location_note_votes_pk").on(t.noteId, t.voterUserId),
  ],
);

export type LocationNoteVote = typeof locationNoteVotes.$inferSelect;
export type NewLocationNoteVote = typeof locationNoteVotes.$inferInsert;

/**
 * Daily coin-flow rollup (Phase 5 Day 26). Upserted per turn that
 * emits coin-affecting events. The /god/economy page groups this by
 * date for the "today" panel and by source for the "top vendors"
 * panel.
 *
 * total_amount is signed: positive = coins flowed IN to the player
 * from this source (sale, gift); negative = coins flowed OUT (buy,
 * trainer fee).
 */
export const coinFlowDaily = pgTable(
  "coin_flow_daily",
  {
    date: date("date").notNull(),
    source: text("source").notNull(),
    totalAmount: bigint("total_amount", { mode: "number" })
      .notNull()
      .default(0),
    txnCount: integer("txn_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("coin_flow_daily_pk").on(t.date, t.source),
    index("coin_flow_daily_date_idx").on(t.date),
  ],
);

export type CoinFlowDaily = typeof coinFlowDaily.$inferSelect;
export type NewCoinFlowDaily = typeof coinFlowDaily.$inferInsert;

export const _sql = sql; // re-export for migration writers if needed
