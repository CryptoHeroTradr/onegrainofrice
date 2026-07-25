/**
 * pm2 process definitions for onegrainofrice.
 *
 * Defines BOTH processes that make up the site so a single `pm2 start` (and
 * `pm2 save`) brings the whole thing back after a reboot:
 *
 *   - onegrainofrice   Next.js app (basePath /onegrainofrice) on :3006
 *   - oneg-grains-ws   grains realtime WebSocket writer on :3007 (sole DB writer)
 *
 * Deploy / restart:
 *     pm2 startOrReload ecosystem.config.js --update-env
 *     pm2 save
 *   (First time replacing the older ad-hoc `pnpm start` process:
 *     pm2 delete onegrainofrice 2>/dev/null; pm2 start ecosystem.config.js && pm2 save)
 *   Reboot resurrection is already wired via the enabled pm2-deploy.service.
 *
 * Secrets are NOT hard-coded here. GRAINS_* are read from `.env.local` at
 * pm2-start time (loadEnv below) and injected into BOTH apps' env — the Next
 * session route signs the grain_vid cookie with GRAINS_COOKIE_SECRET, and the
 * WS server hashes IPs with GRAINS_IP_SALT, so both need them. Next also loads
 * .env.local itself; injecting here just guarantees parity. Keep `.env.local`
 * out of git (already covered by .gitignore).
 */

const fs = require("node:fs");
const path = require("node:path");

/** Minimal .env parser (no dependency): KEY=VALUE lines, # comments, quotes. */
function loadEnv(file) {
  const out = {};
  try {
    const text = fs.readFileSync(path.join(__dirname, file), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch {
    // No .env.local (e.g. secrets provided via the shell env instead) — fine.
  }
  return out;
}

const grainsEnv = loadEnv(".env.local");

const common = {
  cwd: __dirname,
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  merge_logs: true,
  log_date_format: "YYYY-MM-DD HH:mm:ss",
};

module.exports = {
  apps: [
    {
      ...common,
      name: "onegrainofrice",
      // Run Next's real JS entry under node. (The node_modules/.bin/next shim is
      // a /bin/sh script — pm2's fork mode runs `script` with node, which can't
      // parse a shell shim.)
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3006",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3006",
        ...grainsEnv,
      },
    },
    {
      ...common,
      name: "oneg-grains-ws",
      // Run the TypeScript server via node's tsx loader. (Same reason as above:
      // node_modules/.bin/tsx is a shell shim, so we invoke node --import tsx on
      // the .ts entry directly — the working `pnpm grains:ws` invocation.)
      script: "server/grains-ws/index.ts",
      interpreter: "node",
      node_args: "--import tsx",
      instances: 1, // MUST stay 1: this is the sole DB writer.
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: "256M",
      kill_timeout: 4000, // give the SIGTERM shutdown handler time to close sockets
      env: {
        NODE_ENV: "production",
        ...grainsEnv,
      },
    },
  ],
};
