-- Phase 9 letters / async mail (T3.3).
--
-- Persistent in-game mail. Players can send letters to other
-- players (or to recurring NPCs by template id). Letters are
-- delivered asynchronously — the recipient sees them next time
-- they open /letters or the inbox count surfaces in the home banner.
--
-- Letters are immutable once sent (append-only model — like
-- events). Status transitions live in a separate `letter_states`
-- table to preserve the audit trail.

CREATE TABLE IF NOT EXISTS letters (
  id              UUID PRIMARY KEY,
  from_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Either to_user_id OR to_npc_template_id; never both.
  to_user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  to_npc_template_id TEXT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  -- Optional reply target; nullable for fresh threads.
  reply_to_id     UUID REFERENCES letters(id) ON DELETE SET NULL,
  -- Delivery status: pending | delivered | read | refused.
  -- "refused" is the orcish-style return: the recipient looked at
  -- the letter and sent it back unread.
  status          TEXT NOT NULL DEFAULT 'pending',
  sent_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at         TIMESTAMP WITH TIME ZONE,
  -- The race + voice-mode the sender used (orc-style marginalia
  -- vs human-style direct vs elven-act). Influences how the
  -- letter renders in the inbox.
  voice_mode      TEXT NOT NULL DEFAULT 'spoken',
  CHECK (
    (to_user_id IS NOT NULL AND to_npc_template_id IS NULL) OR
    (to_user_id IS NULL AND to_npc_template_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS letters_to_user_idx
  ON letters (to_user_id, sent_at DESC) WHERE to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS letters_from_user_idx
  ON letters (from_user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS letters_unread_idx
  ON letters (to_user_id, status) WHERE status = 'delivered';
