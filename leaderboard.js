/* Flappy Turkey — global leaderboard client + UI (top 100).
 *
 * Talks to the Cloudflare Worker API in ./worker (see window.FLAPPY_CONFIG.apiBase).
 * If the API is not configured or unreachable, falls back to a per-device
 * leaderboard stored in localStorage so the game still works offline.
 */
(() => {
  'use strict';

  const cfg = window.FLAPPY_CONFIG || {};
  const apiBase = String(cfg.apiBase || '').replace(/\/+$/, '');
  const online = /^https?:\/\//.test(apiBase) && !apiBase.includes('REPLACE_ME');
  const NAME_KEY = 'flappyTurkeyName';
  const LOCAL_KEY = 'flappyTurkeyLocalBoard';
  const STATS_KEY = 'flappyTurkeyStats';
  const MODE_KEY = 'flappyTurkeyMode'; // last picked mode (shared with game.js's picker)
  const TOP_N = 100; // the board keeps the top 100

  // Game modes — both are live; the board has a tab per mode.
  const MODES = ['calvin', 'sonya'];
  function normMode(m) { return MODES.includes(m) ? m : 'calvin'; }
  const MODE_LABEL = { calvin: 'Calvin 🦃', sonya: 'Sonya 🌈' };
  let boardMode = normMode(safeGet(MODE_KEY));
  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }

  // ---------- API ----------
  let run = null; // { runId, startedAt, token, t0, mode }
  let lastRunMode = null; // mode of the last started run — submissions follow THIS, never the visible tab

  async function api(path, opts = {}) {
    const res = await fetch(apiBase + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body;
  }

  async function startRun(mode) {
    const m = normMode(mode);
    lastRunMode = m;
    setBoardMode(m, false); // the board follows the mode being played
    if (!online) { run = null; return null; }
    try {
      const j = await api('/api/run/start', { method: 'POST', body: JSON.stringify({ mode: m }) });
      run = { runId: j.runId, startedAt: j.startedAt, token: j.token, t0: performance.now(), mode: m };
      return run;
    } catch (e) {
      run = null;
      return null;
    }
  }

  async function submitScore(name, score) {
    if (!online) return { online: false, ...localSubmit(name, score, lastRunMode || boardMode) };
    if (!run) throw new Error('no active run — start playing first');
    const durationMs = Math.max(0, Math.round(performance.now() - run.t0));
    const payload = {
      runId: run.runId, startedAt: run.startedAt, token: run.token,
      name, score, durationMs, mode: run.mode,
    };
    run = null; // run tokens are single-use
    const j = await api('/api/score', { method: 'POST', body: JSON.stringify(payload) });
    return { online: true, ...j };
  }

  async function top(limit = TOP_N, mode = boardMode) {
    const m = normMode(mode);
    if (!online) return { online: false, scores: localTop(limit, m) };
    try {
      const j = await api('/api/leaderboard?limit=' + Math.min(limit, TOP_N) + '&mode=' + m);
      return { online: true, scores: j.scores, players1h: j.players1h, mode: m };
    } catch (e) {
      return { online: false, scores: localTop(limit, m), error: e.message };
    }
  }

  // Called by the game after EVERY run (game over), whether or not a score is submitted.
  // Best-effort: never throws into the game loop.
  async function reportStats(flaps, gates) {
    if (!online) { localAddStats(flaps, gates); return { online: false }; }
    if (!run) return null;
    const durationMs = Math.max(0, Math.round(performance.now() - run.t0));
    try {
      // note: the run token stays valid for a later score submission — stats are tracked separately
      await api('/api/stats', {
        method: 'POST',
        body: JSON.stringify({
          runId: run.runId, startedAt: run.startedAt, token: run.token,
          flaps, gates, durationMs,
        }),
      });
      return { online: true };
    } catch (e) {
      return null; // best-effort only
    }
  }

  async function fetchStats() {
    if (!online) return { online: false, ...localStats() };
    try {
      const j = await api('/api/stats');
      return { online: true, ...j };
    } catch (e) {
      return { online: false, ...localStats(), error: e.message };
    }
  }

  // ---------- local fallback (per-device board, separate per mode) ----------
  function localKey(mode) { return LOCAL_KEY + '.' + normMode(mode); }

  function localLoad(mode) {
    try { return JSON.parse(localStorage.getItem(localKey(mode)) || '[]'); } catch { return []; }
  }

  function localTop(limit, mode) {
    return localLoad(mode)
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .slice(0, limit)
      .map((e) => ({ id: e.at, name: e.name, score: e.score, createdAt: new Date(e.at).toISOString() }));
  }

  function localSubmit(name, score, mode) {
    const at = Date.now();
    const arr = localLoad(mode);
    arr.push({ name, score, at });
    arr.sort((a, b) => b.score - a.score || a.at - b.at);
    localStorage.setItem(localKey(mode), JSON.stringify(arr.slice(0, TOP_N)));
    return {
      rank: arr.findIndex((e) => e.at === at) + 1,
      entry: { id: at, name, score, createdAt: new Date(at).toISOString() },
    };
  }

  // ---------- local stats fallback (per-device, Pacific day) ----------
  function localPacificDate() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  function localStats() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); } catch { s = {}; }
    const day = localPacificDate();
    const sameDay = s.day === day;
    return {
      total: { flaps: s.flaps || 0, gates: s.gates || 0 },
      today: { date: day, flaps: sameDay ? (s.dayFlaps || 0) : 0, gates: sameDay ? (s.dayGates || 0) : 0 },
    };
  }

  function localAddStats(flaps, gates) {
    const cur = localStats();
    const day = cur.today.date;
    localStorage.setItem(STATS_KEY, JSON.stringify({
      flaps: cur.total.flaps + flaps,
      gates: cur.total.gates + gates,
      day,
      dayFlaps: cur.today.flaps + flaps,
      dayGates: cur.today.gates + gates,
    }));
  }

  // ---------- UI ----------
  const $ = (id) => document.getElementById(id);
  let els = null;
  let pendingScore = 0;
  let highlightId = null;

  function initUI() {
    els = {
      btn: $('board-btn'),
      board: $('board'),
      tabs: Array.from(document.querySelectorAll('#board-tabs button')),
      tabSonya: $('tab-sonya'),
      list: $('board-list'),
      status: $('board-status'),
      form: $('board-form'),
      name: $('board-name'),
      submit: $('board-submit'),
      msg: $('board-msg'),
      close: $('board-close'),
      again: $('board-again'),
      scoreLine: $('board-score'),
      stats: $('board-stats'),
    };
    // Taps on the overlay must never flap the turkey — the game listens on window.
    for (const el of [els.btn, els.board]) {
      for (const ev of ['pointerdown', 'mousedown', 'touchstart']) {
        el.addEventListener(ev, (e) => e.stopPropagation());
      }
    }
    for (const b of els.tabs) {
      b.addEventListener('click', () => setBoardMode(b.dataset.mode));
    }
    syncTabs();
    els.name.value = localStorage.getItem(NAME_KEY) || '';
    els.btn.addEventListener('click', () => (els.board.classList.contains('hidden') ? show(0) : hide()));
    els.close.addEventListener('click', hide);
    els.again.addEventListener('click', () => {
      hide();
      if (window.__flappy && window.__flappy.restart) window.__flappy.restart();
    });
    els.form.addEventListener('submit', onSubmit);
    refresh();
  }

  function show(score) {
    if (!els) return; // UI not initialized yet
    pendingScore = score;
    els.scoreLine.textContent = score > 0 ? `Your score: ${score}` : '';
    els.form.style.display = score > 0 ? '' : 'none';
    // the board follows the mode of the run that just ended (if any)
    if (run && run.mode) setBoardMode(run.mode, false);
    els.board.classList.remove('hidden');
    refresh();
  }

  function hide() {
    if (!els) return; // UI not initialized yet
    els.board.classList.add('hidden');
  }

  function setMsg(text, isErr) {
    els.msg.textContent = text || '';
    els.msg.classList.toggle('err', !!isErr);
  }

  function syncTabs() {
    if (!els) return;
    for (const b of els.tabs) b.classList.toggle('active', b.dataset.mode === boardMode);
  }

  // Switch which mode's board the panel shows (called by the mode picker too).
  function setBoardMode(m, refreshBoard = true) {
    boardMode = normMode(m);
    syncTabs();
    if (refreshBoard) refresh();
  }

  async function refresh() {
    if (!els) return;
    els.status.textContent = 'Loading leaderboard…';
    const res = await top(TOP_N, boardMode);
    renderList(res.scores);
    els.status.textContent = res.online
      ? `Top ${Math.min(res.scores.length, TOP_N)} of the ${MODE_LABEL[boardMode] || 'global'} board · ` +
        `${fmt(res.players1h)} player${res.players1h === 1 ? '' : 's'} in the last hour`
      : (res.error
          ? `Online board unavailable (${res.error}) — showing local scores`
          : 'Offline mode — showing local scores');
    renderStats(await fetchStats());
  }

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  // Cumulative all-player stats, shown discretely at the bottom of the panel.
  // Line 1 = all-time totals, line 2 = today since midnight Pacific time.
  function renderStats(st) {
    if (!st) return;
    const scope = st.online ? 'All players' : 'This device';
    els.stats.textContent =
      `${scope}, all time: ${fmt(st.total.flaps)} flaps · ${fmt(st.total.gates)} gates cleared\n` +
      `Today (Pacific): ${fmt(st.today.flaps)} flaps · ${fmt(st.today.gates)} gates`;
  }

  const medals = ['🥇', '🥈', '🥉'];

  function renderList(scores) {
    els.list.textContent = '';
    if (!scores.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No scores yet — be the first! 🦃';
      els.list.appendChild(li);
      return;
    }
    scores.forEach((s, i) => {
      const li = document.createElement('li');
      if (s.id === highlightId) li.classList.add('you');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = medals[i] || `#${i + 1}`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.name;
      const sc = document.createElement('span');
      sc.className = 'score';
      sc.textContent = String(s.score);
      li.append(rank, name, sc);
      els.list.appendChild(li);
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const name = els.name.value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 16);
    if (!name) { setMsg('Enter a name first.', true); return; }
    if (!(pendingScore > 0)) { setMsg('Play a round first — nothing to submit yet.', true); return; }
    localStorage.setItem(NAME_KEY, name);
    els.submit.disabled = true;
    setMsg('Submitting…');
    try {
      const res = await submitScore(name, pendingScore);
      highlightId = res.entry ? res.entry.id : null;
      // show the board the score actually landed on (the run's mode, not the tab you were browsing)
      setBoardMode((res.entry && res.entry.mode) || lastRunMode || boardMode, false);
      setMsg(res.online
        ? `🦃 Submitted! You're #${res.rank} on the global board.`
        : `Saved locally — you're #${res.rank} on this device's board.`);
      pendingScore = 0;
      els.form.style.display = 'none';
      await refresh();
    } catch (err) {
      setMsg('Could not submit: ' + err.message, true);
    } finally {
      els.submit.disabled = false;
    }
  }

  // The overlay markup sits above the <script> tags, so init immediately when
  // possible (game.js calls ui.hide() during its initial reset()).
  if (document.getElementById('board')) initUI();
  else document.addEventListener('DOMContentLoaded', initUI);

  window.FLAPPY = {
    api: { startRun, submitScore, top, reportStats, fetchStats },
    ui: { show, hide, refresh, setMode: setBoardMode },
    get online() { return online; },
    get devMode() { return true; }, // all modes unlocked (Sonya Mode is live)
    get mode() { return boardMode; },
  };
})();
