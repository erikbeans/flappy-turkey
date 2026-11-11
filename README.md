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
  - **Live wires** ⚡ — swaying cable with sparking tips; only a small fringe at the gap edges is dangerous (64px)
- A path through every gap is always guaranteed: gap centers never jump more than 210px between obstacles, and the gap never shrinks below what fits the turkey.
- Each obstacle you pass = 1 point. Best score is saved in `localStorage`.
- The game speeds up and the gaps shrink slightly as your score grows.
- Hit an obstacle and the turkey gets **roasted** 🥘 — it tumbles, bounces off the floor a couple of times, and comes to rest. That's game over.

## Global leaderboard (top 100) 🏆

- The **🏆 button** (top-left) opens the global leaderboard at any time — top 100 scores from all players.
- After each game over (score > 0), the leaderboard opens automatically: enter your name and hit **Submit** to add your score.
- Scores are stored in a **Cloudflare Worker + D1** backend (`worker/`) with server-side validation:
  the server signs each run at start (HMAC token), scores are single-use, capped by elapsed time
  (the game can't score faster than ~0.91 pts/s), rate-limited per IP, and CORS-locked to the Pages origin.
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
