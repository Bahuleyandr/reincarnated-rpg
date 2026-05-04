CREATE TABLE IF NOT EXISTS achievements_unlocked (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid REFERENCES campaigns(id),
  -- Postgres event log uses uuid ids; we record the matching event
  -- ids here for audit / replay.
  evidence_event_ids uuid[],
  UNIQUE (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS achievements_user_idx
  ON achievements_unlocked (user_id);

CREATE INDEX IF NOT EXISTS achievements_unlocked_at_idx
  ON achievements_unlocked (unlocked_at DESC);
