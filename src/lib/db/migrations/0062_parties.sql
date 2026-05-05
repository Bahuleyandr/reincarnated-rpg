-- Phase 9 T5.1 — multi-player co-play (minimal slice).
--
-- A party is 2-3 players agreeing to share a single session +
-- take turns in round-robin order. The host's session is the
-- canonical one (others read its events; the host accepts each
-- player's input in turn). Coordination logic (turn-lock,
-- input-routing) is OUT OF SCOPE for this migration — the
-- schema is the substrate that makes the rest authorable.

CREATE TABLE IF NOT EXISTS parties (
  id              UUID PRIMARY KEY,
  host_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The session this party shares.
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- Status: forming | active | ended.
  status          TEXT NOT NULL DEFAULT 'forming',
  -- Turn order is the join order; rotates round-robin.
  -- current_turn_user_id null while forming.
  current_turn_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Cap (2 for duo, 3 for triad). Enforced at join time.
  max_size        INTEGER NOT NULL DEFAULT 3,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at        TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS parties_host_idx ON parties (host_user_id);
CREATE INDEX IF NOT EXISTS parties_session_idx ON parties (session_id);
CREATE INDEX IF NOT EXISTS parties_status_idx ON parties (status);

CREATE TABLE IF NOT EXISTS party_members (
  party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Turn order index (0 = host = first). Determines round-robin.
  turn_order      INTEGER NOT NULL,
  joined_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  left_at         TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (party_id, user_id)
);

CREATE INDEX IF NOT EXISTS party_members_user_idx
  ON party_members (user_id) WHERE left_at IS NULL;
