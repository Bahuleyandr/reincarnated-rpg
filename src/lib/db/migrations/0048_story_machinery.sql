-- Phase 7 Day 47-52: story machinery — votes, edicts, endings,
-- voice events. One migration covers all of these because they
-- share the same shape (small per-feature tables that the calendar
-- engine + branch resolver hook into).

-- Day 49: The Three Votes (Books XI-XII). Each vote runs over a
-- chapter window; players cast at most one ballot. The winning
-- option becomes a resolved fact in world state. Distinct from
-- branch_decisions: votes are explicit player ballots, branches
-- are aggregate metric resolutions.
CREATE TABLE IF NOT EXISTS world_votes (
  id integer PRIMARY KEY,
  chapter_id integer NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  closes_at timestamptz,
  winning_option text,
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS world_vote_ballots (
  vote_id integer NOT NULL REFERENCES world_votes(id) ON DELETE CASCADE,
  voter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id text NOT NULL,
  cast_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vote_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS world_vote_ballots_option_idx
  ON world_vote_ballots (vote_id, option_id);

-- Day 51: First-to-Sit Edicts. The Hollow Throne quest produces
-- a single first-mover; that user proposes an edict (a player
-- note promoted to law) which all subsequent narrators carry.
CREATE TABLE IF NOT EXISTS edicts (
  id uuid PRIMARY KEY,
  chapter_id integer NOT NULL,
  proposer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  text text NOT NULL,
  -- 'pending' | 'active' | 'expired' | 'redacted'
  status text NOT NULL DEFAULT 'active',
  active_from timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS edicts_status_idx
  ON edicts (status, active_from DESC);

-- Day 50: Endings. End-of-year resolver writes one row capturing
-- which ending fired + a Year 2 seed packet for the next year's
-- starter conditions.
CREATE TABLE IF NOT EXISTS year_endings (
  year integer PRIMARY KEY,
  ending_id text NOT NULL,
  ending_label text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  /** Snapshot of the metrics that drove the choice — faction
      totals, branch outcomes, wyrm hp, vote results. */
  resolution_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Year-2 seed packet — handed to the next year's bootstrap
      so the previous year's outcome influences starter content. */
  next_year_seed jsonb NOT NULL DEFAULT '{}'::jsonb
);
