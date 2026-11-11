/* Flappy Turkey — global leaderboard API.
 * Cloudflare Worker + D1 (SQLite). Deploy from this directory (see README.md).
 *
 * Endpoints:
 *   GET  /api/health              -> { ok: true }
 *   POST /api/run/start           -> { ok, runId, startedAt, token }  token = HMAC-SHA256(runId|startedAt)
 *   POST /api/score               -> { ok, rank, entry }              validated score submission
 *   GET  /api/leaderboard?limit=N -> { ok, scores: [{ id, name, score, createdAt }] }  (N up to 100 — top 100)
 *
 * Server-side validation:
 *  - every score must carry a run token signed by the server when the run started
 *  - tokens are single-use and bound to the server-recorded start timestamp
 *  - score is capped by elapsed time (game physics allow at most ~0.91 pts/s;
 *    we allow 1.5 pts/s + slack to stay well clear of false rejections)
 *  - absolute score cap + name sanitation (1-16 chars, no control characters)
 *  - per-IP rate limiting on the write endpoints
 *  - CORS restricted to the configured origins (the GitHub Pages site + localhost)
 *
 * Honesty note: a client-side game can always be cheated by someone willing to
 * read/modify the JS. This stops casual forgery (arbitrary scores, cross-site bots).
 */

const PTS_PER_SEC_ALLOWANCE = 1.5; // game max is ~0.91 pts/s (268 px/s over 295 px spacing)
const SCORE_SLACK = 5;             // tolerance for timing edge cases
const MAX_DURATION_MS = 12 * 3600 * 1000;
const MAX_NAME_LEN = 16;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6; // write requests per IP per window

const te = new TextEncoder();

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

async function rateLimited(env, ip) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM rate_log WHERE ts < ?').bind(now - RATE_WINDOW_MS).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM rate_log WHERE ip = ?').bind(ip).first();
  if ((row && row.c) >= RATE_LIMIT) return true;
  await env.DB.prepare('INSERT INTO rate_log (ip, ts) VALUES (?, ?)').bind(ip, now).run();
  return false;
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > 4096) throw Object.assign(new Error('body too large'), { status: 413 });
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function startRun(env, request) {
  const ip = clientIp(request);
  if (await rateLimited(env, ip)) throw httpError(429, 'rate limited — slow down');
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  await env.DB.prepare('INSERT INTO runs (run_id, started_at) VALUES (?, ?)').bind(runId, startedAt).run();
  const token = await hmacHex(env.SCORE_SECRET, `${runId}|${startedAt}`);
  return { ok: true, runId, startedAt, token };
}

function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  const n = name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return n.length >= 1 && n.length <= MAX_NAME_LEN ? n : null;
}

async function submitScore(env, request) {
  const ip = clientIp(request);
  if (await rateLimited(env, ip)) throw httpError(429, 'rate limited — slow down');
  const body = await readJson(request);
  const { runId, startedAt, token, name, score, durationMs } = body;

  if (typeof runId !== 'string' || typeof startedAt !== 'number' || typeof token !== 'string') {
    throw httpError(400, 'missing run credentials');
  }
  const maxScore = Number(env.MAX_SCORE || 1000);
  if (!Number.isInteger(score) || score < 0 || score > maxScore) {
    throw httpError(400, `invalid score (0-${maxScore})`);
  }
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_DURATION_MS) {
    throw httpError(400, 'invalid duration');
  }
  const cleanName = sanitizeName(name);
  if (!cleanName) throw httpError(400, `name must be 1-${MAX_NAME_LEN} characters`);

  const run = await env.DB.prepare('SELECT started_at, used FROM runs WHERE run_id = ?').bind(runId).first();
  if (!run) throw httpError(400, 'unknown run');
  if (run.used) throw httpError(409, 'this run was already submitted');
  if (run.started_at !== startedAt) throw httpError(400, 'run start mismatch');
  const expected = await hmacHex(env.SCORE_SECRET, `${runId}|${startedAt}`);
  if (token !== expected) throw httpError(403, 'bad run token');

  // Plausibility check: the game can score at most ~0.91 points/second
  // (268 px/s max speed over 295 px obstacle spacing), so a score submitted
  // shortly after the signed run start is impossible.
  const elapsedMs = Date.now() - run.started_at;
  const maxAllowed = Math.floor((elapsedMs / 1000) * PTS_PER_SEC_ALLOWANCE) + SCORE_SLACK;
  if (score > maxAllowed) {
    throw httpError(422, `score ${score} impossible in ${Math.round(elapsedMs / 1000)}s (max ${maxAllowed})`);
  }

  await env.DB.prepare('UPDATE runs SET used = 1 WHERE run_id = ?').bind(runId).run();
  const ins = await env.DB.prepare(
    'INSERT INTO scores (run_id, name, score, duration_ms) VALUES (?, ?, ?, ?) RETURNING id, created_at'
  ).bind(runId, cleanName, score, Math.round(durationMs)).run();
  const entry = ins.results[0];
  const rankRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM scores WHERE score > ?').bind(score).first();
  return {
    ok: true,
    rank: (rankRow ? rankRow.c : 0) + 1,
    entry: { id: entry.id, name: cleanName, score, createdAt: entry.created_at },
  };
}

const MAX_LEADERBOARD_LIMIT = 100; // the board keeps the top 100

async function leaderboard(url, env) {
  let limit = parseInt(url.searchParams.get('limit') || '10', 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 10;
  limit = Math.min(limit, MAX_LEADERBOARD_LIMIT);
  const { results } = await env.DB.prepare(
    'SELECT id, name, score, created_at AS createdAt FROM scores ORDER BY score DESC, created_at ASC, id ASC LIMIT ?'
  ).bind(limit).all();
  return { ok: true, scores: results };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true });
      if (url.pathname === '/api/run/start' && request.method === 'POST') return json(await startRun(env, request), 201);
      if (url.pathname === '/api/score' && request.method === 'POST') return json(await submitScore(env, request));
      if (url.pathname === '/api/leaderboard' && request.method === 'GET') return json(await leaderboard(url, env));
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      const status = e.status || 500;
      return json({ ok: false, error: status === 500 ? 'server error' : e.message }, status);
    }
  },
};
