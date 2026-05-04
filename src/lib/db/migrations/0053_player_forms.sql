-- Player-authored forms (post-Phase-8 follow-up).
--
-- Logged-in players can submit a form spec (name + theme + 3-5
-- starter verbs + a paragraph of negative vocab). It enters the
-- `pending_review` queue; admins approve or reject from /god/forms.
-- Approved forms get an `approved_form_id` slug allocated; the
-- approval job copies the spec into content/forms/<id>.json.

CREATE TABLE IF NOT EXISTS player_forms (
  id uuid PRIMARY KEY,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  /** Slug allocated only on approval. Null while pending. */
  approved_form_id text UNIQUE,
  name text NOT NULL,
  theme text NOT NULL,
  /** Spec the player submitted: vitals, stats, verbs[], negative
      vocab, sample corpus. JSON shape mirrors the form template
      schema so on approval the file write is straightforward. */
  spec jsonb NOT NULL,
  /** 'pending_review' | 'approved' | 'rejected' */
  status text NOT NULL DEFAULT 'pending_review',
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewer_notes text,
  reviewed_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_forms_status_idx
  ON player_forms (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS player_forms_author_idx
  ON player_forms (author_user_id);
