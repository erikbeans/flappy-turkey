# Flappy Turkey 🦃

A Thanksgiving-themed Flappy Bird clone that runs in any web browser.

## Play online

The game is hosted on **GitHub Pages**:

👉 **https://erikbeans.github.io/flappy-turkey/**

## How to run locally

No build step and no dependencies. Either:

- Open `index.html` directly in a browser, **or**
- Serve the folder (recommended, e.g. for mobile testing on your network):

  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

## How to play

- **Tap / click anywhere on the screen** to flap. That is the only control.
- The **speaker button** in the top-right corner toggles all sound effects on/off (tapping it does not flap). The setting is saved in `localStorage`.
- Fly the turkey through the gaps between obstacles. Each type has its own width:
  - **Ovens** — steel range with a glowing fire door (widest, 108px)
  - **Deep fryers** — vat of bubbling oil at the gap edge (96px)
  - **Pitchforks** 🍴 — wooden handle with a steel trident head (80px)
  - **Live wires** ⚡ — swaying cable with sparking tips; only the cable and its sparks are dangerous (36px hitbox, sprite drawn to match)
- A path through every gap is always guaranteed: gap centers never jump more than 200px between obstacles, and the gap never shrinks below what fits the turkey.
- Each obstacle you pass = 1 point. Best score is saved in `localStorage`.
- The game speeds up and the gaps shrink slightly as your score grows — and the background scenery changes with each difficulty stage (sunset → oak forest → lake → snow).
- Hit an obstacle and the turkey gets **roasted** 🥘 — it tumbles, bounces off the floor a couple of times, and comes to rest. The game-over panel only appears once the turkey is lying on the ground.
- Hitboxes match the drawn sprites: obstacles only hurt where you see them (live wires are only dangerous at the cable and its sparks, pitchforks at handle + trident head, fryers including the oil bulge), and the turkey's collision outline covers its visible body — no invisible edges, no unpunished overlaps.

## Game modes 🎮

- **🦃 Calvin Mode** — the original game described above: difficulty ramps with score, touching the ground ends the run.
- **🌈 Sonya Mode** — a much easier, friendlier mode: one fixed easy difficulty for the whole game (gap 210px, speed 140px/s, spacing 360px, gentler gap jumps), a randomly recolored crazy bird (purple/teal/yellow/…) each run, friendly obstacles (bushes, fence posts, flower bushes, happy chocolates), **uneven obstacle spacing** (runs of 1–3 missing obstacles), and the turkey can **walk/run along the ground** instead of dying there. The scenery still changes with score, same as Calvin Mode.
- The mode is picked on the ready screen at the start of each session (last choice remembered). Leaderboards are **separate per mode** (tabs on the 🏆 panel); cumulative flap/gate stats are combined across modes.
- While Sonya Mode is in development it is hidden behind a dev flag: set `localStorage.flappyDev = '1'` to see the picker and the Sonya tab. **At launch, remove the `devUnlocked` gate in `game.js`/`leaderboard.js`.**

## Global leaderboard (top 100) 🏆

- The **🏆 button** (top-left) opens the global leaderboard at any time — top 100 scores from all players, with a tab per game mode.
- After each game over (score > 0), the leaderboard opens automatically — but only once the roasted turkey has finished bouncing and come to rest, so the death animation always plays out first. The game-over panel waits for the same moment.
- At the bottom of the board, small print shows **cumulative all-player stats**: total flaps and
  gates cleared by everyone, plus today's counts since midnight **Pacific time**. The game reports
  its flaps/gates to the server after every game over (validated with the same signed run token,
  counted separately from leaderboard submissions, so even unsubmitted games count).
