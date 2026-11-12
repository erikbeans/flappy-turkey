-- Flappy Turkey leaderboard schema (D1 / SQLite)

CREATE TABLE IF NOT EXISTS runs (
  run_id     TEXT PRIMARY KEY,          -- random UUID issued at run start
  started_at INTEGER NOT NULL,          -- server time (ms) the run started
  used       INTEGER NOT NULL DEFAULT 0, -- 1 once the score was submitted (single-use)
  mode       TEXT NOT NULL DEFAULT 'calvin' -- game mode chosen at run start; score must match
);

CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL,            -- ties the score to a signed run
  name        TEXT NOT NULL,            -- sanitized player name (1-16 chars)
  score       INTEGER NOT NULL,         -- validated against run duration server-side
  duration_ms INTEGER NOT NULL,         -- client-reported run duration
  mode        TEXT NOT NULL DEFAULT 'calvin', -- game mode: separate leaderboard per mode
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_mode_score ON scores(mode, score DESC);

CREATE TABLE IF NOT EXISTS rate_log (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_log ON rate_log(ip, ts);

-- One row per play event (run start / stats report), keyed by client IP.
-- Only used to count DISTINCT players active in the last hour; never shown per-player.
CREATE TABLE IF NOT EXISTS activity (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);

-- Cumulative all-player stats, reported by the game after each run.
CREATE TABLE IF NOT EXISTS totals (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  flaps INTEGER NOT NULL DEFAULT 0,  -- all-time flaps by all players
  gates INTEGER NOT NULL DEFAULT 0   -- all-time gates cleared by all players
);

CREATE TABLE IF NOT EXISTS daily (
  date  TEXT PRIMARY KEY,            -- Pacific calendar date 'YYYY-MM-DD'
  flaps INTEGER NOT NULL DEFAULT 0,  -- flaps since 00:00 Pacific
  gates INTEGER NOT NULL DEFAULT 0   -- gates since 00:00 Pacific
);

CREATE TABLE IF NOT EXISTS stat_runs (
  run_id      TEXT PRIMARY KEY,       -- single-use: one stats report per signed run
  flaps       INTEGER NOT NULL,
  gates       INTEGER NOT NULL,
  reported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
