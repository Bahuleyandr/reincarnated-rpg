-- Player-as-NPC retirement (Roadmap item 63).
--
-- When a player ascends (and in the future: permadies), their
-- character template is added to the recurring-NPC pool. Other
-- players' future runs may encounter them as faction-aligned
-- ambient NPCs whose persona is shaped by the retired player's
-- last lifetime metrics.
--
-- One row per retired player. The recurring NPC engine merges
-- this DB pool with the file-based catalog at lookup time.

CREATE TABLE IF NOT EXISTS retired_players (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Stable id for the engine; usually "retired:<username>".
  template_id       TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  reason            TEXT NOT NULL,           -- "ascension" | "permadeath"
  faction_id        TEXT,
  top_skill_id      TEXT,
  top_skill_level   INTEGER NOT NULL DEFAULT 0,
  -- Lifetime metrics from ascension_seed (or analogous on
  -- permadeath). Drives the persona prompt fragment.
  total_campaigns   INTEGER NOT NULL DEFAULT 0,
  distinct_forms    INTEGER NOT NULL DEFAULT 0,
  -- Free-text last words / inscription on retirement. Up to
  -- 280 chars; the recurring NPC engine surfaces this in the
  -- "history beat" when the retired player is encountered.
  last_words        TEXT,
  -- Tunable per-template appearance probability. Defaults
  -- match a "rare cameo" shape that won't crowd out
  -- file-authored recurring NPCs.
  base_low          REAL NOT NULL DEFAULT 0.02,
  base_high         REAL NOT NULL DEFAULT 0.05,
  wyrm_threshold    INTEGER NOT NULL DEFAULT 500,
  per_prior_bonus   REAL NOT NULL DEFAULT 0.01,
  max_appear        REAL NOT NULL DEFAULT 0.25,
  retired_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retired_players_faction_idx
  ON retired_players (faction_id);
CREATE INDEX IF NOT EXISTS retired_players_retired_at_idx
  ON retired_players (retired_at DESC);