- Scores are stored in a **Cloudflare Worker + D1** backend (`worker/`) with server-side validation:
  the server signs each run at start (HMAC token), scores are single-use, capped by elapsed time
  (the game can't score faster than ~0.91 pts/s), per-IP per-endpoint rate limited, and CORS-locked to the Pages origin.
- The API URL lives in `config.js` (`apiBase`). Until it's set (or if the API is unreachable),
  the game falls back to a per-device local leaderboard so it always works.

## Hosting

- **Site**: GitHub Pages, deployed automatically on every push to `main`
  (`.github/workflows/pages.yml`). Repo: `erikbeans/flappy-turkey`,
  live at https://erikbeans.github.io/flappy-turkey/
- **API**: Cloudflare Worker `flappy-turkey-leaderboard` + D1 database `flappy-turkey-scores`.
  Deploy steps are in `worker/README.md` (`wrangler d1 create` → schema → secret → `wrangler deploy`),
  then paste the worker URL into `config.js`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell + canvas + leaderboard overlay markup |
| `style.css` | Fullscreen layout, portrait aspect ratio, touch handling, leaderboard styles |
| `game.js` | All game logic and canvas rendering (turkey, obstacles, physics, particles, sound) |
| `leaderboard.js` | Leaderboard client + UI (fetches top 100, submits scores, local fallback) |
| `config.js` | Runtime config — `apiBase` of the leaderboard Worker |
| `worker/` | Cloudflare Worker + D1 backend for the leaderboard (see `worker/README.md`) |

## Tuning

All gameplay constants (gravity, flap impulse, pipe speed/gap, obstacle spacing)
live at the top of `game.js` in the "Tuning constants" section — tweak them to
change the feel of the game.

### Difficulty in numbers (current values)

The canvas is **432×768 px**, the ground takes the bottom **92 px**, so the playable
height is **676 px**. The turkey's hitbox (`BIRD_HIT`, 11 circles) is about
**66 px wide × 49 px tall**.

**Physics (how the turkey flies):**

| Quantity | Formula | Current value |
| --- | --- | --- |
| Flap apex height | `FLAP_VY² / (2·GRAVITY)` | 560²/3800 = **82.5 px** (~12% of playable height) |
| Time to flap apex | `FLAP_VY / GRAVITY` | **0.29 s** (full up-down cycle ≈ 0.59 s) |
| Time to terminal fall speed | `MAX_FALL / GRAVITY` | **0.5 s** (covers 237 px) |
| Full-screen fall from rest | — | **≈ 0.96 s** |

**Obstacle flow (how the world scrolls), by score `s`:**

| Quantity | Formula | Value at s=0 | Value at max |
| --- | --- | --- | --- |
| Scroll speed | `BASE_SPEED + min(MAX_SPEED_BONUS, SPEED_RAMP·s)` | 170 px/s | **270 px/s** (reached at s=60) |
| Reaction time between obstacles | `PIPE_SPACING / speed` | **1.88 s** | **1.19 s** (−37%) |
| Gap size | `max(MIN_GAP, BASE_GAP − GAP_SHRINK·s)` | 180 px | **138 px** (at s=60) |
| Clearance per side of turkey | `(gap − 49)/2` | 65.5 px | **44.5 px** |
| Live-wires effective gap | `max(136, gap − ELEC_SHRINK)` | 156 px (53.5 px/side) | **136 px** (43.5 px/side) |
| Fryer vat bulge eats | 18 px into the gap, each side | eff. clearance 47.5 px/side | **26.5 px/side** |
| Pitchfork trident head | full 80 px wide × 34 px deep at gap edge | — | — |
| Time spent inside an obstacle | `hitW / speed` | oven 0.64 s · fryer 0.56 s · pitchfork head 0.20 s · wires 0.21 s | oven 0.40 s … |
| Obstacle mix | uniform over 4 types | **25% each** | — |
| Gap-center vertical range | margin 130 top/bottom | [220, 456] → **236 px** of room | shrinks with gap |
| Max gap-center jump between obstacles | `MAX_GAP_JUMP` | **200 px** (guaranteed reachable) | — |
| Max theoretical score rate | `speed / PIPE_SPACING` | 0.53 pts/s | 0.84 pts/s |

**Progression curve (4 stages — the 4th row is maximum hardness):**

| Stage (score) | Speed | Reaction time | Gap | Clearance/side |
| --- | --- | --- | --- | --- |
| 1 (s=0) | 170 px/s | 1.88 s | 180 px | 65.5 px |
| 2 (s=20) | 203 px/s | 1.57 s | 166 px | 58.5 px |
| 3 (s=40) | 237 px/s | 1.35 s | 152 px | 51.5 px |
| 4 (s=60) — **max** | 270 px/s | 1.19 s | **138 px** | **44.5 px** |

The background scenery follows these 4 stages — entering a new stage slides the old
scene away (at world-scroll speed, as if the turkey flew out of it) and into the next:
**sunset** (stage 1) → **oak forest** (stage 2) → **lake** (stage 3) → **snow**
(stage 4, max hardness). The stage boundaries are derived from the speed/gap ramp
formulas above, so they move automatically if the tuning knobs change.

### Which knob makes it harder (increase the value)

| Knob | Harder when… | Notes |
| --- | --- | --- |
| `GRAVITY` | ↑ increased | faster falls, lower flap apex (`h ∝ 1/GRAVITY`) |
| `FLAP_VY` (negative) | ↓ closer to 0 | weaker flap — apex is quadratic: `h ∝ FLAP_VY²`, so −10% flap = −19% height |
| `MAX_FALL` | ↑ | harder to recover from dives |
| `BASE_SPEED` | ↑ | reaction time = `PIPE_SPACING / speed` |
| `SPEED_RAMP` | ↑ | max speed reached at score `MAX_SPEED_BONUS / SPEED_RAMP` |
| `MAX_SPEED_BONUS` | ↑ | higher top speed |
| `PIPE_SPACING` | ↓ decreased | **inverted**: less reaction time |
| `BASE_GAP` / `MIN_GAP` | ↓ decreased | smaller gaps; clearance/side = `(gap − 49)/2` |
| `GAP_SHRINK` | ↑ | min gap reached at score `(BASE_GAP − MIN_GAP)/GAP_SHRINK` |
| `MAX_GAP_JUMP` | ↓ decreased | **inverted**: less vertical freedom between gaps |
| `ELEC_SHRINK` | ↑ | live wires eat more of the gap |
| obstacle `w` / `hitW` | ↑ | longer exposure per obstacle |
| spawn `margin` (130) | ↓ decreased | **inverted**: gaps can hug the top/bottom edges |

### Asking for a change in plain terms

You can ask in terms of the metrics above, e.g.:

- *"Reaction time should never drop below 1.2 s"* → set `PIPE_SPACING ≥ 1.2 × (BASE_SPEED + MAX_SPEED_BONUS)` = 324
- *"Gap should never go below 120 px"* → `MIN_GAP = 120` (≈35 px clearance per side)
- *"Top speed at score 30"* → `SPEED_RAMP = MAX_SPEED_BONUS / 30`
- *"Flap should reach 100 px high"* → `FLAP_VY = −√(2·GRAVITY·100)` ≈ −616
- *"Easier early game, brutal late game"* → lower `BASE_SPEED`/`BASE_GAP`, raise `SPEED_RAMP`/`GAP_SHRINK`, lower `MIN_GAP`
