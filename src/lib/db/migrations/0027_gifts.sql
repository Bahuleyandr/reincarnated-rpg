CREATE TABLE IF NOT EXISTS gifts (
  id uuid PRIMARY KEY,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'energy' | 'cleanse' (clears 1 bad_luck stack) | 'blessing' (small grant)
  kind text NOT NULL,
  payload jsonb NOT NULL,
  message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  CHECK (from_user_id <> to_user_id),
  CHECK (length(coalesce(message, '')) <= 280)
);

CREATE INDEX IF NOT EXISTS gifts_to_user_unredeemed_idx
  ON gifts (to_user_id, sent_at DESC)
  WHERE redeemed_at IS NULL;

CREATE INDEX IF NOT EXISTS gifts_from_user_idx
  ON gifts (from_user_id, sent_at DESC);
