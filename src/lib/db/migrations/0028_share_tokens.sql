ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS share_token text,
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_share_token_unique
  ON campaigns (share_token)
  WHERE share_token IS NOT NULL;
