-- Phase 5.5 Day 32-33: Asynchronous player notes pinned to locations.
--
-- Dark Souls-style: a player leaves a one-line note in a location;
-- other players passing through later see top-voted notes. Massive
-- emotional payoff for tiny code surface. Notes auto-expire after
-- 30d, can be flagged + auto-hidden after 3 distinct flags pending
-- admin review.

CREATE TABLE IF NOT EXISTS location_notes (
  id uuid PRIMARY KEY,
  location_id text NOT NULL,
  /** Optional form-specificity: a note targeted at e.g. only slimes. */
  form_id text,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  text text NOT NULL,
  votes integer NOT NULL DEFAULT 0,
  /** Soft-flag count. Auto-hide threshold = 3 distinct flaggers. */
  flag_count integer NOT NULL DEFAULT 0,
  flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

-- Hot query: top notes for a location, un-flagged. (expires_at >
-- now() can't live in the index predicate — Postgres requires
-- immutable functions there. The time filter happens at query time.)
CREATE INDEX IF NOT EXISTS location_notes_location_active_idx
  ON location_notes (location_id, votes DESC)
  WHERE NOT flagged;

CREATE INDEX IF NOT EXISTS location_notes_author_idx
  ON location_notes (author_user_id)
  WHERE author_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS location_note_votes (
  note_id uuid NOT NULL REFERENCES location_notes(id) ON DELETE CASCADE,
  voter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote_kind text NOT NULL DEFAULT 'up',
  voted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, voter_user_id)
);
