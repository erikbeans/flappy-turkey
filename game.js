/* Flappy Turkey — a Thanksgiving-themed Flappy Bird.
   Tap anywhere to flap. Dodge ovens, deep fryers, pitchforks, and live wires.
   Get hit and the turkey gets roasted, bounces around, and lands on the floor. */
(() => {
  'use strict';

  // ---------- Canvas setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = 432, H = 768; // internal logical resolution (portrait)
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // ---------- Tuning constants ----------
  const GRAVITY = 1900;        // px/s^2, constant downward acceleration
  const FLAP_VY = -560;        // px/s, instant upward impulse on tap
  const MAX_FALL = 950;        // px/s, terminal velocity
  const BIRD_X = 120;          // turkey's fixed horizontal position
  // Collision outline: local-space circles INSCRIBED in the drawn turkey's
  // shapes (never larger than the sprite). Rotated with the bird and each
  // tested against the obstacles, so the hitbox stays within what you see.
  const BIRD_HIT = [
    // circles COVER the drawn shapes (fill + stroke), so any visual overlap is a hit
    { x: 0,    y: 0,   r: 18 },    // body (fill ellipse ry 17 + 1.5 stroke)
    { x: 12,   y: 0,   r: 12.5 },
    { x: -12,  y: 0,   r: 12.5 },
    { x: 15,   y: -13, r: 12.8 },  // head (fill r 11.5 + stroke)
    { x: 22.5, y: -18, r: 5 },     // snood
    { x: 24.5, y: -5,  r: 5.5 },   // wattle
    { x: 26,   y: -12, r: 4.5 },   // beak (two circles hug the triangle, tip included)
    { x: 31,   y: -11.8, r: 3.5 },
    { x: 14,   y: -27, r: 4 },     // head tuft
    { x: -18,  y: 1,   r: 8 },     // tail fan base
    { x: -26,  y: 0,   r: 5 },     // tail fan tips
  ];
  // Obstacle types — each has its own sprite width and a hitbox width.
  // Rule: the hitbox never extends beyond the animated sprite.
  const OBSTACLES = {
    oven:      { w: 108, hitW: 108 }, // solid steel body — hitbox == sprite
    fryer:     { w: 96,  hitW: 96  }, // solid vat (oil/handle overhang the gap, that's forgiving)
    pitchfork: { w: 80,  hitW: 22  }, // narrow handle; full-width trident head added in pipeHitRects
    wires:     { w: 64,  hitW: 36  }, // only the cable + sparking fringe, not the whole column
  };
  const FORK_HANDLE_W = 22;  // must match the handle drawn in drawPitchfork
  const FORK_HEAD_D = 40;    // depth of the trident head at the gap edge
  const MAX_GAP_JUMP = 200;    // max vertical move between consecutive gaps (guarantees a path)
  const BASE_GAP = 180;        // starting gap between obstacles (easier start: 65.5px clearance/side)
  const MIN_GAP = 138;         // smallest gap (max hardness) — 44.5px clearance/side around the 49px-tall turkey
  const GAP_SHRINK = 0.7;      // px of gap lost per point (slow ramp: floor hit at score 60)
  const BASE_SPEED = 170;      // px/s horizontal scroll speed (easier start, more flapping time)
  const SPEED_RAMP = 1.67;     // px/s gained per point (slow ramp: cap hit at score 60)
  const MAX_SPEED_BONUS = 100; // -> top speed 270 px/s
  const PIPE_SPACING = 320;    // horizontal distance between obstacles (reaction time 1.88s -> 1.19s)
  const GROUND_H = 92;
  const ELEC_SHRINK = 24;      // electric aura eats only this much of the safe gap
  const ROAST_BOUNCES = 2;     // floor bounces after the turkey is roasted

  // ---------- Game modes ----------
  // Calvin Mode = the original game. Sonya Mode = much easier + friendlier:
  // one fixed easy difficulty for the whole game, the turkey can walk/run on
  // the ground (landing is safe), and obstacle spacing is uneven (runs of 1-3
  // missing obstacles give frequent chances to land). Scenes still follow the
  // same score-based pattern as Calvin Mode.
  // Sonya Mode is UNPUBLISHED during development: the picker is gated behind
  // localStorage.flappyDev === '1' (see devUnlocked). LAUNCH: remove the gate.
  const SONYA_OBSTACLES = {
    bush:      { w: 100, hitW: 100 }, // leafy bush filling the column — hitbox == sprite (+ leaf lip)
    fence:     { w: 44,  hitW: 44  }, // one wooden fence post — only the post is solid
    flowers:   { w: 92,  hitW: 92  }, // bush with flowers on the face — hitbox == sprite (+ lip)
    chocolate: { w: 84,  hitW: 84  }, // floating chocolate block flush with the gap edge (hitbox = block only)
  };
  const CHOC_D = 34;   // chocolate block depth at the gap edge (must match drawFriendly + pipeHitRects)
  const BUSH_LIP = 16; // how far the scalloped leafy face bulges into the gap (hitbox includes it)
  const MODES = {
    calvin: {
      name: 'Calvin Mode', icon: '🦃',
      baseGap: BASE_GAP, minGap: MIN_GAP, gapShrink: GAP_SHRINK,
      baseSpeed: BASE_SPEED, speedRamp: SPEED_RAMP, maxSpeedBonus: MAX_SPEED_BONUS,
      pipeSpacing: PIPE_SPACING, maxGapJump: MAX_GAP_JUMP,
      obstacles: OBSTACLES, groundKills: true, unevenSpacing: false, palette: 'turkey',
    },
    sonya: {
      name: 'Sonya Mode', icon: '🌈',
      baseGap: 210, minGap: 210, gapShrink: 0,         // one easy gap size, forever
      baseSpeed: 140, speedRamp: 0, maxSpeedBonus: 0,  // one easy speed, forever
      pipeSpacing: 360, maxGapJump: 120,               // roomier spacing, gentler gap moves
      obstacles: SONYA_OBSTACLES,
      groundKills: false,                               // touching the ground = walk/run, not death
      unevenSpacing: true,                              // sometimes 1-3 obstacle slots are skipped
      palette: 'crazy',
    },
  };

  // Calvin Mode keeps the classic turkey look; Sonya Mode rolls a random crazy
  // palette (purple / teal blue / yellow / ...) fresh on every run.
  const TURKEY_PAL = {
    body: '#8f4f1d', belly: '#d99a55', wing: '#6e3a12', wingLine: 'rgba(74,36,8,0.7)',
    stroke: '#5d3313', wingStroke: '#4a2408',
    tail: ['#b03a2e', '#d35400', '#f39c12', '#ca6f1e', '#a04000', '#e59866', '#922b21'],
    beak: '#f5a623', beakStroke: '#c77f0a', snood: '#e74c3c', blush: 'rgba(231,76,60,0.45)',
  };
  const CRAZY_COLORS = ['#a55eea', '#26de81', '#fed330', '#fc5c65', '#45aaf2', '#fd9644', '#2bcbba', '#eb3b5a', '#8854d0', '#20bf6b', '#f7b731', '#00cec9'];
  function crazyPalette() {
    const pick = () => CRAZY_COLORS[(Math.random() * CRAZY_COLORS.length) | 0];
    const body = pick();
    let wing = pick(); while (wing === body) wing = pick();
    const tail = []; for (let i = 0; i < 7; i++) tail.push(pick());
    return {
      body, belly: pick(), wing, wingLine: 'rgba(20,10,40,0.45)',
      stroke: 'rgba(25,12,45,0.9)', wingStroke: 'rgba(25,12,45,0.9)',
      tail, beak: pick(), beakStroke: 'rgba(25,12,45,0.9)', snood: pick(),
      blush: 'rgba(255,255,255,0.4)',
    };
  }
  const BEST_KEY = 'flappyTurkeyBest';
  const MUTE_KEY = 'flappyTurkeyMuted';
  // sound toggle button: a small circle in the top-right corner (internal canvas coords)
  const MUTE_BTN = { cx: W - 36, cy: 38, r: 16 };

  // ---------- Sound effects (WebAudio, no assets) ----------
  const sfx = {
    ctx: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(f0, f1, dur, type, vol, delay = 0) {
      if (muted || !this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    flap()  { this.tone(420, 760, 0.09, 'square', 0.06); },
    point() { this.tone(920, 920, 0.07, 'square', 0.09); this.tone(1380, 1380, 0.14, 'square', 0.09, 0.08); },
    hit()   { this.tone(180, 55, 0.28, 'sawtooth', 0.18); },
    thud()  { this.tone(150, 55, 0.12, 'sine', 0.16); },
  };

  // ---------- Game state ----------
  let state;        // 'ready' | 'play' | 'dead'
  let bird, pipes, particles, clouds, steam;
  let score, best, distance, speed, flaps;
  let flapAnim, flash, deadTimer, partAcc, steamAcc, elapsed;
  let sceneIndex = 0;         // background scene matching the current score (see sceneFor)
  let sceneTransition = null; // { from, to, t } while the scenery slides between scenes
  let restAt = 0;        // deadTimer when the roasted turkey came to rest
  let boardOffered = false; // leaderboard auto-opened once for this death

  best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  // ---------- Mode selection ----------
  const MODE_KEY = 'flappyTurkeyMode';
  const DEV_KEY = 'flappyDev';
  // Sonya Mode is unpublished while in development: only players with the dev
  // flag see the Sonya picker/tab. LAUNCH: make this always true (remove gate).
  let devUnlocked = false;
  try { devUnlocked = localStorage.getItem(DEV_KEY) === '1'; } catch { /* private mode */ }
  let mode = 'calvin';
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'sonya' && devUnlocked) mode = 'sonya';
  } catch { /* ignore */ }
  let cfg = MODES[mode];
  let birdPalette = TURKEY_PAL;
  let walkCycle = 0; // run animation phase while the turkey is on the ground

  function toggleMute() {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (!muted) sfx.ensure();
  }

  function reset() {
    if (window.FLAPPY) window.FLAPPY.ui.hide();
    bird = { x: BIRD_X, y: H * 0.42, vy: 0, vx: 0, rot: 0, roasted: false, bounces: 0, resting: false, onGround: false };
    pipes = [];
    particles = [];
    steam = [];
    score = 0;
    flaps = 0;
    distance = 0;
    speed = cfg.baseSpeed;
    flapAnim = 0;
    flash = 0;
    deadTimer = 0;
    partAcc = 0;
    steamAcc = 0;
    elapsed = 0;
    restAt = 0;
    boardOffered = false;
    walkCycle = 0;
    birdPalette = cfg.palette === 'crazy' ? crazyPalette() : TURKEY_PAL;
    sceneIndex = 0;
    sceneTransition = null;
    setThemeColor(0);
    state = 'ready';
    syncPicker();
  }

  clouds = [];
  for (let i = 0; i < 4; i++) {
    clouds.push({ x: Math.random() * (W + 200), y: 60 + Math.random() * 220, s: 0.7 + Math.random() * 0.7, v: 6 + Math.random() * 10 });
  }

  // ---------- Input: tap anywhere to flap (the ONLY control) ----------
  function onTap() {
    sfx.ensure();
    if (state === 'ready') {
      state = 'play';
      syncPicker();
      if (window.FLAPPY) window.FLAPPY.api.startRun(mode); // signed run token, bound to this mode
      flap();
    } else if (state === 'play') {
      flap();
    } else if (state === 'dead' && deadTimer > 0.8) {
      reset();
    }
  }

  function flap() {
    bird.vy = FLAP_VY;
    bird.onGround = false; // flapping lifts the turkey off the ground
    flapAnim = 1;
    flaps++; // counted for the cumulative all-player stats
    sfx.flap();
  }

  function toGameCoords(e) {
    const src = (e.touches && e.touches[0]) || e;
    if (src.clientX === undefined) return null;
    const r = canvas.getBoundingClientRect();
    return {
      x: (src.clientX - r.left) * (W / r.width),
      y: (src.clientY - r.top) * (H / r.height),
    };
  }

  function inMuteButton(p) {
    return p && Math.hypot(p.x - MUTE_BTN.cx, p.y - MUTE_BTN.cy) <= MUTE_BTN.r + 4;
  }

  function handlePress(e) {
    if (e.cancelable) e.preventDefault();
    // tapping the sound toggle must NOT flap
    if (inMuteButton(toGameCoords(e))) { toggleMute(); return; }
    onTap();
  }

  if (window.PointerEvent) {
    // modern browsers: one pointerdown covers mouse, touch and pen
    window.addEventListener('pointerdown', handlePress, { passive: false });
  } else {
    // fallback for older browsers without Pointer Events
    window.addEventListener('mousedown', handlePress);
    window.addEventListener('touchstart', handlePress, { passive: false });
  }
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Obstacles ----------
  function effGap(p) {
    // live wires have sparking tips that eat a little of the gap; the rest is fully clear
    return p.type === 'wires' ? Math.max(136, p.gap - ELEC_SHRINK) : p.gap;
  }

  function spawnPipe() {
    const gap = Math.max(cfg.minGap, cfg.baseGap - score * cfg.gapShrink);
    const margin = 130;
    let gapY = margin + gap / 2 + Math.random() * (H - GROUND_H - 2 * margin - gap);
    // guarantee the next gap is reachable from the previous one
    if (pipes.length) {
      const prev = pipes[pipes.length - 1].gapY;
      const lo = Math.max(margin + gap / 2, prev - cfg.maxGapJump);
      const hi = Math.min(H - GROUND_H - margin - gap / 2, prev + cfg.maxGapJump);
      gapY = Math.max(lo, Math.min(hi, gapY));
    }
    const types = Object.keys(cfg.obstacles);
    const type = types[(Math.random() * types.length) | 0];
    let x;
    if (pipes.length) {
      // Sonya Mode: uneven spacing — sometimes 1-2 obstacle slots are skipped,
      // leaving open ground the turkey can land on (max gap = 3 slots = 1080px)
      let slots = 1;
      if (cfg.unevenSpacing) {
        const r = Math.random();
        slots = r < 0.70 ? 1 : r < 0.92 ? 2 : 3; // 0..2 missing obstacles
      }
      x = pipes[pipes.length - 1].x + cfg.pipeSpacing * slots;
    } else {
      x = W + 80;
    }
    pipes.push({ x, gapY, gap, type, w: cfg.obstacles[type].w, hitW: cfg.obstacles[type].hitW, scored: false });
  }

  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  // world-space collision circles + bounding box of the turkey's outline
  function birdExtents() {
    const cos = Math.cos(bird.rot), sin = Math.sin(bird.rot);
    const circles = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of BIRD_HIT) {
      const wx = bird.x + c.x * cos - c.y * sin;
      const wy = bird.y + c.x * sin + c.y * cos;
      circles.push({ x: wx, y: wy, r: c.r });
      if (wx - c.r < minX) minX = wx - c.r;
      if (wx + c.r > maxX) maxX = wx + c.r;
      if (wy - c.r < minY) minY = wy - c.r;
      if (wy + c.r > maxY) maxY = wy + c.r;
    }
    return { circles, minX, maxX, minY, maxY };
  }

  // Hitbox rects for an obstacle, always a subset of its drawn sprite.
  function pipeHitRects(p, top, bot) {
    const rects = [];
    const push = (x, y, w, h) => { if (w > 0 && h > 0) rects.push({ x, y, w, h }); };
    if (p.type === 'pitchfork') {
      // full-width trident head at the gap edge; narrow handle behind it
      push(p.x, Math.max(-20, top - FORK_HEAD_D), p.w, Math.min(FORK_HEAD_D, top + 20));
      const hx = p.x + (p.w - FORK_HANDLE_W) / 2;
      push(hx, -20, FORK_HANDLE_W, Math.max(0, top - FORK_HEAD_D + 20));
      push(p.x, bot, p.w, Math.min(FORK_HEAD_D, H - bot + 20));
      push(hx, bot + FORK_HEAD_D, FORK_HANDLE_W, H - bot + 20 - FORK_HEAD_D);
    } else if (p.type === 'fryer') {
      const hx = p.x + (p.w - p.hitW) / 2;
      push(hx, -20, p.hitW, top + 20);
      push(hx, bot, p.hitW, H - bot + 20);
      // the oil vat and basket handle are DRAWN bulging into the gap — hitbox includes them
      push(p.x + 8, top, p.w - 16, 18);
      push(p.x + 8, bot - 18, p.w - 16, 18);
    } else if (p.type === 'bush' || p.type === 'flowers') {
      const hx = p.x + (p.w - p.hitW) / 2;
      push(hx, -20, p.hitW, top + 20);
      push(hx, bot, p.hitW, H - bot + 20);
      // the scalloped leafy face bulges BUSH_LIP into the gap — hitbox includes it
      push(p.x, top, p.w, BUSH_LIP);
      push(p.x, bot - BUSH_LIP, p.w, BUSH_LIP);
    } else if (p.type === 'chocolate') {
      // the block bulges CHOC_D into the gap — hitbox == the drawn block, nothing else is solid
      push(p.x, top, p.w, Math.min(CHOC_D, H - top + 20));
      push(p.x, Math.max(-20, bot - CHOC_D), p.w, Math.min(CHOC_D, bot + 20));
    } else {
      const hx = p.x + (p.w - p.hitW) / 2;
      push(hx, -20, p.hitW, top + 20);
      push(hx, bot, p.hitW, H - bot + 20);
    }
    return rects;
  }

  function hitsPipe(p, circles, top, bot) {
    for (const r of pipeHitRects(p, top, bot)) {
      for (const c of circles) {
        if (circleRect(c.x, c.y, c.r, r.x, r.y, r.w, r.h)) return true;
      }
    }
    return false;
  }

  function die(fromObstacle) {
    if (state !== 'play') return;
    state = 'dead';
    deadTimer = 0;
    flash = 1;
    bird.roasted = true;   // the turkey is cooked
    bird.bounces = 0;
    bird.resting = false;
    if (fromObstacle) {
      bird.vy = Math.min(bird.vy, FLAP_VY * 0.6); // bounce off the obstacle
      bird.vx = (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 120); // sideways kick
    } else {
      bird.vy = 0; bird.vx = 0; bird.resting = true; // already on the floor
    }
    sfx.hit();
    restAt = 0; // ground deaths are already resting; obstacle deaths set this on landing
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    // report this game's flaps/gates to the cumulative all-player stats — after EVERY
    // game (even score 0), best-effort, and separate from any leaderboard submission
    if (window.FLAPPY) window.FLAPPY.api.reportStats(flaps, score);
    // NOTE: the leaderboard is NOT opened here — update() offers it via
    // gameOverVisible(), so the player gets to watch the bounce first.
  }

  // The game-over panel (and the leaderboard offer) appear only after the
  // roasted turkey has landed and settled for a beat — never mid-bounce.
  function gameOverVisible() {
    return state === 'dead' && ((bird.resting && deadTimer >= restAt + 0.6) || deadTimer > 5);
  }

  // ---------- Update ----------
  function update(dt) {
    elapsed += dt;

    // while the scenery changes, the old scene slides away at world-scroll speed —
    // exactly as fast as the bird flies, so it reads as flying from one scene to the next
    if (sceneTransition) {
      sceneTransition.t += (speed * dt) / W;
      if (sceneTransition.t >= 1) sceneTransition = null;
    }

    // drifting clouds always move
    for (const c of clouds) {
      c.x -= c.v * dt;
      if (c.x < -140 * c.s) { c.x = W + 140 * c.s; c.y = 60 + Math.random() * 220; }
    }

    // falling particles always drift: autumn leaves in the sunset scene, green-gold
    // leaves in the forest, snowflakes in the snow and christmas scenes, nothing
    // over the lake, city or space
    const pScene = sceneTransition ? sceneTransition.to : sceneIndex;
    if (pScene === 3 || pScene === 6) {
      partAcc += dt * 26;
      while (partAcc > 1) {
        partAcc -= 1;
        particles.push({
          kind: 'flake',
          x: Math.random() * W, y: -10,
          vy: 26 + Math.random() * 42,
          sway: Math.random() * Math.PI * 2,
          swaySpeed: 0.8 + Math.random() * 1.8,
          size: 1.6 + Math.random() * 2.6,
          rot: 0, vr: 0,
        });
      }
    } else if (pScene === 0 || pScene === 1 || pScene === 7) {
      partAcc += dt * 7;
      while (partAcc > 1) {
        partAcc -= 1;
        const palette = pScene === 1
          ? ['#3e7c3a', '#61ad4e', '#9ccc65', '#c0ca33', '#ffb300']
          : ['#c0392b', '#e67e22', '#f1c40f', '#d35400', '#a93226'];
        particles.push({
          kind: 'leaf',
          x: Math.random() * W, y: -12,
          vy: 40 + Math.random() * 55,
          sway: Math.random() * Math.PI * 2,
          swaySpeed: 1.5 + Math.random() * 2.5,
          size: 4 + Math.random() * 4.5,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 4,
          color: palette[(Math.random() * palette.length) | 0],
        });
      }
    }
    for (const l of particles) {
      l.y += l.vy * dt;
      l.x += Math.sin(elapsed * l.swaySpeed + l.sway) * 34 * dt;
      l.rot += l.vr * dt;
    }
    particles = particles.filter((l) => l.y < H + 20);

    // steam wisps rising off the roasted turkey
    if (bird && bird.roasted) {
      steamAcc += dt * 2.4;
      while (steamAcc > 1) {
        steamAcc -= 1;
        steam.push({
          x: bird.x + (Math.random() * 18 - 9),
          y: bird.y - 16,
          vy: -(26 + Math.random() * 18),
          r: 3 + Math.random() * 4,
          life: 1,
        });
      }
    }
    for (const s of steam) {
      s.y += s.vy * dt;
      s.r += 7 * dt;
      s.life -= dt * 0.7;
    }
    steam = steam.filter((s) => s.life > 0 && s.y > -30);

    flapAnim = Math.max(0, flapAnim - dt * 2.5); // wing-flap boost lingers a moment
    flash = Math.max(0, flash - dt * 2.5);

    if (state === 'ready') {
      bird.y = H * 0.42 + Math.sin(elapsed * 3) * 9;
      bird.rot = Math.sin(elapsed * 3 + 1) * 0.08;
      return;
    }

    if (state === 'play') {
      speed = cfg.baseSpeed + Math.min(cfg.maxSpeedBonus, score * cfg.speedRamp);
      distance += speed * dt;

      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
      bird.y += bird.vy * dt;

      if (!pipes.length || pipes[pipes.length - 1].x < W - cfg.pipeSpacing) spawnPipe();
      const ext = birdExtents();
      for (const p of pipes) {
        p.x -= speed * dt;
        const g = effGap(p);
        const top = p.gapY - g / 2, bot = p.gapY + g / 2;
        if (!p.scored && p.x + p.w < ext.minX) {
          p.scored = true;
          score++;
          sfx.point();
          // entering a new difficulty stage (or a fixed scene mark) changes the
          // scenery; slide from the old scene to the new one
          const nextScene = sceneFor(score);
          if (nextScene !== sceneIndex) {
            sceneTransition = { from: sceneIndex, to: nextScene, t: 0 };
            sceneIndex = nextScene;
            setThemeColor(sceneIndex);
          }
        }
        if (hitsPipe(p, ext.circles, top, bot)) {
          die(true);
        }
      }
      pipes = pipes.filter((p) => p.x > -p.w - 60);

      const ext2 = birdExtents();
      if (ext2.maxY >= H - GROUND_H) {
        bird.y -= (ext2.maxY - (H - GROUND_H));
        if (cfg.groundKills) {
          die(false);
        } else {
          // Sonya Mode: landing on the ground is safe — the turkey just runs along it
          bird.vy = 0;
          bird.onGround = true;
        }
      }
      if (ext2.minY < 0) { bird.y -= ext2.minY; bird.vy = Math.max(bird.vy, 0); }
      if (bird.onGround && state === 'play') walkCycle += speed * dt; // run animation phase
    }

    if (state === 'dead') {
      deadTimer += dt;
      const floorTop = H - GROUND_H;
      if (!bird.resting) {
        // roasted turkey tumbles through the air, bouncing off floor/walls/ceiling
        bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
        bird.y += bird.vy * dt;
        bird.x += bird.vx * dt;
        bird.vx *= Math.max(0, 1 - 0.5 * dt); // air drag
        let ext = birdExtents();
        if (ext.minY < 0) { bird.y -= ext.minY; bird.vy = Math.abs(bird.vy) * 0.5; ext = birdExtents(); }
        if (ext.minX < 0) { bird.x -= ext.minX; bird.vx = Math.abs(bird.vx) * 0.6; ext = birdExtents(); }
        if (ext.maxX > W) { bird.x -= (ext.maxX - W); bird.vx = -Math.abs(bird.vx) * 0.6; ext = birdExtents(); }
        if (ext.maxY >= floorTop) {
          bird.y -= (ext.maxY - floorTop);
          if (bird.bounces < ROAST_BOUNCES) {
            bird.bounces++;
            bird.vy = -Math.max(Math.abs(bird.vy) * 0.45, 240); // hop back up
            bird.vx *= 0.65;
            flash = Math.max(flash, 0.35);
            sfx.thud();
          } else {
            bird.vy = 0;
            bird.resting = true;
            restAt = deadTimer;
            flash = 1; // visual landing flash only — no second hit sound
          }
        }
      } else {
        // settled on the floor: just slide to a stop
        bird.vx *= Math.max(0, 1 - 6 * dt);
        if (Math.abs(bird.vx) < 8) bird.vx = 0;
        bird.x += bird.vx * dt;
        const ext = birdExtents();
        if (ext.minX < 0) bird.x -= ext.minX;
        if (ext.maxX > W) bird.x -= (ext.maxX - W);
      }
      // once the game-over panel is up, auto-open the leaderboard (once per death)
      if (!boardOffered && score > 0 && gameOverVisible() && window.FLAPPY) {
        boardOffered = true;
        window.FLAPPY.ui.show(score);
      }
    }

    // rotation: nose up right after a flap, nose-dive when falling;
    // the roasted turkey tumbles while bouncing and settles on its side
    if (state === 'dead' && bird.roasted) {
      if (bird.resting) {
        const snap = Math.round(bird.rot / (Math.PI / 2)) * (Math.PI / 2);
        bird.rot += (snap - bird.rot) * Math.min(1, dt * 8);
      } else {
        bird.rot += (bird.vx >= 0 ? 1 : -1) * (3 + Math.abs(bird.vy) * 0.008) * dt;
      }
    } else if (bird.onGround) {
      bird.rot *= Math.max(0, 1 - 30 * dt); // snap horizontal immediately when running
    } else {
      // nose up on flap, nose-dive when falling
      const target = bird.vy < 0 ? -0.42 : Math.min(1.45, (bird.vy / MAX_FALL) * 1.5);
      bird.rot += (target - bird.rot) * Math.min(1, dt * (bird.vy < 0 ? 14 : 5));
    }
  }

  // ---------- Drawing helpers ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(str, x, y, size, fill = '#fff', align = 'center', stroke = 'rgba(60,20,0,0.85)', lw = 6) {
    ctx.font = `bold ${size}px 'Trebuchet MS', 'Segoe UI', sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
  }

  // ---------- Background scenes ----------
  // The scenery follows the game's difficulty ramp: scroll speed and gap size both
  // ramp up until "max hardness" (see the progression table in README). That ramp
  // [0..1] is split into 4 equal stages, one per scene: sunset -> oak forest ->
  // lake -> snow. With the current tuning the stages begin at scores 0 / 20 / 40 / 60,
  // and they move automatically if the difficulty knobs are retuned.
  // Past max hardness the scenery keeps going at fixed score marks: city at 100,
  // space at 150, christmas at 200, and back to the original sunset at 250.
  // Crossing into a new scene starts a slide: the old scene moves out to the left at
  // world-scroll speed (as if the bird flew away from it) while the new scene
  // slides in from the right — never an abrupt cut.
  const SCENE_NAMES = ['sunset', 'forest', 'lake', 'snow', 'city', 'space', 'christmas', 'sunset'];
  const MAX_SCENE = SCENE_NAMES.length - 1; // last entry loops back to the original sunset
  const THEME_COLORS = ['#2e1a47', '#4e7d3a', '#4a9fd8', '#8fb8e0', '#141a38', '#050510', '#0a2438', '#2e1a47'];
  const EXTRA_SCENE_MARKS = [100, 150, 200, 250]; // city, space, christmas, back to sunset

  // 0..1 difficulty progress at score s: whichever of speed / gap ramps fastest
  function difficultyProgress(s) {
    const speedProg = MAX_SPEED_BONUS > 0 ? Math.min(1, (s * SPEED_RAMP) / MAX_SPEED_BONUS) : 1;
    const gapSpan = BASE_GAP - MIN_GAP;
    const gapProg = gapSpan > 0 ? Math.min(1, (s * GAP_SHRINK) / gapSpan) : 1;
    return Math.max(speedProg, gapProg);
  }

  // scene index for a score: the difficulty ramp gives scenes 0-3 (sunset..snow);
  // once max hardness is reached, fixed marks give city/space/christmas/sunset
  function sceneFor(s) {
    const rampStage = Math.min(3, Math.floor(difficultyProgress(s) * 3 + 1e-9));
    if (rampStage < 3) return rampStage;
    let idx = 3; // snow at max hardness
    for (let i = 0; i < EXTRA_SCENE_MARKS.length; i++) {
      if (s >= EXTRA_SCENE_MARKS[i]) idx = 4 + i;
    }
    return idx;
  }

  function setThemeColor(i) {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', THEME_COLORS[i]);
  }

  // fixed scenery decorations (generated once, like the clouds, so they never flicker)
  function makeBumps(n, yBase, rMin, rMax, jitter) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        x: (W / n) * i + Math.random() * (W / n),
        y: yBase + (Math.random() - 0.5) * jitter,
        r: rMin + Math.random() * (rMax - rMin),
      });
    }
    return arr;
  }

  // Scene 1 — oak forest
  const oaks = [];
  for (let i = 0; i < 5; i++) {
    oaks.push({ x: 30 + i * 96 + Math.random() * 36, y: H * (0.84 + Math.random() * 0.03), r: 26 + Math.random() * 13 });
  }
  const forestFar = makeBumps(7, H * 0.70, 40, 70, 14);
  const forestNear = makeBumps(6, H * 0.80, 50, 85, 16);

  // Scene 2 — lake
  const lakeMountainsFar = [
    { x: W * 0.18, w: 150, h: 90 },
    { x: W * 0.55, w: 190, h: 130 },
    { x: W * 0.92, w: 140, h: 80 },
  ];
  const lakeMountainsNear = [
    { x: W * 0.38, w: 170, h: 70 },
    { x: W * 0.82, w: 150, h: 58 },
  ];
  const reeds = [];
  for (let i = 0; i < 7; i++) {
    reeds.push({ x: 20 + Math.random() * (W - 40), h: 34 + Math.random() * 30, lean: (Math.random() - 0.5) * 14 });
  }

  // Scene 3 — snow
  const snowMountains = [
    { x: W * 0.22, w: 200, h: 150 },
    { x: W * 0.68, w: 240, h: 190 },
    { x: W * 0.98, w: 160, h: 110 },
  ];
  const pines = [];
  for (let i = 0; i < 5; i++) {
    pines.push({ x: 34 + i * 96 + Math.random() * 30, base: H * (0.86 + Math.random() * 0.03), w: 56 + Math.random() * 26, h: 110 + Math.random() * 60 });
  }

  // Scene 4 — city at night
  const cityStars = [];
  for (let i = 0; i < 40; i++) {
    cityStars.push({ x: Math.random() * W, y: Math.random() * H * 0.5, r: 0.6 + Math.random() * 1.4, ph: Math.random() * 6.28 });
  }
  const cityFar = [];
  for (let i = 0; i < 7; i++) {
    cityFar.push({ x: i * 70 - 10 + Math.random() * 20, w: 55 + Math.random() * 30, h: 80 + Math.random() * 90 });
  }
  const cityNear = [];
  for (let i = 0; i < 5; i++) {
    cityNear.push({ x: i * 100 - 15 + Math.random() * 30, w: 80 + Math.random() * 30, h: 140 + Math.random() * 120 });
  }

  // Scene 5 — outer space
  const spaceStars = [];
  for (let i = 0; i < 80; i++) {
    spaceStars.push({ x: Math.random() * W, y: Math.random() * H, r: 0.5 + Math.random() * 1.6, ph: Math.random() * 6.28, sp: 1 + Math.random() * 3 });
  }
  const planet = { x: W * 0.74, y: H * 0.22, r: 46 };

  // Scene 6 — christmas night
  const xmasStars = [];
  for (let i = 0; i < 50; i++) {
    xmasStars.push({ x: Math.random() * W, y: Math.random() * H * 0.55, r: 0.6 + Math.random() * 1.4, ph: Math.random() * 6.28 });
  }
  const xmasHills = makeBumps(6, H * 0.80, 60, 100, 14);
  const xmasTree = { x: W * 0.68, base: H - GROUND_H, w: 120, h: 210 };
  const xmasLights = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff'];

  // Scene 0 — the original Thanksgiving sunset
  const trees = [
    { x: 40, y: H * 0.845, r: 26, c: '#d35400' },
    { x: 110, y: H * 0.865, r: 32, c: '#c0392b' },
    { x: 200, y: H * 0.85, r: 24, c: '#e67e22' },
    { x: 300, y: H * 0.868, r: 34, c: '#f39c12' },
    { x: 390, y: H * 0.85, r: 27, c: '#a93226' },
  ];

  function drawClouds(color) {
    ctx.fillStyle = color;
    for (const c of clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 46 * c.s, 16 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 28 * c.s, c.y + 6 * c.s, 32 * c.s, 13 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - 30 * c.s, c.y + 7 * c.s, 28 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSunsetSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2e1a47');
    sky.addColorStop(0.45, '#8e3b5c');
    sky.addColorStop(0.75, '#e2704a');
    sky.addColorStop(1, '#f7b267');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun with glow
    const sx = W * 0.7, sy = H * 0.26;
    const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 110);
    glow.addColorStop(0, 'rgba(255,214,107,0.85)');
    glow.addColorStop(1, 'rgba(255,214,107,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 110, sy - 110, 220, 220);
    ctx.fillStyle = '#ffd66b';
    ctx.beginPath(); ctx.arc(sx, sy, 42, 0, Math.PI * 2); ctx.fill();

    drawClouds('rgba(255,235,220,0.45)');

    // far ridge
    ctx.fillStyle = '#6b3560';
    ctx.beginPath();
    ctx.ellipse(W * 0.2, H * 0.80, W * 0.55, H * 0.17, 0, Math.PI, 0);
    ctx.ellipse(W * 0.85, H * 0.82, W * 0.5, H * 0.15, 0, Math.PI, 0);
    ctx.fill();

    // near ridge
    ctx.fillStyle = '#4c2547';
    ctx.beginPath();
    ctx.ellipse(W * 0.75, H * 0.88, W * 0.62, H * 0.16, 0, Math.PI, 0);
    ctx.ellipse(W * 0.08, H * 0.90, W * 0.45, H * 0.13, 0, Math.PI, 0);
    ctx.fill();

    // autumn trees
    for (const t of trees) {
      ctx.fillStyle = '#3a1a30';
      ctx.fillRect(t.x - 4, t.y, 8, 26);
      ctx.fillStyle = t.c;
      ctx.beginPath();
      ctx.arc(t.x, t.y - 4, t.r, 0, Math.PI * 2);
      ctx.arc(t.x - t.r * 0.6, t.y + 6, t.r * 0.65, 0, Math.PI * 2);
      ctx.arc(t.x + t.r * 0.6, t.y + 6, t.r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Scene 1 — oak forest: misty green sky, sunbeams, treelines and big oaks
  function drawForestSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#dff2c4');
    sky.addColorStop(0.45, '#a5d684');
    sky.addColorStop(0.8, '#79bd57');
    sky.addColorStop(1, '#5aa348');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // pale morning sun with glow
    const sx = W * 0.26, sy = H * 0.16;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 120);
    glow.addColorStop(0, 'rgba(255,250,214,0.9)');
    glow.addColorStop(1, 'rgba(255,250,214,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 120, sy - 120, 240, 240);
    ctx.fillStyle = '#fff8d8';
    ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();

    // sunbeams slanting down through the canopy
    ctx.fillStyle = 'rgba(255,252,220,0.10)';
    for (let i = 0; i < 3; i++) {
      const bx = sx + i * 70 - 40;
      ctx.beginPath();
      ctx.moveTo(bx, sy - 20);
      ctx.lineTo(bx + 46, sy - 20);
      ctx.lineTo(bx + 150, H * 0.8);
      ctx.lineTo(bx + 60, H * 0.8);
      ctx.closePath(); ctx.fill();
    }

    drawClouds('rgba(255,255,255,0.5)');

    // far and near treelines
    ctx.fillStyle = '#4c8a3d';
    for (const t of forestFar) {
      ctx.beginPath(); ctx.ellipse(t.x, t.y, t.r, t.r * 0.75, 0, Math.PI, 0); ctx.fill();
    }
    ctx.fillStyle = '#3c7030';
    for (const t of forestNear) {
      ctx.beginPath(); ctx.ellipse(t.x, t.y, t.r, t.r * 0.75, 0, Math.PI, 0); ctx.fill();
    }

    // oak trees: thick trunk + clustered canopy
    for (const t of oaks) {
      ctx.fillStyle = '#5d4023';
      ctx.fillRect(t.x - 7, t.y - 10, 14, 40);
      ctx.fillStyle = '#4e9440';
      ctx.beginPath();
      ctx.arc(t.x, t.y - t.r * 0.7, t.r, 0, Math.PI * 2);
      ctx.arc(t.x - t.r * 0.7, t.y - t.r * 0.3, t.r * 0.7, 0, Math.PI * 2);
      ctx.arc(t.x + t.r * 0.7, t.y - t.r * 0.3, t.r * 0.7, 0, Math.PI * 2);
      ctx.arc(t.x, t.y + t.r * 0.1, t.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.9, t.r * 0.45, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Scene 2 — lake: bright sky, sun, mountains, shimmering water and reeds
  function drawLakeSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#4f9fe0');
    sky.addColorStop(0.45, '#9fd0ef');
    sky.addColorStop(0.72, '#d8ecf7');
    sky.addColorStop(1, '#ffedc9');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun with a warm glow
    const sx = W * 0.72, sy = H * 0.18;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 110);
    glow.addColorStop(0, 'rgba(255,240,180,0.9)');
    glow.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 110, sy - 110, 220, 220);
    ctx.fillStyle = '#ffedae';
    ctx.beginPath(); ctx.arc(sx, sy, 36, 0, Math.PI * 2); ctx.fill();

    drawClouds('rgba(255,255,255,0.8)');

    // distant mountains, far range then nearer range
    const horizon = H * 0.58;
    ctx.fillStyle = '#8fb4d6';
    for (const m of lakeMountainsFar) {
      ctx.beginPath();
      ctx.moveTo(m.x - m.w / 2, horizon);
      ctx.lineTo(m.x, horizon - m.h);
      ctx.lineTo(m.x + m.w / 2, horizon);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#a9c8e2';
    for (const m of lakeMountainsNear) {
      ctx.beginPath();
      ctx.moveTo(m.x - m.w / 2, horizon + 14);
      ctx.lineTo(m.x, horizon + 14 - m.h);
      ctx.lineTo(m.x + m.w / 2, horizon + 14);
      ctx.closePath(); ctx.fill();
    }

    // the lake
    const water = ctx.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, '#b7e3f6');
    water.addColorStop(0.35, '#6cbde8');
    water.addColorStop(1, '#2f7fbe');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, W, H - horizon);

    // sun reflection shimmering down the water
    for (let y = horizon + 10; y < H; y += 13) {
      const w = 14 + ((y - horizon) / (H - horizon)) * 46;
      const a = 0.34 * (0.5 + 0.5 * Math.sin(elapsed * 2.2 + y * 0.35));
      ctx.fillStyle = `rgba(255,236,170,${a})`;
      ctx.beginPath();
      ctx.ellipse(sx + Math.sin(elapsed * 1.3 + y) * 8, y, w, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // drifting ripple lines
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const ry = horizon + 24 + i * ((H - horizon - 30) / 9);
      ctx.globalAlpha = 0.12 + 0.12 * Math.sin(elapsed * 1.6 + i * 1.7);
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 24) {
        const yy = ry + Math.sin(x * 0.05 + elapsed * 2 + i) * 3;
        if (x === -10) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // reeds at the water's edge (their bases are tucked behind the ground strip)
    for (const r of reeds) {
      ctx.strokeStyle = '#3f6b2f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r.x, H - GROUND_H + 4);
      ctx.quadraticCurveTo(r.x + r.lean, H - GROUND_H - r.h * 0.6, r.x + r.lean * 1.6, H - GROUND_H - r.h);
      ctx.stroke();
      ctx.fillStyle = '#7a4a21';
      ctx.beginPath();
      ctx.ellipse(r.x + r.lean * 1.6, H - GROUND_H - r.h, 4, 9, r.lean * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Scene 3 — snow: pale winter sky, snow-capped mountains and snow-covered pines
  function drawSnowSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#7fa9d8');
    sky.addColorStop(0.55, '#bcd4ec');
    sky.addColorStop(1, '#eef5fc');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // pale winter sun
    const sx = W * 0.3, sy = H * 0.15;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 100);
    glow.addColorStop(0, 'rgba(240,248,255,0.9)');
    glow.addColorStop(1, 'rgba(240,248,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 100, sy - 100, 200, 200);
    ctx.fillStyle = '#f6fbff';
    ctx.beginPath(); ctx.arc(sx, sy, 30, 0, Math.PI * 2); ctx.fill();

    drawClouds('rgba(255,255,255,0.75)');

    // snowy mountains with white caps
    const base = H * 0.66;
    for (const m of snowMountains) {
      ctx.fillStyle = '#9db6d2';
      ctx.beginPath();
      ctx.moveTo(m.x - m.w / 2, base);
      ctx.lineTo(m.x, base - m.h);
      ctx.lineTo(m.x + m.w / 2, base);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f4f9ff';
      ctx.beginPath();
      ctx.moveTo(m.x - m.w * 0.16, base - m.h * 0.72);
      ctx.lineTo(m.x, base - m.h);
      ctx.lineTo(m.x + m.w * 0.16, base - m.h * 0.72);
      ctx.lineTo(m.x + m.w * 0.07, base - m.h * 0.62);
      ctx.lineTo(m.x, base - m.h * 0.72);
      ctx.lineTo(m.x - m.w * 0.07, base - m.h * 0.62);
      ctx.closePath(); ctx.fill();
    }

    // snow-covered pines (bases tucked behind the ground strip)
    for (const t of pines) {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(t.x - 4, t.base - 10, 8, 16);
      for (let tier = 0; tier < 4; tier++) {
        const ty = t.base - 14 - tier * (t.h * 0.22);
        const tw = t.w * (1 - tier * 0.22);
        const th = t.h * 0.3;
        ctx.fillStyle = '#2e5d43';
        ctx.beginPath();
        ctx.moveTo(t.x - tw / 2, ty);
        ctx.lineTo(t.x, ty - th);
        ctx.lineTo(t.x + tw / 2, ty);
        ctx.closePath(); ctx.fill();
        // snow lying on top of the tier
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.moveTo(t.x - tw * 0.32, ty - th * 0.45);
        ctx.lineTo(t.x, ty - th);
        ctx.lineTo(t.x + tw * 0.32, ty - th * 0.45);
        ctx.lineTo(t.x + tw * 0.12, ty - th * 0.32);
        ctx.lineTo(t.x, ty - th * 0.45);
        ctx.lineTo(t.x - tw * 0.12, ty - th * 0.32);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  // Scene 4 — city at night: starfield, crescent moon, two skyline layers with lit windows
  function drawCitySky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d1030');
    sky.addColorStop(0.6, '#1b2350');
    sky.addColorStop(1, '#2c3a6e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // twinkling stars
    for (const st of cityStars) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 2 + st.ph))})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }

    // crescent moon
    const mx = W * 0.78, my = H * 0.14;
    ctx.fillStyle = '#f4f1de';
    ctx.beginPath(); ctx.arc(mx, my, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10143a';
    ctx.beginPath(); ctx.arc(mx - 12, my - 6, 26, 0, Math.PI * 2); ctx.fill();

    // far skyline (silhouettes with a few lit windows)
    ctx.fillStyle = '#232a4d';
    for (const b of cityFar) {
      ctx.fillRect(b.x, H - b.h, b.w, b.h + 20);
      ctx.fillStyle = 'rgba(255,217,122,0.5)';
      for (let k = 0; k < (b.w / 18) | 0; k++) {
        if ((k * 13 + (b.x | 0)) % 4 === 0) ctx.fillRect(b.x + 8 + k * 18, H - b.h + 12 + (k % 3) * 22, 6, 8);
      }
      ctx.fillStyle = '#232a4d';
    }

    // near skyline with window grids and blinking antenna lights
    for (const b of cityNear) {
      ctx.fillStyle = '#161c38';
      ctx.fillRect(b.x, H - b.h, b.w, b.h + 20);
      for (let wy = H - b.h + 12; wy < H - 24; wy += 18) {
        for (let wx = b.x + 8; wx < b.x + b.w - 12; wx += 14) {
          const hsh = ((wx | 0) * 31 + (wy | 0) * 17) % 7;
          if (hsh < 2) {
            ctx.fillStyle = hsh === 0 ? '#ffd97a' : '#9adcff';
            ctx.fillRect(wx, wy, 8, 10);
          }
        }
      }
      if (b.w > 90) {
        const ax = b.x + b.w / 2;
        ctx.strokeStyle = '#0c0f22';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(ax, H - b.h); ctx.lineTo(ax, H - b.h - 22); ctx.stroke();
        if (Math.sin(elapsed * 3 + b.x) > 0) {
          ctx.fillStyle = '#ff5252';
          ctx.beginPath(); ctx.arc(ax, H - b.h - 24, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  // Scene 5 — outer space: starfield, ringed planet, nebula glow, occasional shooting star
  function drawSpaceSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#020208');
    sky.addColorStop(0.6, '#0a0a24');
    sky.addColorStop(1, '#141433');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // soft nebula glows
    let neb = ctx.createRadialGradient(W * 0.2, H * 0.3, 10, W * 0.2, H * 0.3, 160);
    neb.addColorStop(0, 'rgba(120,60,180,0.20)');
    neb.addColorStop(1, 'rgba(120,60,180,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W * 0.6, H * 0.7);
    neb = ctx.createRadialGradient(W * 0.55, H * 0.75, 10, W * 0.55, H * 0.75, 150);
    neb.addColorStop(0, 'rgba(30,140,120,0.16)');
    neb.addColorStop(1, 'rgba(30,140,120,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(W * 0.2, H * 0.4, W * 0.8, H * 0.6);

    // twinkling stars
    for (const st of spaceStars) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.6 * (0.5 + 0.5 * Math.sin(elapsed * st.sp + st.ph))})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }

    // ringed planet
    ctx.save();
    ctx.translate(planet.x, planet.y);
    ctx.rotate(-0.35);
    ctx.strokeStyle = 'rgba(190,200,255,0.4)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.ellipse(0, 0, planet.r + 22, (planet.r + 22) * 0.32, 0, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const pg = ctx.createRadialGradient(planet.x - 14, planet.y - 14, 6, planet.x, planet.y, planet.r);
    pg.addColorStop(0, '#7fb2e8');
    pg.addColorStop(0.6, '#3f6fb5');
    pg.addColorStop(1, '#1d3a66');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(planet.x, planet.y);
    ctx.rotate(-0.35);
    ctx.strokeStyle = 'rgba(210,220,255,0.55)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.ellipse(0, 0, planet.r + 22, (planet.r + 22) * 0.32, 0, 0, Math.PI); ctx.stroke();
    ctx.restore();

    // shooting star every ~6 seconds
    const ph = (elapsed % 6) / 6;
    if (ph < 0.16) {
      const t = ph / 0.16;
      const sx = W * 0.95 - t * W * 0.75;
      const sy = H * 0.08 + t * H * 0.22;
      const tail = ctx.createLinearGradient(sx, sy, sx + 70, sy + 26);
      tail.addColorStop(0, 'rgba(255,255,255,0.9)');
      tail.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = tail;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(sx + 70, sy + 26); ctx.lineTo(sx, sy); ctx.stroke();
    }
  }

  // Scene 6 — christmas night: stars, moon, snowy hills, string lights, decorated tree
  function drawChristmasSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#051224');
    sky.addColorStop(0.6, '#0b2a44');
    sky.addColorStop(1, '#14455c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // stars
    for (const st of xmasStars) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 2.2 + st.ph))})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }

    // warm full moon with glow
    const mx = W * 0.24, my = H * 0.15;
    const glow = ctx.createRadialGradient(mx, my, 8, mx, my, 90);
    glow.addColorStop(0, 'rgba(255,243,201,0.7)');
    glow.addColorStop(1, 'rgba(255,243,201,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 90, my - 90, 180, 180);
    ctx.fillStyle = '#fff3c9';
    ctx.beginPath(); ctx.arc(mx, my, 30, 0, Math.PI * 2); ctx.fill();

    // snowy hills
    ctx.fillStyle = '#cfe3f2';
    for (const hb of xmasHills) {
      ctx.beginPath(); ctx.ellipse(hb.x, hb.y, hb.r, hb.r * 0.5, 0, Math.PI, 0); ctx.fill();
    }

    // string lights sagging across the sky
    const ly = H * 0.24;
    ctx.strokeStyle = 'rgba(15,25,20,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, ly - 14);
    ctx.quadraticCurveTo(W / 2, ly + 46, W + 6, ly - 10);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const t = (i + 0.5) / 12;
      const bx = (1 - t) * (1 - t) * -6 + 2 * (1 - t) * t * (W / 2) + t * t * (W + 6);
      const by = (1 - t) * (1 - t) * (ly - 14) + 2 * (1 - t) * t * (ly + 46) + t * t * (ly - 10);
      const blink = 0.55 + 0.45 * Math.sin(elapsed * 3.5 + i * 1.3);
      ctx.fillStyle = xmasLights[i % 4];
      ctx.globalAlpha = blink;
      ctx.beginPath(); ctx.arc(bx, by + 4, 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = blink * 0.9;
      ctx.beginPath(); ctx.arc(bx, by + 4, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // decorated christmas tree (base tucked behind the ground strip)
    const t = xmasTree;
    ctx.fillStyle = '#4a2f1a';
    ctx.fillRect(t.x - 7, t.base - 16, 14, 22);
    for (let tier = 0; tier < 4; tier++) {
      const ty = t.base - 18 - tier * (t.h * 0.21);
      const tw = t.w * (1 - tier * 0.24);
      const th = t.h * 0.3;
      ctx.fillStyle = '#1e5c34';
      ctx.beginPath();
      ctx.moveTo(t.x - tw / 2, ty);
      ctx.lineTo(t.x, ty - th);
      ctx.lineTo(t.x + tw / 2, ty);
      ctx.closePath(); ctx.fill();
      // snow on the tier edge
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(t.x - tw * 0.42, ty - th * 0.32);
      ctx.lineTo(t.x, ty - th);
      ctx.lineTo(t.x + tw * 0.42, ty - th * 0.32);
      ctx.stroke();
      // ornaments + blinking lights
      for (let o = 0; o < 5; o++) {
        const oy = ty - th * (0.25 + 0.55 * ((o * 37 + tier * 11) % 10) / 10);
        const ox = t.x + (((o * 53 + tier * 29) % 100) / 100 - 0.5) * tw * 0.7;
        if ((o + tier) % 2 === 0) {
          ctx.fillStyle = xmasLights[(o + tier) % 4];
          ctx.globalAlpha = 0.6 + 0.4 * Math.sin(elapsed * 4 + o * 2 + tier);
          ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = '#e8b4b8';
          ctx.beginPath(); ctx.arc(ox, oy, 3.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // glowing star on top
    ctx.fillStyle = `rgba(255,215,64,${0.7 + 0.3 * Math.sin(elapsed * 3)})`;
    ctx.beginPath(); ctx.arc(t.x, t.base - t.h - 8, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,64,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(t.x - 12, t.base - t.h - 8); ctx.lineTo(t.x + 12, t.base - t.h - 8);
    ctx.moveTo(t.x, t.base - t.h - 20); ctx.lineTo(t.x, t.base - t.h + 4);
    ctx.stroke();
  }

  function drawSceneSky(i) {
    if (i === 1) drawForestSky();
    else if (i === 2) drawLakeSky();
    else if (i === 3) drawSnowSky();
    else if (i === 4) drawCitySky();
    else if (i === 5) drawSpaceSky();
    else if (i === 6) drawChristmasSky();
    else drawSunsetSky(); // scenes 0 and 7 (the looped-back original sunset)
  }

  // ground strip per scene: dirt+grass, forest floor, sandy shore, snow, city street,
  // moon surface, christmas snow, and back to dirt+grass for the looped sunset
  const GROUND_PALS = [
    { base: '#7a5230', patch: 'rgba(0,0,0,0.14)', top: '#8aa845', hi: '#a4c25a' },
    { base: '#7a5a33', patch: 'rgba(0,0,0,0.16)', top: '#6fae4a', hi: '#8ccb62' },
    { base: '#e6cf9c', patch: 'rgba(150,120,70,0.28)', top: '#f2e2b6', hi: '#faf0cd' },
    { base: '#e9f2fb', patch: 'rgba(150,185,220,0.35)', top: '#ffffff', hi: '#d9eaf8' },
    { base: '#33384a', patch: 'rgba(0,0,0,0.30)', top: '#4a5164', hi: '#5d6579' },
    { base: '#23232e', patch: 'rgba(255,255,255,0.05)', top: '#3d3d4e', hi: '#4c4c60' },
    { base: '#e9f2fb', patch: 'rgba(150,185,220,0.35)', top: '#ffffff', hi: '#ffd76e' },
    { base: '#7a5230', patch: 'rgba(0,0,0,0.14)', top: '#8aa845', hi: '#a4c25a' },
  ];

  function drawSceneGround(i) {
    const gy = H - GROUND_H;
    const pal = GROUND_PALS[i];
    ctx.fillStyle = pal.base;
    ctx.fillRect(0, gy, W, GROUND_H);
    ctx.fillStyle = pal.patch;
    const off = -(distance % 48);
    for (let x = off; x < W; x += 48) ctx.fillRect(x, gy + 34, 24, GROUND_H - 34);
    ctx.fillStyle = pal.top;
    ctx.fillRect(0, gy, W, 18);
    ctx.fillStyle = pal.hi;
    ctx.fillRect(0, gy, W, 5);
  }

  // ---------- Obstacles ----------
  function drawPitchfork(p, edgeY, isTop) {
    const x = p.x, w = p.w;
    // the wooden handle stops where the steel head begins — no wood in the spike area
    const headY = isTop ? edgeY - FORK_HEAD_D : edgeY + FORK_HEAD_D;
    const y0 = isTop ? -20 : headY;
    const h = isTop ? headY + 20 : H - GROUND_H + 20 - headY;
    const hx = x + (w - FORK_HANDLE_W) / 2;
    // wooden handle
    const wood = ctx.createLinearGradient(hx, 0, hx + FORK_HANDLE_W, 0);
    wood.addColorStop(0, '#7a4a21');
    wood.addColorStop(0.5, '#a06a34');
    wood.addColorStop(1, '#5d3717');
    ctx.fillStyle = wood;
    roundRect(hx, y0, FORK_HANDLE_W, h, 6); ctx.fill();
    ctx.strokeStyle = '#3f2410'; ctx.lineWidth = 3;
    roundRect(hx, y0, FORK_HANDLE_W, h, 6); ctx.stroke();
    // steel trident head at the gap end
    const metal = ctx.createLinearGradient(x, 0, x + w, 0);
    metal.addColorStop(0, '#90a4ae');
    metal.addColorStop(0.5, '#eceff1');
    metal.addColorStop(1, '#607d8b');
    ctx.fillStyle = metal;
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = 3;
    // collar where the handle meets the head
    const collarY = isTop ? edgeY - FORK_HEAD_D - 12 : edgeY + FORK_HEAD_D;
    roundRect(hx - 3, collarY, FORK_HANDLE_W + 6, 12, 3); ctx.fill(); ctx.stroke();
    // crossbar, wider than the handle
    const barY = isTop ? edgeY - FORK_HEAD_D : edgeY + FORK_HEAD_D - 12;
    roundRect(x - 4, barY, w + 8, 12, 4); ctx.fill(); ctx.stroke();
    // three long sharp tines; tips land exactly on the gap edge, pointing into the gap
    // (top fork points down, bottom fork points UP); the OUTER tines sit on the edges
    for (let i = 0; i < 3; i++) {
      const tx = x + 5 + i * ((w - 10) / 2); // left tine at x..x+10, right tine at x+w-10..x+w
      const baseY = isTop ? edgeY - FORK_HEAD_D + 12 : edgeY + FORK_HEAD_D - 12;
      ctx.beginPath();
      ctx.moveTo(tx, baseY);
      ctx.lineTo(tx + 10, baseY);
      ctx.lineTo(tx + 5, edgeY);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  // ---------- Oven: steel range with a glowing fire door ----------
  function drawOven(p, edgeY, isTop) {
    const x = p.x, w = p.w;
    const y0 = isTop ? -20 : edgeY;
    const y1 = isTop ? edgeY : H - GROUND_H + 20;
    const h = y1 - y0;
    // body
    const metal = ctx.createLinearGradient(x, 0, x + w, 0);
    metal.addColorStop(0, '#263238');
    metal.addColorStop(0.5, '#546e7a');
    metal.addColorStop(1, '#1c262b');
    ctx.fillStyle = metal;
    ctx.strokeStyle = '#0d1417';
    ctx.lineWidth = 3;
    roundRect(x, y0, w, h, 8); ctx.fill(); ctx.stroke();
    // control panel at the outer end with knobs
    const panelH = 26;
    ctx.fillStyle = '#1c262b';
    if (isTop) ctx.fillRect(x + 3, y0, w - 6, panelH); else ctx.fillRect(x + 3, y1 - panelH, w - 6, panelH);
    const ky = isTop ? y0 + panelH / 2 : y1 - panelH / 2;
    for (let i = 0; i < 3; i++) {
      const kx = x + w / 2 + (i - 1) * (w / 4);
      ctx.fillStyle = '#90a4ae';
      ctx.beginPath(); ctx.arc(kx, ky, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0d1417'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // door toward the gap, with a fire-glow window
    const doorH = Math.min(h - panelH - 30, 120);
    const doorY = isTop ? edgeY - doorH - 8 : edgeY + 8;
    ctx.fillStyle = '#37474f';
    ctx.strokeStyle = '#0d1417'; ctx.lineWidth = 2.5;
    roundRect(x + 9, doorY, w - 18, doorH, 6); ctx.fill(); ctx.stroke();
    const winY = doorY + 10, winH = doorH - 34;
    ctx.fillStyle = '#0a0e12';
    roundRect(x + 15, winY, w - 30, winH, 4); ctx.fill();
    const flick = 0.6 + 0.4 * Math.abs(Math.sin(elapsed * 13 + p.x));
    const fire = ctx.createRadialGradient(x + w / 2, winY + winH, 4, x + w / 2, winY + winH, winH);
    fire.addColorStop(0, `rgba(255,196,66,${0.9 * flick})`);
    fire.addColorStop(0.6, `rgba(230,110,30,${0.55 * flick})`);
    fire.addColorStop(1, 'rgba(120,40,10,0)');
    ctx.fillStyle = fire;
    ctx.fillRect(x + 15, winY, w - 30, winH);
    // handle bar on the gap side of the door
    ctx.fillStyle = '#b0bec5';
    const hy = isTop ? doorY + doorH - 16 : doorY + 8;
    roundRect(x + 14, hy, w - 28, 7, 3); ctx.fill();
  }

  // ---------- Deep fryer: steel vat of bubbling oil at the gap edge ----------
  function drawFryer(p, edgeY, isTop) {
    const x = p.x, w = p.w;
    const y0 = isTop ? -20 : edgeY;
    const y1 = isTop ? edgeY : H - GROUND_H + 20;
    const h = y1 - y0;
    // stainless body
    const steel = ctx.createLinearGradient(x, 0, x + w, 0);
    steel.addColorStop(0, '#78909c');
    steel.addColorStop(0.5, '#eceff1');
    steel.addColorStop(1, '#546e7a');
    ctx.fillStyle = steel;
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 3;
    roundRect(x, y0, w, h, 8); ctx.fill(); ctx.stroke();
    // control strip at the outer end: knob + blinking red light
    const panelH = 22;
    ctx.fillStyle = '#37474f';
    if (isTop) ctx.fillRect(x + 3, y0, w - 6, panelH); else ctx.fillRect(x + 3, y1 - panelH, w - 6, panelH);
    const cy0 = isTop ? y0 + panelH / 2 : y1 - panelH / 2;
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath(); ctx.arc(x + 18, cy0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = Math.sin(elapsed * 6) > 0 ? '#ff5252' : '#7f1d1d';
    ctx.beginPath(); ctx.arc(x + w - 18, cy0, 4, 0, Math.PI * 2); ctx.fill();
    // oil vat opening at the gap end
    const cx = x + w / 2, cy = edgeY;
    const rx = w / 2 - 12, ry = 11;
    ctx.fillStyle = '#263238';
    ctx.beginPath(); ctx.ellipse(cx, cy, rx + 4, ry + 3, 0, 0, Math.PI * 2); ctx.fill();
    const oil = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
    oil.addColorStop(0, '#ffb300');
    oil.addColorStop(1, '#e65100');
    ctx.fillStyle = oil;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    // bubbling oil
    for (let i = 0; i < 6; i++) {
      const a = elapsed * (1.5 + i * 0.3) + i * 2.1;
      const bx = cx + Math.sin(a + i) * (rx - 8);
      const by = cy + Math.cos(a * 1.3 + i * 2) * (ry - 4);
      ctx.fillStyle = 'rgba(255,224,130,0.9)';
      ctx.beginPath(); ctx.arc(bx, by, 2 + (i % 3), 0, Math.PI * 2); ctx.fill();
    }
    // basket handle sticking out toward the gap
    const sway = Math.sin(elapsed * 2.2 + p.x) * 5;
    ctx.strokeStyle = '#455a64';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + sway, cy);
    ctx.lineTo(cx + sway + 10, cy + (isTop ? 16 : -16));
    ctx.stroke();
  }

  // ---------- Live wires: swaying cable with sparking exposed ends ----------
  function drawWires(p, top, bot) {
    const x = p.x, w = p.w;
    const cx = x + w / 2;
    // collision edge sits this far past the visual gap edge; sparks end exactly there
    const edgeInset = (p.gap - effGap(p)) / 2;
    const fringe = Math.max(0, edgeInset - 6);
    const sway = Math.sin(elapsed * 2 + p.x) * 4;
    const flicker = 0.5 + 0.5 * Math.sin(elapsed * 21 + p.x);

    // faint aura, kept within the hitbox width
    const hx = x + (w - p.hitW) / 2;
    ctx.fillStyle = `rgba(0,229,255,${0.04 + 0.04 * flicker})`;
    ctx.fillRect(hx - 4, -20, p.hitW + 8, top + 20);
    ctx.fillRect(hx - 4, bot, p.hitW + 8, H - GROUND_H - bot + 20);

    // cable bodies (top hangs down, bottom rises up)
    ctx.save();
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 4 + 3 * flicker;
    ctx.strokeStyle = '#141a1e';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, -20); ctx.lineTo(cx + sway, top - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, H - GROUND_H + 20); ctx.lineTo(cx + sway, bot + 6); ctx.stroke();
    ctx.strokeStyle = '#3a4a52';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx - 2, -20); ctx.lineTo(cx + sway - 2, top - 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 2, H - GROUND_H + 20); ctx.lineTo(cx + sway - 2, bot + 8); ctx.stroke();
    ctx.restore();

    // exposed colored wires fanning toward the gap + sparks at the tips
    const wireCols = ['#ff5252', '#ffd740', '#40c4ff'];
    const drawWireEnd = (baseY, dir) => {
      const tips = [];
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 9;
        const tipX = cx + sway + off;
        const tipY = baseY + dir * 12;
        ctx.strokeStyle = wireCols[i];
        ctx.beginPath();
        ctx.moveTo(cx + sway, baseY);
        ctx.quadraticCurveTo(cx + sway + off * 1.5, baseY + dir * 8, tipX, tipY);
        ctx.stroke();
        tips.push({ x: tipX, y: tipY });
      }
      ctx.save();
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 2;
      ctx.strokeStyle = '#b3faff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      for (const t of tips) {
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        for (let s = 1; s <= 3; s++) {
          ctx.lineTo(t.x + (Math.random() - 0.5) * 6, t.y + dir * (fringe * s) / 3);
        }
        ctx.stroke();
      }
      ctx.restore();
    };
    drawWireEnd(top - 6, +1);  // top cable sparks point down into the gap
    drawWireEnd(bot + 6, -1);  // bottom cable sparks point up into the gap
  }

  // ---------- Sonya Mode: friendly obstacles (bushes, fence posts, flower bushes, chocolates) ----------
  function drawFriendly(p, edgeY, isTop) {
    const x = p.x, w = p.w;
    const y0 = isTop ? -20 : edgeY;
    const y1 = isTop ? edgeY : H - GROUND_H + 20;
    if (p.type === 'bush' || p.type === 'flowers') {
      // leafy column filling the whole side of the gap
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#2e7d32'); g.addColorStop(0.5, '#43a047'); g.addColorStop(1, '#1b5e20');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#0d3311'; ctx.lineWidth = 3;
      roundRect(x, y0, w, y1 - y0, 8); ctx.fill(); ctx.stroke();
      // leaf texture flecks
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      const hh = Math.max(60, y1 - y0 - 40);
      for (let i = 0; i < 5; i++) {
        const lx = x + 12 + ((i * 37 + (isTop ? 0 : 13)) % Math.max(1, w - 24));
        const ly = y0 + 20 + ((i * 53) % hh);
        ctx.beginPath(); ctx.ellipse(lx, ly, 9, 5, i * 0.7, 0, Math.PI * 2); ctx.fill();
      }
      // scalloped leafy face right at the gap edge (bulges BUSH_LIP into the gap)
      ctx.fillStyle = '#388e3c';
      ctx.strokeStyle = '#0d3311'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(x + (w / 4) * (i + 0.5), edgeY, BUSH_LIP, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (p.type === 'flowers') {
        // happy flowers sitting on the leafy face
        const petals = ['#ff6fa5', '#ffd93d', '#c56cf0'];
        for (let i = 0; i < 3; i++) {
          const fx = x + w * (0.22 + i * 0.28);
          const fy = edgeY + (isTop ? 2 : -2);
          ctx.fillStyle = petals[i];
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 6, fy + Math.sin(a) * 6, 4.5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = '#fff59d';
          ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (p.type === 'fence') {
      // a single wooden fence post; pointed tip aims into the gap
      const wood = ctx.createLinearGradient(x, 0, x + w, 0);
      wood.addColorStop(0, '#8d5a2b'); wood.addColorStop(0.5, '#c98d4f'); wood.addColorStop(1, '#6d4423');
      ctx.fillStyle = wood;
      ctx.strokeStyle = '#4a2c12'; ctx.lineWidth = 3;
      roundRect(x, y0, w, y1 - y0, 5); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(74,44,18,0.5)'; ctx.lineWidth = 2;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + (w / 3) * i, y0 + 8); ctx.lineTo(x + (w / 3) * i, y1 - 8); ctx.stroke();
      }
      ctx.fillStyle = wood;
      ctx.strokeStyle = '#4a2c12'; ctx.lineWidth = 3;
      ctx.beginPath();
      if (isTop) {
        ctx.moveTo(x + 3, edgeY - 26); ctx.lineTo(x + w - 3, edgeY - 26); ctx.lineTo(x + w / 2, edgeY);
      } else {
        ctx.moveTo(x + 3, edgeY + 26); ctx.lineTo(x + w - 3, edgeY + 26); ctx.lineTo(x + w / 2, edgeY);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.type === 'chocolate') {
      // floating chocolate block that bulges CHOC_D INTO the gap from the edge,
      // so it costs real clearance (nothing behind it but sky)
      const by = isTop ? edgeY : edgeY - CHOC_D;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#5d3a1a'); g.addColorStop(0.5, '#8a5a2b'); g.addColorStop(1, '#4a2a10');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#2e1808'; ctx.lineWidth = 3;
      roundRect(x, by, w, CHOC_D, 7); ctx.fill(); ctx.stroke();
      // segment grooves
      ctx.strokeStyle = 'rgba(46,24,8,0.6)'; ctx.lineWidth = 2;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + (w / 3) * i, by + 3); ctx.lineTo(x + (w / 3) * i, by + CHOC_D - 3); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x + 3, by + CHOC_D / 2); ctx.lineTo(x + w - 3, by + CHOC_D / 2); ctx.stroke();
      // happy face
      const fy = by + CHOC_D / 2;
      ctx.fillStyle = '#fff8ec';
      ctx.beginPath(); ctx.arc(x + w * 0.32, fy - 4, 3.4, 0, Math.PI * 2); ctx.arc(x + w * 0.68, fy - 4, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e1808';
      ctx.beginPath(); ctx.arc(x + w * 0.32, fy - 4, 1.6, 0, Math.PI * 2); ctx.arc(x + w * 0.68, fy - 4, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff8ec'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x + w / 2, fy + 1, 8, 0.25, Math.PI - 0.25); ctx.stroke();
    }
  }

  function drawPipe(p) {
    // visual gap edges (collision uses effGap, which only shrinks for live wires)
    const vTop = p.gapY - p.gap / 2;
    const vBot = p.gapY + p.gap / 2;
    if (SONYA_OBSTACLES[p.type]) {
      drawFriendly(p, vTop, true);
      drawFriendly(p, vBot, false);
    } else if (p.type === 'pitchfork') {
      drawPitchfork(p, vTop, true);
      drawPitchfork(p, vBot, false);
    } else if (p.type === 'oven') {
      drawOven(p, vTop, true);
      drawOven(p, vBot, false);
    } else if (p.type === 'fryer') {
      drawFryer(p, vTop, true);
      drawFryer(p, vBot, false);
    } else {
      drawWires(p, vTop, vBot);
    }
  }

  // ---------- The turkey ----------
  // Roasted turkey: golden-brown roast with drumsticks up and X eyes
  function drawRoastedTurkey() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);

    // body
    const body = ctx.createLinearGradient(0, -20, 0, 18);
    body.addColorStop(0, '#e09a4a');
    body.addColorStop(0.5, '#b5651d');
    body.addColorStop(1, '#7c3f0c');
    ctx.fillStyle = body;
    ctx.strokeStyle = '#5d2f08';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 24, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // crispy rim + glaze shine
    ctx.strokeStyle = 'rgba(93,47,8,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 13.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,220,160,0.35)';
    ctx.beginPath(); ctx.ellipse(-6, -7, 10, 5, -0.4, 0, Math.PI * 2); ctx.fill();
    // little wing
    ctx.fillStyle = '#8a4a12';
    ctx.strokeStyle = '#5d2f08';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(-4, 3, 11, 7, -0.25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // drumsticks sticking up at the back, bones out
    for (const dx of [-13, -19]) {
      ctx.strokeStyle = '#8a4a12';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(dx + 4, -8); ctx.lineTo(dx, -20); ctx.stroke();
      ctx.strokeStyle = '#f5efe0';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(dx, -20); ctx.lineTo(dx - 2, -26); ctx.stroke();
      ctx.fillStyle = '#f5efe0';
      ctx.beginPath();
      ctx.arc(dx - 3, -27, 3, 0, Math.PI * 2);
      ctx.arc(dx + 1, -27, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // X eye at the head end
    ctx.strokeStyle = '#2a1503';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(13, -9); ctx.lineTo(19, -3);
    ctx.moveTo(19, -9); ctx.lineTo(13, -3);
    ctx.stroke();

    ctx.restore();
  }

  function drawTurkey() {
    if (bird.roasted) { drawRoastedTurkey(); return; }
    const pal = birdPalette;
    ctx.save();
    ctx.translate(bird.x, bird.y);
    if (bird.onGround) ctx.translate(0, -Math.abs(Math.sin(walkCycle * 0.05)) * 2.5); // run bob
    ctx.rotate(bird.rot);

    // long little legs while running along the ground (Sonya Mode)
    if (bird.onGround) {
      const sw = Math.sin(walkCycle * 0.05);
      ctx.strokeStyle = pal.beak; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        const hipX = s * 8, hipY = 0;
        const footX = hipX + s * 5 * sw;
        const footY = 20 - Math.max(0, s * sw) * 6; // one foot lifts mid-stride
        ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(footX, footY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(footX - 4, footY); ctx.lineTo(footX + 4, footY); ctx.stroke(); // foot
      }
    }

    // tail fan (behind body)
    const featherColors = pal.tail;
    for (let i = -3; i <= 3; i++) {
      ctx.save();
      ctx.translate(-15, 2);
      ctx.rotate(Math.PI + i * 0.3);
      ctx.fillStyle = featherColors[i + 3];
      ctx.beginPath(); ctx.ellipse(0, -13, 6, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(60,20,0,0.55)';
      ctx.beginPath(); ctx.ellipse(0, -20, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // body + belly
    ctx.fillStyle = pal.body;
    ctx.strokeStyle = pal.stroke;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 23, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = pal.belly;
    ctx.beginPath(); ctx.ellipse(5, 6, 13, 9, 0, 0, Math.PI * 2); ctx.fill();

    // wing — flaps continuously, with a bigger, faster sweep right after a tap
    const wingAngle = -0.45 - Math.sin(elapsed * (16 + flapAnim * 26)) * (0.5 + flapAnim * 0.55);
    ctx.save();
    ctx.translate(-4, 0);
    ctx.rotate(wingAngle);
    ctx.fillStyle = pal.wing;
    ctx.strokeStyle = pal.wingStroke;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // feather lines on the wing
    ctx.strokeStyle = pal.wingLine;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-11 + i * 3, -5 + i * 2.5);
      ctx.quadraticCurveTo(0, -3 + i * 3, 11, -1 + i * 3.5);
      ctx.stroke();
    }
    ctx.restore();

    // head — a touch bigger, with a little feather tuft on top
    ctx.fillStyle = pal.body;
    ctx.strokeStyle = pal.stroke;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(15, -13, 11.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(12 + i * 3, -23.5);
      ctx.quadraticCurveTo(11 + i * 5, -29, 14 + i * 6, -30.5);
      ctx.stroke();
    }
    // beak
    ctx.fillStyle = pal.beak;
    ctx.strokeStyle = pal.beakStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(23, -17);
    ctx.lineTo(34, -11.5);
    ctx.lineTo(23, -7.5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // snood + wattle
    ctx.fillStyle = pal.snood;
    ctx.beginPath(); ctx.ellipse(22.5, -18, 2.6, 4.6, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(24.5, -5, 3, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    // blush cheek
    ctx.fillStyle = pal.blush;
    ctx.beginPath(); ctx.ellipse(10.5, -6, 4, 2.6, -0.2, 0, Math.PI * 2); ctx.fill();
    // eye — big and sparkly, blinks every few seconds
    if (elapsed % 3.7 < 0.12) {
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(17, -13.5, 3.5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(17, -15, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(18.4, -15, 2.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(17.5, -16, 0.9, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  function drawParticles() {
    for (const l of particles) {
      ctx.save();
      ctx.translate(l.x, l.y);
      if (l.kind === 'flake') {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.arc(0, 0, l.size, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.rotate(l.rot);
        ctx.fillStyle = l.color;
        ctx.beginPath(); ctx.ellipse(0, 0, l.size, l.size * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(60,20,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-l.size, 0); ctx.lineTo(l.size, 0); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawSteam() {
    for (const s of steam) {
      ctx.fillStyle = `rgba(255,255,255,${0.20 * s.life})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- UI overlays ----------
  function medalColor(s) {
    if (s >= 40) return '#7fffd4';
    if (s >= 30) return '#ffd700';
    if (s >= 20) return '#c0c0c0';
    if (s >= 10) return '#cd7f32';
    return null;
  }

  function drawMuteButton() {
    const cx = MUTE_BTN.cx, cy = MUTE_BTN.cy, r = MUTE_BTN.r;
    ctx.fillStyle = 'rgba(30,12,8,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(247,178,103,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // speaker body
    ctx.fillStyle = '#ffe9c9';
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 3);
    ctx.lineTo(cx - 3, cy - 3);
    ctx.lineTo(cx + 2, cy - 8);
    ctx.lineTo(cx + 2, cy + 8);
    ctx.lineTo(cx - 3, cy + 3);
    ctx.lineTo(cx - 8, cy + 3);
    ctx.closePath(); ctx.fill();
    if (muted) {
      ctx.strokeStyle = '#ff8c5a';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + 4, cy - 5); ctx.lineTo(cx + 11, cy + 5);
      ctx.moveTo(cx + 11, cy - 5); ctx.lineTo(cx + 4, cy + 5);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#ffe9c9';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx + 3, cy, 4, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 3, cy, 7, -0.9, 0.9); ctx.stroke();
    }
  }

  function drawUI() {
    drawMuteButton();
    if (state === 'play' || state === 'dead') {
      text(String(score), W / 2, 92, 52); // stays up while the roasted turkey bounces
    }
    if (state === 'ready') {
      text('FLAPPY', W / 2, H * 0.20, 42, '#ffd66b');
      text('TURKEY', W / 2, H * 0.20 + 52, 58, '#ffffff');
      text(`${cfg.icon} ${cfg.name}`, W / 2, H * 0.20 + 92, 20, '#ffd66b', 'center', 'rgba(60,20,0,0.7)', 4);
      const blink = 0.65 + 0.35 * Math.sin(elapsed * 5);
      ctx.globalAlpha = blink;
      text('Tap anywhere to flap', W / 2, H * 0.72, 24);
      if (mode === 'sonya') {
        text('Dodge bushes, fence posts, flowers & chocolates', W / 2, H * 0.72 + 34, 15, '#ffe9c9', 'center', 'rgba(60,20,0,0.7)', 4);
        text('You can run along the ground! 🏃', W / 2, H * 0.72 + 56, 15, '#ffe9c9', 'center', 'rgba(60,20,0,0.7)', 4);
      } else {
        text('Dodge ovens, deep fryers, pitchforks & live wires', W / 2, H * 0.72 + 34, 15, '#ffe9c9', 'center', 'rgba(60,20,0,0.7)', 4);
      }
      ctx.globalAlpha = 1;
      if (best > 0) text('Best: ' + best, W / 2, H * 0.72 + 88, 18, '#ffd66b', 'center', 'rgba(60,20,0,0.7)', 4);
    }
    // game-over panel waits until the roasted turkey has landed and settled
    // (5s fallback so it can never get stuck hidden)
    if (gameOverVisible()) {
      const px = W / 2 - 150, py = H * 0.30, pw = 300, ph = 215;
      ctx.fillStyle = 'rgba(30,12,8,0.85)';
      roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = '#f7b267'; ctx.lineWidth = 3;
      roundRect(px, py, pw, ph, 16); ctx.stroke();
      text('GAME OVER', W / 2, py + 38, 30, '#ff8c5a');
      const mc = medalColor(score);
      if (mc) {
        ctx.fillStyle = mc;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(px + 52, py + 105, 24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        text('★', px + 52, py + 106, 24, '#5d3313', 'center', 'rgba(0,0,0,0)', 0);
      }
      text('SCORE', px + 118, py + 82, 15, '#ffe9c9', 'left', 'rgba(0,0,0,0)', 0);
      text(String(score), px + 118, py + 108, 34);
      text('BEST', px + 118, py + 136, 15, '#ffe9c9', 'left', 'rgba(0,0,0,0)', 0);
      text(String(best), px + 118, py + 160, 24, '#ffd66b');
      const blink = 0.6 + 0.4 * Math.sin(elapsed * 6);
      ctx.globalAlpha = blink;
      text('Tap to play again', W / 2, py + ph - 24, 19);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Draw ----------
  function draw() {
    // sky + scenery: while a transition runs, the old scene slides out left and
    // the new one slides in from the right, each exactly one screen wide
    if (sceneTransition) {
      const p = sceneTransition.t;
      ctx.save(); ctx.translate(-p * W, 0); drawSceneSky(sceneTransition.from); ctx.restore();
      ctx.save(); ctx.translate((1 - p) * W, 0); drawSceneSky(sceneTransition.to); ctx.restore();
    } else {
      drawSceneSky(sceneIndex);
    }
    drawParticles();            // leaves/snowflakes fall behind the obstacles
    for (const p of pipes) drawPipe(p);
    // the ground strip slides with the scenery, so the whole scene flies by
    if (sceneTransition) {
      const p = sceneTransition.t;
      ctx.save(); ctx.translate(-p * W, 0); drawSceneGround(sceneTransition.from); ctx.restore();
      ctx.save(); ctx.translate((1 - p) * W, 0); drawSceneGround(sceneTransition.to); ctx.restore();
    } else {
      drawSceneGround(sceneIndex);
    }
    drawTurkey();
    drawSteam();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawUI();
  }

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30); // clamp huge frames (tab switch etc.)
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Mode picker (Sonya Mode hidden until the dev gate is opened) ----------
  const pickerEl = document.getElementById('mode-picker');
  const pickCalvin = document.getElementById('pick-calvin');
  const pickSonya = document.getElementById('pick-sonya');

  function pickMode(m, save = true) {
    if (!MODES[m]) return;
    if (m === 'sonya' && !devUnlocked) return; // dev gate — LAUNCH: remove
    mode = m;
    cfg = MODES[m];
    try { if (save) localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    if (pickCalvin && pickSonya) {
      pickCalvin.classList.toggle('active', m === 'calvin');
      pickSonya.classList.toggle('active', m === 'sonya');
    }
    if (window.FLAPPY && window.FLAPPY.ui.setMode) window.FLAPPY.ui.setMode(m);
  }

  function syncPicker() {
    if (!pickerEl) return;
    pickerEl.classList.toggle('hidden', !(devUnlocked && state === 'ready'));
    if (pickSonya) pickSonya.classList.toggle('hidden', !devUnlocked);
  }

  if (pickerEl) {
    // taps on the picker must never flap the turkey — the game listens on window
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) {
      pickerEl.addEventListener(ev, (e) => e.stopPropagation());
    }
    if (pickCalvin) pickCalvin.addEventListener('click', () => pickMode('calvin'));
    if (pickSonya) pickSonya.addEventListener('click', () => pickMode('sonya'));
    pickMode(mode, false); // apply the remembered mode + highlight
  }

  reset();
  requestAnimationFrame(frame);

  // read-only handle for testing/debugging
  window.__flappy = {
    get state() { return state; },
    get score() { return score; },
    get muted() { return muted; },
    get vy() { return bird ? bird.vy : 0; },
    get x() { return bird ? Math.round(bird.x) : 0; },
    get y() { return bird ? Math.round(bird.y) : 0; },
    get bounces() { return bird ? bird.bounces : 0; },
    get roasted() { return bird ? !!bird.roasted : false; },
    get resting() { return bird ? !!bird.resting : false; },
    get rot() { return bird ? bird.rot : 0; },
    get deadTimer() { return deadTimer; },
    get gameOverShown() { return gameOverVisible(); },
    get boardOffered() { return boardOffered; },
    get scene() { return sceneIndex; },
    get sceneName() { return SCENE_NAMES[sceneIndex]; },
    get sceneTransition() {
      return sceneTransition
        ? { from: sceneTransition.from, to: sceneTransition.to, t: Math.round(sceneTransition.t * 1000) / 1000 }
        : null;
    },
    get difficulty() { return Math.round(difficultyProgress(score) * 1000) / 1000; },
    sceneForScore(s) { return sceneFor(s); }, // pure mapping: score -> scene index
    get mode() { return mode; },
    get devUnlocked() { return devUnlocked; },
    get onGround() { return bird ? !!bird.onGround : false; },
    get walkCycle() { return Math.round(walkCycle * 100) / 100; },
    get speed() { return speed; },
    get palette() { return { ...birdPalette }; },
    get obstacles() { return JSON.parse(JSON.stringify(cfg.obstacles)); },
    get hitShape() { return BIRD_HIT.map((c) => ({ ...c })); },
    hitRectsFor(p, top, bot) { return pipeHitRects(p, top, bot); },
    get pipes() { return pipes.map((p) => ({ x: Math.round(p.x), type: p.type, w: p.w, hitW: p.hitW, gap: Math.round(p.gap), gapY: Math.round(p.gapY) })); },
    pickMode(m) { pickMode(m); reset(); }, // test hook: switch mode and restart
    restart() { if (state === 'dead') reset(); }, // used by the leaderboard overlay's "Play again"
  };
})();
