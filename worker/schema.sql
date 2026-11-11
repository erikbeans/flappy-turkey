-- Flappy Turkey leaderboard schema (D1 / SQLite)

CREATE TABLE IF NOT EXISTS runs (
  run_id     TEXT PRIMARY KEY,          -- random UUID issued at run start
  started_at INTEGER NOT NULL,          -- server time (ms) the run started
  used       INTEGER NOT NULL DEFAULT 0 -- 1 once the score was submitted (single-use)
);

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL,            -- ties the score to a signed run
  name        TEXT NOT NULL,            -- sanitized player name (1-16 chars)
  score       INTEGER NOT NULL,         -- validated against run duration server-side
  duration_ms INTEGER NOT NULL,         -- client-reported run duration
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);

CREATE TABLE IF NOT EXISTS rate_log (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_log ON rate_log(ip, ts);
