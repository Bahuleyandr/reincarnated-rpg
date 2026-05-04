-- Phase 7 Day 59-62: lapsed flows + year archive.
--
-- A small audit log of "we sent them a re-engagement email" so we
-- don't spam. Email infrastructure is wired in Phase 8 Day 68;
-- this table holds the bookkeeping in advance.

CREATE TABLE IF NOT EXISTS reengagement_log (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /** 'lapsed_7d' | 'lapsed_30d' | 'returning_welcome' | 'year_end' */
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, kind)
);

CREATE INDEX IF NOT EXISTS reengagement_log_user_idx
  ON reengagement_log (user_id);
CREATE INDEX IF NOT EXISTS reengagement_log_sent_idx
  ON reengagement_log (sent_at DESC);
