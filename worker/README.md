# Leaderboard API — Cloudflare Worker + D1

Serverless backend for the Flappy Turkey global leaderboard (top 100 scores).
The static game is hosted on GitHub Pages and calls this API from the browser.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness check → `{ ok: true }` |
| POST | `/api/run/start` | Start a run → `{ ok, runId, startedAt, token }` |
| POST | `/api/score` | Submit a score → `{ ok, rank, entry }` (validated) |
| GET | `/api/leaderboard?limit=N` | Top scores (N ≤ 100, default 10) → `{ ok, scores: [...] }` |

## Server-side validation

A plain client-side game can't prove a score, but we make casual forgery hard:

- `POST /api/run/start` issues a `runId` and an HMAC-SHA256 `token` over `runId|startedAt`,
  and records the start time server-side in D1.
- `POST /api/score` requires that token; runs are **single-use** and the `startedAt`
  must match the server record.
- The score is capped by **elapsed time**: the game can score at most ~0.91 pts/s
  (268 px/s max speed ÷ 295 px obstacle spacing), so the server allows at most
  1.5 pts/s + 5 points of slack. A "9999 in 3 seconds" submission is rejected with 422.
- Absolute score cap (`MAX_SCORE` var), name sanitation (1–16 chars, control chars stripped),
  body size limit, per-IP rate limiting (6 writes/min), and CORS restricted to
  `ALLOWED_ORIGINS` (the GitHub Pages origin + localhost for dev).

## Deploy

```bash
cd worker

# 1. Create the D1 database (prints the database_id — paste it into wrangler.toml)
npx wrangler d1 create flappy-turkey-scores

# 2. Apply the schema
npx wrangler d1 execute flappy-turkey-scores --remote --file=schema.sql

# 3. Set the HMAC secret (any long random string)
echo "$(openssl rand -hex 32)" | npx wrangler secret put SCORE_SECRET

# 4. Deploy — the printed URL goes into ../config.js as apiBase
npx wrangler deploy
```

## Local development

```bash
cd worker
echo 'SCORE_SECRET=dev-secret-change-me' > .dev.vars   # gitignored
npx wrangler d1 execute flappy-turkey-scores --local --file=schema.sql
npx wrangler dev   # serves on http://127.0.0.1:8787
```

Then point `config.js` at `http://127.0.0.1:8787` and run the game with
`python3 -m http.server 8000` from the repo root.

## Test with curl

```bash
BASE=https://flappy-turkey-leaderboard.erikbeans.workers.dev
ORIGIN=https://erikbeans.github.io

# start a run
RUN=$(curl -s -X POST "$BASE/api/run/start" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{}')
echo "$RUN"

# submit a plausible score (wait a few seconds so duration allows it)
RUN_ID=$(echo "$RUN" | jq -r .runId); STARTED=$(echo "$RUN" | jq -r .startedAt); TOKEN=$(echo "$RUN" | jq -r .token)
sleep 8
curl -s -X POST "$BASE/api/score" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{
  \"runId\": \"$RUN_ID\", \"startedAt\": $STARTED, \"token\": \"$TOKEN\",
  \"name\": \"Tester\", \"score\": 5, \"durationMs\": 8000 }"

# read the board
curl -s "$BASE/api/leaderboard?limit=100" -H "Origin: $ORIGIN" | jq .
```
