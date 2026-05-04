-- Phase 7 Day 38: world calendar + per-user AI cost ceilings.
--
-- Single-row world_calendar tracks the live chapter (1..48 within a
-- year, plus Book 1..12 + chapter-in-book 1..4). Roll-over is
-- driven by a cron-able advance job: every hour, check whether
-- chapter_started_at is >= 7 days ago.
--
-- Per-user cost ceilings: a single weird user can't burn $50/day
-- in narration. Caps live in lib/ai/cost-gate.ts; daily reset
-- happens lazily on the first call after UTC midnight.

CREATE TABLE IF NOT EXISTS world_calendar (
  id integer PRIMARY KEY DEFAULT 1,
  current_book integer NOT NULL DEFAULT 1,
  current_chapter integer NOT NULL DEFAULT 1,
  chapter_started_at timestamptz NOT NULL DEFAULT now(),
  year integer NOT NULL DEFAULT 1,
  CHECK (id = 1)
);

INSERT INTO world_calendar DEFAULT VALUES
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_ai_cost_usd_today numeric(10,6) NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_ai_cost_reset_at timestamptz NOT NULL DEFAULT now();

-- Append-only ledger of meaningful world-level events (chapter
-- advances, branch resolutions, voice firings). Distinct from
-- session-scoped events. Read by the homepage "today in the world"
-- ticker + the year archive.
CREATE TABLE IF NOT EXISTS world_events (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_events_created_idx
  ON world_events (created_at DESC);
CREATE INDEX IF NOT EXISTS world_events_kind_idx
  ON world_events (kind, created_at DESC);
