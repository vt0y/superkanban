CREATE TABLE IF NOT EXISTS tarot_sessions (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  locale TEXT NOT NULL,
  deck_json TEXT NOT NULL,
  selected_json TEXT,
  cards_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'processing', 'completed', 'failed')),
  result_markdown TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tarot_sessions_uid_status ON tarot_sessions(uid, status);
CREATE INDEX IF NOT EXISTS tarot_sessions_expiry ON tarot_sessions(expires_at);
