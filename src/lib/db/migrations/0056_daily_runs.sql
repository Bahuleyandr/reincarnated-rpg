-- Daily shared-seed loop (Phase 9 growth bet).
--
-- Wordle-style: every player on a given UTC date plays the same
-- (form, location, seed). Run outcome (status + turn_count) gets
-- ranked into a daily leaderboard. One attempt per user per day.
--
-- The daily_runs row is the source of truth for "user X played
-- date D"; the actual session lives in `sessions` with the
-- challenge's deterministic seed pinned at creation time.

CREATE TABLE IF NOT EXISTS daily_runs (
  utc_date     TEXT NOT NULL,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  form_id      TEXT NOT NULL,
  location_id  TEXT NOT NULL,
  seed         BIGINT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  turn_count   INTEGER NOT NULL DEFAULT 0,
  score        INTEGER NOT NULL DEFAULT 0,
  ended_at     TIMESTAMP WITH TIME ZONE,
  started_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (utc_date, user_id)
);

-- Leaderboard query: WHERE utc_date = $1 ORDER BY score DESC.
CREATE INDEX IF NOT EXISTS daily_runs_leaderboard_idx
  ON daily_runs (utc_date, score DESC);

-- Per-user lookup (history of past dailies).
CREATE INDEX IF NOT EXISTS daily_runs_user_idx
  ON daily_runs (user_id, utc_date DESC);
