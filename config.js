/* Flappy Turkey runtime configuration.
 *
 * apiBase — base URL of the leaderboard API (Cloudflare Worker + D1).
 * Deploy the worker from ./worker (see worker/README.md) and paste its URL here,
 * e.g. https://flappy-turkey-leaderboard.<your-subdomain>.workers.dev
 *
 * Leave the REPLACE_ME value (or empty) to run in offline mode:
 * scores are then kept in a per-device local leaderboard only.
 */
window.FLAPPY_CONFIG = {
  apiBase: 'REPLACE_ME_WITH_WORKER_URL',
};
