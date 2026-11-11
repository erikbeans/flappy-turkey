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
  // Collision outline: local-space circles tracing the drawn turkey's shape.
  // They are rotated with the bird and each tested against the obstacles,
  // so the hitbox matches what you actually see on screen.
  const BIRD_HIT = [
    { x: 0,    y: 0,   r: 17 },   // body
    { x: 12,   y: 0,   r: 13 },
    { x: -12,  y: 0,   r: 13 },
    { x: 15,   y: -13, r: 11.5 }, // head
    { x: 15,   y: -28, r: 7 },    // head tuft
    { x: 28.5, y: -12, r: 6 },    // beak
    { x: 24,   y: -4,  r: 5 },    // wattle
    { x: -19,  y: 1,   r: 10 },   // tail fan
  ];
  // Obstacle types — each has its own width (some wider than the old pipe)
  const OBSTACLES = {
    oven:      { w: 108 },
    fryer:     { w: 96 },
    pitchfork: { w: 80 },
    wires:     { w: 64 },
  };
  const MAX_GAP_JUMP = 210;    // max vertical move between consecutive gaps (guarantees a path)
  const BASE_GAP = 180;        // starting gap between obstacles
  const MIN_GAP = 142;         // smallest gap (at high scores)
  const GAP_SHRINK = 1.1;      // px of gap lost per point
  const BASE_SPEED = 178;      // px/s horizontal scroll speed
  const SPEED_RAMP = 2.0;      // px/s gained per point
  const MAX_SPEED_BONUS = 90;
  const PIPE_SPACING = 295;    // horizontal distance between obstacles
  const GROUND_H = 92;
  const ELEC_SHRINK = 24;      // electric aura eats only this much of the safe gap
  const ROAST_BOUNCES = 2;     // floor bounces after the turkey is roasted
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
  let bird, pipes, leaves, clouds, steam;
  let score, best, distance, speed;
  let flapAnim, flash, deadTimer, leafAcc, steamAcc, elapsed;

  best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  function toggleMute() {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (!muted) sfx.ensure();
  }

  function reset() {
    if (window.FLAPPY) window.FLAPPY.ui.hide();
    bird = { x: BIRD_X, y: H * 0.42, vy: 0, vx: 0, rot: 0, roasted: false, bounces: 0, resting: false };
    pipes = [];
    leaves = [];
    steam = [];
    score = 0;
    distance = 0;
    speed = BASE_SPEED;
    flapAnim = 0;
    flash = 0;
    deadTimer = 0;
    leafAcc = 0;
    steamAcc = 0;
    elapsed = 0;
    state = 'ready';
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
      if (window.FLAPPY) window.FLAPPY.api.startRun(); // get a signed run token for the leaderboard
      flap();
    } else if (state === 'play') {
      flap();
    } else if (state === 'dead' && deadTimer > 0.8) {
      reset();
    }
  }

  function flap() {
    bird.vy = FLAP_VY;
    flapAnim = 1;
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
    return p.type === 'wires' ? Math.max(120, p.gap - ELEC_SHRINK) : p.gap;
  }

  function spawnPipe() {
    const gap = Math.max(MIN_GAP, BASE_GAP - score * GAP_SHRINK);
    const margin = 130;
    let gapY = margin + gap / 2 + Math.random() * (H - GROUND_H - 2 * margin - gap);
    // guarantee the next gap is reachable from the previous one
    if (pipes.length) {
      const prev = pipes[pipes.length - 1].gapY;
      const lo = Math.max(margin + gap / 2, prev - MAX_GAP_JUMP);
      const hi = Math.min(H - GROUND_H - margin - gap / 2, prev + MAX_GAP_JUMP);
      gapY = Math.max(lo, Math.min(hi, gapY));
    }
    const types = Object.keys(OBSTACLES);
    const type = types[(Math.random() * types.length) | 0];
    const x = pipes.length ? pipes[pipes.length - 1].x + PIPE_SPACING : W + 80;
    pipes.push({ x, gapY, gap, type, w: OBSTACLES[type].w, scored: false });
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

  function hitsPipe(p, circles, top, bot) {
    for (const c of circles) {
      if (circleRect(c.x, c.y, c.r, p.x, -20, p.w, top + 20) ||
          circleRect(c.x, c.y, c.r, p.x, bot, p.w, H - bot + 20)) return true;
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
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    // offer the global leaderboard once the game-over panel is up
    if (window.FLAPPY && score > 0) {
      setTimeout(() => { if (state === 'dead') window.FLAPPY.ui.show(score); }, 700);
    }
  }

  // ---------- Update ----------
  function update(dt) {
    elapsed += dt;

    // drifting clouds always move
    for (const c of clouds) {
      c.x -= c.v * dt;
      if (c.x < -140 * c.s) { c.x = W + 140 * c.s; c.y = 60 + Math.random() * 220; }
    }

    // falling leaves always drift
    leafAcc += dt * 7;
    while (leafAcc > 1) {
      leafAcc -= 1;
      leaves.push({
        x: Math.random() * W, y: -12,
        vy: 40 + Math.random() * 55,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 1.5 + Math.random() * 2.5,
        size: 4 + Math.random() * 4.5,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 4,
        color: ['#c0392b', '#e67e22', '#f1c40f', '#d35400', '#a93226'][(Math.random() * 5) | 0],
      });
    }
    for (const l of leaves) {
      l.y += l.vy * dt;
      l.x += Math.sin(elapsed * l.swaySpeed + l.sway) * 34 * dt;
      l.rot += l.vr * dt;
    }
    leaves = leaves.filter((l) => l.y < H + 20);

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
      speed = BASE_SPEED + Math.min(MAX_SPEED_BONUS, score * SPEED_RAMP);
      distance += speed * dt;

      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
      bird.y += bird.vy * dt;

      if (!pipes.length || pipes[pipes.length - 1].x < W - PIPE_SPACING) spawnPipe();
      const ext = birdExtents();
      for (const p of pipes) {
        p.x -= speed * dt;
        const g = effGap(p);
        const top = p.gapY - g / 2, bot = p.gapY + g / 2;
        if (!p.scored && p.x + p.w < ext.minX) {
          p.scored = true;
          score++;
          sfx.point();
        }
        if (hitsPipe(p, ext.circles, top, bot)) {
          die(true);
        }
      }
      pipes = pipes.filter((p) => p.x > -p.w - 60);

      const ext2 = birdExtents();
      if (ext2.maxY >= H - GROUND_H) {
        bird.y -= (ext2.maxY - (H - GROUND_H));
        die(false);
      }
      if (ext2.minY < 0) { bird.y -= ext2.minY; bird.vy = Math.max(bird.vy, 0); }
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
            flash = 1;
            sfx.hit();
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
    } else {
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

  // ---------- Background: Thanksgiving sunset ----------
  const trees = [
    { x: 40, y: H * 0.845, r: 26, c: '#d35400' },
    { x: 110, y: H * 0.865, r: 32, c: '#c0392b' },
    { x: 200, y: H * 0.85, r: 24, c: '#e67e22' },
    { x: 300, y: H * 0.868, r: 34, c: '#f39c12' },
    { x: 390, y: H * 0.85, r: 27, c: '#a93226' },
  ];

  function drawBackground() {
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

    // clouds
    ctx.fillStyle = 'rgba(255,235,220,0.45)';
    for (const c of clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 46 * c.s, 16 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 28 * c.s, c.y + 6 * c.s, 32 * c.s, 13 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - 30 * c.s, c.y + 7 * c.s, 28 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

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

  function drawGround() {
    const gy = H - GROUND_H;
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(0, gy, W, GROUND_H);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    const off = -(distance % 48);
    for (let x = off; x < W; x += 48) ctx.fillRect(x, gy + 34, 24, GROUND_H - 34);
    ctx.fillStyle = '#8aa845';
    ctx.fillRect(0, gy, W, 18);
    ctx.fillStyle = '#a4c25a';
    ctx.fillRect(0, gy, W, 5);
  }

  // ---------- Obstacles ----------
  function drawPitchfork(p, edgeY, isTop) {
    const x = p.x, w = p.w;
    const y0 = isTop ? -20 : edgeY;
    const h = isTop ? edgeY + 20 : H - GROUND_H - edgeY + 20;
    // wooden handle
    const hx = x + (w - 22) / 2;
    const wood = ctx.createLinearGradient(hx, 0, hx + 22, 0);
    wood.addColorStop(0, '#7a4a21');
    wood.addColorStop(0.5, '#a06a34');
    wood.addColorStop(1, '#5d3717');
    ctx.fillStyle = wood;
    roundRect(hx, y0, 22, h, 6); ctx.fill();
    ctx.strokeStyle = '#3f2410'; ctx.lineWidth = 3;
    roundRect(hx, y0, 22, h, 6); ctx.stroke();
    // steel trident head at the gap end; tines point into the gap
    const metal = ctx.createLinearGradient(x, 0, x + w, 0);
    metal.addColorStop(0, '#90a4ae');
    metal.addColorStop(0.5, '#eceff1');
    metal.addColorStop(1, '#607d8b');
    ctx.fillStyle = metal;
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = 3;
    // crossbar
    const barY = isTop ? edgeY - 34 : edgeY + 22;
    roundRect(x - 4, barY, w + 8, 12, 4); ctx.fill(); ctx.stroke();
    // three tines
    for (let i = 0; i < 3; i++) {
      const tx = x + 12 + i * ((w - 24) / 2);
      const ty0 = isTop ? edgeY - 22 : edgeY + 12;
      const tipY = isTop ? edgeY : edgeY + 34;
      ctx.beginPath();
      ctx.moveTo(tx, ty0);
      ctx.lineTo(tx + 9, ty0);
      ctx.lineTo(tx + 4.5, tipY);
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
    const fringe = (p.gap - effGap(p)) / 2 + 6; // sparks reach a little past the collision edge
    const sway = Math.sin(elapsed * 2 + p.x) * 4;
    const flicker = 0.5 + 0.5 * Math.sin(elapsed * 21 + p.x);

    // faint aura around the cables
    ctx.fillStyle = `rgba(0,229,255,${0.04 + 0.04 * flicker})`;
    ctx.fillRect(x - 8, -20, w + 16, top + 20);
    ctx.fillRect(x - 8, bot, w + 16, H - GROUND_H - bot + 20);

    // cable bodies (top hangs down, bottom rises up)
    ctx.save();
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 10 + 8 * flicker;
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
        const tipY = baseY + dir * 16;
        ctx.strokeStyle = wireCols[i];
        ctx.beginPath();
        ctx.moveTo(cx + sway, baseY);
        ctx.quadraticCurveTo(cx + sway + off * 1.5, baseY + dir * 8, tipX, tipY);
        ctx.stroke();
        tips.push({ x: tipX, y: tipY });
      }
      ctx.save();
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#b3faff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      for (const t of tips) {
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        for (let s = 1; s <= 3; s++) {
          ctx.lineTo(t.x + (Math.random() - 0.5) * 10, t.y + dir * (fringe * s) / 3);
        }
        ctx.stroke();
      }
      ctx.restore();
    };
    drawWireEnd(top - 6, +1);  // top cable sparks point down into the gap
    drawWireEnd(bot + 6, -1);  // bottom cable sparks point up into the gap
  }

  function drawPipe(p) {
    // visual gap edges (collision uses effGap, which only shrinks for live wires)
    const vTop = p.gapY - p.gap / 2;
    const vBot = p.gapY + p.gap / 2;
    if (p.type === 'pitchfork') {
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
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);

    // tail fan (behind body)
    const featherColors = ['#b03a2e', '#d35400', '#f39c12', '#ca6f1e', '#a04000', '#e59866', '#922b21'];
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
    ctx.fillStyle = '#8f4f1d';
    ctx.strokeStyle = '#5d3313';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 23, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d99a55';
    ctx.beginPath(); ctx.ellipse(5, 6, 13, 9, 0, 0, Math.PI * 2); ctx.fill();

    // wing — flaps continuously, with a bigger, faster sweep right after a tap
    const wingAngle = -0.45 - Math.sin(elapsed * (16 + flapAnim * 26)) * (0.5 + flapAnim * 0.55);
    ctx.save();
    ctx.translate(-4, 0);
    ctx.rotate(wingAngle);
    ctx.fillStyle = '#6e3a12';
    ctx.strokeStyle = '#4a2408';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // feather lines on the wing
    ctx.strokeStyle = 'rgba(74,36,8,0.7)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-11 + i * 3, -5 + i * 2.5);
      ctx.quadraticCurveTo(0, -3 + i * 3, 11, -1 + i * 3.5);
      ctx.stroke();
    }
    ctx.restore();

    // head — a touch bigger, with a little feather tuft on top
    ctx.fillStyle = '#8f4f1d';
    ctx.strokeStyle = '#5d3313';
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
    ctx.fillStyle = '#f5a623';
    ctx.strokeStyle = '#c77f0a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(23, -17);
    ctx.lineTo(34, -11.5);
    ctx.lineTo(23, -7.5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // snood + wattle
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.ellipse(22.5, -18, 2.6, 4.6, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(24.5, -5, 3, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    // blush cheek
    ctx.fillStyle = 'rgba(231,76,60,0.45)';
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

  function drawLeaves() {
    for (const l of leaves) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.fillStyle = l.color;
      ctx.beginPath(); ctx.ellipse(0, 0, l.size, l.size * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(60,20,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-l.size, 0); ctx.lineTo(l.size, 0); ctx.stroke();
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
    if (state === 'play' || (state === 'dead' && deadTimer < 0.55)) {
      text(String(score), W / 2, 92, 52);
    }
    if (state === 'ready') {
      text('FLAPPY', W / 2, H * 0.20, 42, '#ffd66b');
      text('TURKEY', W / 2, H * 0.20 + 52, 58, '#ffffff');
      const blink = 0.65 + 0.35 * Math.sin(elapsed * 5);
      ctx.globalAlpha = blink;
      text('Tap anywhere to flap', W / 2, H * 0.60, 24);
      text('Dodge ovens, deep fryers, pitchforks & live wires', W / 2, H * 0.60 + 34, 15, '#ffe9c9', 'center', 'rgba(60,20,0,0.7)', 4);
      ctx.globalAlpha = 1;
      if (best > 0) text('Best: ' + best, W / 2, H * 0.60 + 66, 18, '#ffd66b', 'center', 'rgba(60,20,0,0.7)', 4);
    }
    if (state === 'dead' && deadTimer > 0.55 && (bird.resting || deadTimer > 2.5)) {
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
    drawBackground();
    drawLeaves();               // leaves fall in the background, behind obstacles
    for (const p of pipes) drawPipe(p);
    drawGround();
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
    get hitShape() { return BIRD_HIT.map((c) => ({ ...c })); },
    get pipes() { return pipes.map((p) => ({ x: Math.round(p.x), type: p.type, w: p.w, gapY: Math.round(p.gapY) })); },
    restart() { if (state === 'dead') reset(); }, // used by the leaderboard overlay's "Play again"
  };
})();
