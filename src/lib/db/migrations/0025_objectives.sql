CREATE TABLE IF NOT EXISTS objective_progress (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id text NOT NULL,
  -- 'YYYY-MM-DD' for daily, 'YYYY-Www' (ISO week) for weekly.
  period_key text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  target integer NOT NULL,
  completed_at timestamptz,
  reward_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, objective_id, period_key)
);

CREATE INDEX IF NOT EXISTS obj_user_period_idx
  ON objective_progress (user_id, period_key);

CREATE INDEX IF NOT EXISTS obj_unclaimed_idx
  ON objective_progress (user_id)
  WHERE completed_at IS NOT NULL AND reward_claimed_at IS NULL;
