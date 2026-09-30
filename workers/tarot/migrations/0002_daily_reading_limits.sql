CREATE TABLE IF NOT EXISTS tarot_daily_usage (
  session_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  day_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tarot_daily_usage_uid_day ON tarot_daily_usage(uid, day_key);
CREATE INDEX IF NOT EXISTS tarot_daily_usage_created_at ON tarot_daily_usage(created_at);
