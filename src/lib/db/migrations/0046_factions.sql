-- Phase 7 Day 42-43: faction state.
--
-- Four factions seed the year:
--   choristers — the singers in the salt cathedral
--   rust_hand  — the Wyrm's iron-handed servants
--   idle       — those who do nothing on purpose, the third path
--   forsaken   — the discarded; ACTIVE=false until Branch IV unlocks them
--
-- Players pledge one (50 coins, one-shot). Faction-aligned skill
-- crafts get +10% XP. Cumulative contribution drives branch
-- outcomes — see Day 44.

CREATE TABLE IF NOT EXISTS factions (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text,
  member_count integer NOT NULL DEFAULT 0,
  cumulative_contribution integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO factions (id, label, description, active) VALUES
  ('choristers', 'The Choristers', 'singers, keepers of the long song; lean lunar, lean alchemy', true),
  ('rust_hand', 'The Rust Hand', 'iron, hammer, debt; loyal to the Wyrm', true),
  ('idle', 'The Idle', 'doing nothing as a discipline; the third refusal', true),
  ('forsaken', 'The Forsaken', 'the discarded; surfaces only when Branch IV breaks open', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS faction_id text REFERENCES factions(id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS faction_pledged_at timestamptz;

CREATE TABLE IF NOT EXISTS faction_contributions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  faction_id text NOT NULL REFERENCES factions(id),
  chapter_id integer NOT NULL,
  amount integer NOT NULL,
  source text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS faction_contrib_chapter_idx
  ON faction_contributions (chapter_id, faction_id);
CREATE INDEX IF NOT EXISTS faction_contrib_user_idx
  ON faction_contributions (user_id);
