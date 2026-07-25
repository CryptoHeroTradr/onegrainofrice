/**
 * Grains WS load test (scratch tooling — safe to keep, not shipped to clients).
 *
 * Spawns the WS server against a throwaway DB, connects N concurrent clients
 * (each a distinct vid + IP + country, mimicking the real client's 450ms grain
 * batching), then reports: connect success, grains intended vs persisted (DB
 * consistency), the observed broadcast/tick rate (throttle), and server RSS
 * (memory). Numbers land in docs/grains/LOADTEST.md.
 *
 *   pnpm exec tsx scripts/grains-loadtest.ts            # defaults
 *   CLIENTS=300 DURATION=20 CLICKS_PER_SEC=8 pnpm exec tsx scripts/grains-loadtest.ts
 */

import { spawn, execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { WebSocket } from "ws";

const REPO = path.resolve(__dirname, "..");
const CLIENTS = Number(process.env.CLIENTS ?? 200);
const DURATION = Number(process.env.DURATION ?? 15); // seconds of clicking
const CLICKS_PER_SEC = Number(process.env.CLICKS_PER_SEC ?? 8); // per client
const FLUSH_MS = 450; // matches the real client's batch cadence
const MAX_PER_SEC = 20; // server clamp (default)
const PORT = 3994;
const COUNTRIES = [
  ["US", "United States"], ["JP", "Japan"], ["GB", "United Kingdom"], ["BR", "Brazil"],
  ["IN", "India"], ["DE", "Germany"], ["NG", "Nigeria"], ["XX", "Unknown"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grains-load-"));
  const DB = path.join(tmp, "grains.db");
  const SECRET = "loadtest-cookie-secret-0123456789abcdef0123456789";
  const SALT = "loadtest-ip-salt-0123456789abcdef0123456789";
  // Set ALL grains env in THIS process before anything reads it (env.ts memoizes
  // on first getGrainsEnv() — e.g. via signVid — so the DB read below hits the
  // same temp file the server writes to).
  process.env.GRAINS_COOKIE_SECRET = SECRET;
  process.env.GRAINS_IP_SALT = SALT;
  process.env.GRAINS_DB_PATH = DB;

  const env = {
    ...process.env,
    GRAINS_DB_PATH: DB,
    GRAINS_WS_PORT: String(PORT),
    GRAINS_COOKIE_SECRET: SECRET,
    GRAINS_IP_SALT: SALT,
    GRAINS_MAX_PER_SEC: String(MAX_PER_SEC),
    GRAINS_MAX_CONN_PER_IP: "4", // clients use distinct IPs, so this won't trip
  };

  const server = spawn("node", ["--import", "tsx", "server/grains-ws/index.ts"], {
    cwd: REPO,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let booted = false;
  server.stdout.on("data", (d) => {
    if (String(d).includes("listening")) booted = true;
  });
  server.stderr.on("data", (d) => process.stderr.write("[server:err] " + d));
  for (let i = 0; i < 60 && !booted; i++) await sleep(100);
  if (!booted) throw new Error("server did not boot");

  const { signVid } = await import(REPO + "/src/lib/grains/cookie.ts");

  // Memory sampler: server RSS in MB.
  const rssSamples: number[] = [];
  const sampleRss = () => {
    try {
      const kb = Number(execSync(`ps -o rss= -p ${server.pid}`).toString().trim());
      if (Number.isFinite(kb)) rssSamples.push(kb / 1024);
    } catch {
      /* process gone */
    }
  };
  sampleRss();
  const rssTimer = setInterval(sampleRss, 500);

  // Spin up clients.
  let connected = 0;
  let connectFails = 0;
  let intended = 0; // grains the clients meant to send
  let ticksReceived = 0;
  let youReceived = 0;
  const clients: { ws: WebSocket; buffer: number; flush: ReturnType<typeof setInterval> | null }[] = [];

  const url = `ws://127.0.0.1:${PORT}/onegrainofrice/grains/ws`;
  const t0 = Date.now();

  await Promise.all(
    Array.from({ length: CLIENTS }, (_, i) => {
      const [code, name] = COUNTRIES[i % COUNTRIES.length];
      const vid = `load-${i}`;
      // Distinct source IP per client → distinct IP hash (no conn-cap trip).
      const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
      const ws = new WebSocket(url, {
        headers: {
          cookie: `grain_vid=${encodeURIComponent(signVid(vid))}`,
          "x-forwarded-for": ip,
          "x-country-code": code,
          "x-country-name": name,
        },
      });
      const c = { ws, buffer: 0, flush: null as ReturnType<typeof setInterval> | null };
      clients.push(c);
      ws.on("message", (m) => {
        const p = JSON.parse(m.toString());
        if (p.type === "tick") ticksReceived++;
        else if (p.type === "you") youReceived++;
      });
      return new Promise<void>((resolve) => {
        ws.on("open", () => { connected++; resolve(); });
        ws.on("error", () => { connectFails++; resolve(); });
        setTimeout(resolve, 5000);
      });
    }),
  );

  const connectMs = Date.now() - t0;

  // Each client accrues CLICKS_PER_SEC and flushes a single batched delta every
  // FLUSH_MS — exactly what the browser hook does.
  const perFlush = (CLICKS_PER_SEC * FLUSH_MS) / 1000;
  for (const c of clients) {
    if (c.ws.readyState !== WebSocket.OPEN) continue;
    c.flush = setInterval(() => {
      c.buffer += perFlush;
      const delta = Math.floor(c.buffer);
      if (delta <= 0) return;
      c.buffer -= delta;
      intended += delta;
      try {
        c.ws.send(JSON.stringify({ type: "grain", delta }));
      } catch {
        /* dropped */
      }
    }, FLUSH_MS);
  }

  await sleep(DURATION * 1000);

  // Stop clicking, let final flush + broadcast settle.
  for (const c of clients) if (c.flush) clearInterval(c.flush);
  await sleep(800);
  clearInterval(rssTimer);
  sampleRss();

  // Read DB truth.
  process.env.GRAINS_DB_PATH = DB;
  const { getGlobalTotal, getTopCountries } = await import(REPO + "/src/lib/grains/db.ts");
  const dbGlobal = getGlobalTotal();
  const top = getTopCountries(20);
  const countrySum = top.reduce((s: number, c: { total: number }) => s + c.total, 0);

  for (const c of clients) try { c.ws.close(); } catch { /* ignore */ }
  server.kill("SIGTERM");
  await sleep(400);
  fs.rmSync(tmp, { recursive: true, force: true });

  const peakRss = Math.max(...rssSamples);
  const startRss = rssSamples[0];
  const endRss = rssSamples[rssSamples.length - 1];
  const ticksPerClientPerSec = ticksReceived / CLIENTS / DURATION;

  const report = {
    clients: CLIENTS,
    connected,
    connectFails,
    connectMs,
    durationSec: DURATION,
    clicksPerSecPerClient: CLICKS_PER_SEC,
    grainsIntended: intended,
    dbGlobalTotal: dbGlobal,
    dbConsistent_countrySum_eq_global: countrySum === dbGlobal,
    persistedPct: Math.round((dbGlobal / intended) * 1000) / 10,
    ticksReceivedTotal: ticksReceived,
    ticksPerClientPerSec: Math.round(ticksPerClientPerSec * 100) / 100,
    youAcksReceived: youReceived,
    serverRssStartMB: Math.round(startRss * 10) / 10,
    serverRssPeakMB: Math.round(peakRss * 10) / 10,
    serverRssEndMB: Math.round(endRss * 10) / 10,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
