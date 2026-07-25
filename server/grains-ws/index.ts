/**
 * Grains realtime WebSocket server (Phase 2).
 *
 * This is the ONLY process that writes to the grains SQLite DB. It:
 *   - authenticates each connection from a signed `grain_vid` cookie,
 *   - ingests { type:"grain", delta } messages under a per-connection token
 *     bucket (anti-cheat clamp), writing accepted grains via addGrains(),
 *   - keeps global + per-country aggregates in memory and broadcasts a
 *     throttled { type:"tick" } to all clients every 250ms when they change.
 *
 * Runs as a standalone Node process (via tsx) under pm2, behind nginx. It is
 * path-agnostic — nginx proxies whatever path to this port. Native `ws`, no
 * socket.io.
 *
 * SERVER-ONLY. Reads GRAINS_* from the environment (loaded by pm2 / --env-file).
 */

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";

import { getGrainsEnv } from "../../src/lib/grains/env";
import {
  addGrains,
  getAllCountries,
  getGlobalTotal,
  getTopVisitors,
  getVisitor,
  hashIp,
  sanitizeName,
  setVisitorName,
  upsertVisitor,
} from "../../src/lib/grains/db";
import { readVidFromCookieHeader } from "../../src/lib/grains/cookie";
import { playerHandle } from "../../src/lib/grains/handle";

// --- tunables ---------------------------------------------------------------
const TICK_MS = 250; // broadcast + per-conn "you" flush cadence
const HEARTBEAT_MS = 30_000; // ping/pong liveness
const TOP_N = 15; // leaderboard size
const MAX_DELTA = 100_000; // single-message sanity cap (larger => malformed)
const MAX_FRAME_BYTES = 1024; // reject oversized frames at the protocol layer
const MAX_BUFFERED_BYTES = 1 << 20; // 1 MiB: skip sends to a saturated socket
// Close code sent when a connection has no valid session cookie. The client
// should hit the Phase 3 session route to mint one, then reconnect.
const CLOSE_NO_SESSION = 4401;
// Sent when an IP hash already holds GRAINS_MAX_CONN_PER_IP live connections.
const CLOSE_TOO_MANY = 4429;
// A player may only rename this often (per connection).
const NAME_COOLDOWN_MS = 2_000;

const env = getGrainsEnv();

// --- per-connection state ---------------------------------------------------
interface ConnState {
  vid: string;
  ipHash: string | null;
  countryCode: string;
  countryName: string;
  /** token bucket: available grains + last refill time (ms). */
  tokens: number;
  lastRefill: number;
  /** this visitor's running total (seeded from DB, kept in memory). */
  total: number;
  /** heartbeat liveness. */
  isAlive: boolean;
  /** "you" ack throttling. */
  lastYouAt: number;
  youPending: boolean;
  /** rename rate limit (ms epoch of the last accepted name change). */
  lastNameAt: number;
}

const conns = new Map<WebSocket, ConnState>();

// Abuse hardening: how many live connections share each IP hash. An attacker
// can mint unlimited vids via the session route, but they still funnel through
// one IP hash, so capping per IP bounds fan-out. Tune via GRAINS_MAX_CONN_PER_IP.
const ipConns = new Map<string, number>();

function releaseIp(ipHash: string | null): void {
  if (!ipHash) return;
  const n = (ipConns.get(ipHash) ?? 0) - 1;
  if (n <= 0) ipConns.delete(ipHash);
  else ipConns.set(ipHash, n);
}

/** Idempotent teardown: unregister a connection and free its IP slot. */
function dropConn(ws: WebSocket): void {
  const state = conns.get(ws);
  if (!state) return; // already dropped
  conns.delete(ws);
  releaseIp(state.ipHash);
}

// --- in-memory aggregates (seeded from DB at boot) --------------------------
let globalTotal = getGlobalTotal();
const countryMap = new Map<string, { name: string; total: number }>();
for (const c of getAllCountries()) {
  countryMap.set(c.code, { name: c.name ?? "Unknown", total: c.total });
}
// True when global/leaderboard changed since the last broadcast tick.
let dirty = false;

function topCountries(): { code: string; name: string; total: number }[] {
  return [...countryMap.entries()]
    .map(([code, v]) => ({ code, name: v.name, total: v.total }))
    .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code))
    .slice(0, TOP_N);
}

/**
 * Top N individual players. A player who picked a name shows it; everyone else
 * falls back to the deterministic rice handle. Queried from the DB (indexed on
 * total) and only recomputed on a dirty tick, so it stays cheap.
 */
function topPlayers(): { handle: string; code: string; total: number }[] {
  return getTopVisitors(TOP_N).map((v) => ({
    handle: v.display_name || playerHandle(v.vid),
    code: (v.country_code || "XX").toUpperCase(),
    total: v.total,
  }));
}

/** This visitor's current leaderboard name (chosen, else generated). */
function nameFor(vid: string): string {
  return getVisitor(vid)?.display_name || playerHandle(vid);
}

// --- header parsing (defensive; nginx populates these in Phase 6) -----------

/**
 * Client IP from X-Forwarded-For. nginx sets it via $proxy_add_x_forwarded_for,
 * which APPENDS the real peer address, so the rightmost entry is the trusted
 * hop. Fall back to X-Real-IP, the socket peer, then localhost.
 */
function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : xff;
  if (raw) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return req.socket.remoteAddress || "127.0.0.1";
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

// --- send helpers (backpressure-aware) --------------------------------------
function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return; // socket saturated; skip
  ws.send(JSON.stringify(payload));
}

// --- connection lifecycle ---------------------------------------------------
function onConnection(ws: WebSocket, req: IncomingMessage): void {
  // 1) Authenticate from the signed cookie. Do NOT mint one here.
  const vid = readVidFromCookieHeader(req.headers.cookie);
  if (!vid) {
    ws.close(CLOSE_NO_SESSION, "no-session");
    return;
  }

  // 2) Identity from headers (defensive defaults for local/no-nginx testing).
  const ipHash = hashIp(clientIp(req));
  const countryCode = (header(req, "x-country-code") || "XX").slice(0, 8).toUpperCase();
  const countryName = header(req, "x-country-name") || "Unknown";

  // 2b) Per-IP connection cap (abuse hardening). Checked before any DB work.
  if (ipHash && (ipConns.get(ipHash) ?? 0) >= env.maxConnPerIp) {
    ws.close(CLOSE_TOO_MANY, "too-many-connections");
    return;
  }

  // 3) Record identity + read current total (single write on connect).
  const visitor = upsertVisitor(vid, ipHash, countryCode, countryName);

  const now = Date.now();
  const state: ConnState = {
    vid,
    ipHash,
    countryCode,
    countryName,
    tokens: env.maxPerSec, // start with one second's worth of headroom
    lastRefill: now,
    total: visitor.total,
    isAlive: true,
    lastYouAt: 0,
    youPending: false,
    lastNameAt: 0,
  };
  conns.set(ws, state);
  if (ipHash) ipConns.set(ipHash, (ipConns.get(ipHash) ?? 0) + 1);

  // Reflect this visitor's country into the aggregate map (name may be new).
  const country = countryMap.get(countryCode);
  if (country) {
    if (countryName !== "Unknown") country.name = countryName;
  } else {
    countryMap.set(countryCode, { name: countryName, total: 0 });
  }

  // 4) Initial snapshot.
  const yc = countryMap.get(countryCode)!;
  safeSend(ws, {
    type: "init",
    global: globalTotal,
    you: state.total,
    yourCountry: { code: countryCode, name: yc.name, total: yc.total },
    topCountries: topCountries(),
    topPlayers: topPlayers(),
    youHandle: nameFor(vid),
  });

  ws.on("pong", () => {
    const s = conns.get(ws);
    if (s) s.isAlive = true;
  });

  ws.on("message", (data) => onMessage(ws, data));

  ws.on("close", () => {
    dropConn(ws);
  });

  ws.on("error", () => {
    // Never let a socket error crash the process; drop the connection.
    dropConn(ws);
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
  });
}

function onMessage(ws: WebSocket, data: RawData): void {
  const state = conns.get(ws);
  if (!state) return;

  // Parse + validate. Anything malformed is silently dropped.
  let msg: unknown;
  try {
    msg = JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  const m = msg as { type?: unknown; delta?: unknown; name?: unknown };

  // --- { type:"name", name } — set this player's leaderboard name -----------
  if (m.type === "name") {
    const now = Date.now();
    // Renames are cheap for us but a free write primitive for an attacker, so
    // rate-limit them per connection independently of the grain token bucket.
    if (now - state.lastNameAt < NAME_COOLDOWN_MS) return;
    state.lastNameAt = now;

    // NEVER trust the client's string: sanitize server-side. An empty/garbage
    // name clears the override and falls back to the generated handle.
    const clean = sanitizeName(m.name);
    setVisitorName(state.vid, clean);

    const resolved = clean ?? playerHandle(state.vid);
    safeSend(ws, { type: "name", name: resolved });
    dirty = true; // the players board now shows a different name
    return;
  }

  if (m.type !== "grain") return;

  const delta = m.delta;
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta <= 0 || delta > MAX_DELTA) {
    return; // malformed / oversized
  }

  // Token-bucket clamp: refill at maxPerSec, cap at one second's burst.
  const now = Date.now();
  const refill = ((now - state.lastRefill) / 1000) * env.maxPerSec;
  state.tokens = Math.min(env.maxPerSec, state.tokens + refill);
  state.lastRefill = now;

  const allowed = Math.floor(state.tokens);
  const accepted = Math.min(delta, allowed);
  if (accepted <= 0) return; // rate-limited; nothing credited

  state.tokens -= accepted;

  // Single-transaction write returns exact before/after totals for detection.
  const write = addGrains(state.vid, state.ipHash, state.countryCode, state.countryName, accepted);
  globalTotal = write.globalAfter;
  state.total = write.visitorAfter;

  // In-memory country aggregate.
  const country = countryMap.get(state.countryCode);
  if (country) country.total += accepted;
  else countryMap.set(state.countryCode, { name: state.countryName, total: accepted });

  dirty = true;

  // "you" ack, throttled to ~1/TICK_MS. Immediate if enough time elapsed,
  // otherwise the tick loop flushes it.
  if (now - state.lastYouAt >= TICK_MS) {
    state.lastYouAt = now;
    state.youPending = false;
    safeSend(ws, { type: "you", total: state.total });
  } else {
    state.youPending = true;
  }
}

// --- broadcast + "you" flush loop -------------------------------------------
function tickLoop(): void {
  const now = Date.now();

  const top = topCountries();

  if (dirty) {
    dirty = false;
    const payload = {
      type: "tick",
      global: globalTotal,
      topCountries: top,
      topPlayers: topPlayers(),
    };
    for (const ws of conns.keys()) safeSend(ws, payload);
  }

  // Flush any deferred "you" acks.
  for (const [ws, state] of conns) {
    if (state.youPending) {
      state.youPending = false;
      state.lastYouAt = now;
      safeSend(ws, { type: "you", total: state.total });
    }
  }
}

// --- heartbeat --------------------------------------------------------------
function heartbeat(): void {
  for (const [ws, state] of conns) {
    if (!state.isAlive) {
      dropConn(ws);
      ws.terminate();
      continue;
    }
    state.isAlive = false;
    try {
      ws.ping();
    } catch {
      dropConn(ws);
      try {
        ws.terminate();
      } catch {
        /* gone */
      }
    }
  }
}

// --- boot -------------------------------------------------------------------
const wss = new WebSocketServer({ port: env.wsPort, maxPayload: MAX_FRAME_BYTES });

wss.on("connection", onConnection);
wss.on("listening", () => {
  console.log(
    `[grains-ws] listening on :${env.wsPort} — global=${globalTotal}, countries=${countryMap.size}, maxPerSec=${env.maxPerSec}, maxConnPerIp=${env.maxConnPerIp}`,
  );
});
wss.on("error", (err) => {
  console.error("[grains-ws] server error:", err);
});

const tickTimer = setInterval(tickLoop, TICK_MS);
const beatTimer = setInterval(heartbeat, HEARTBEAT_MS);

function shutdown(signal: string): void {
  console.log(`[grains-ws] ${signal} received, shutting down…`);
  clearInterval(tickTimer);
  clearInterval(beatTimer);
  for (const ws of conns.keys()) {
    try {
      ws.close(1001, "server-shutdown");
    } catch {
      /* ignore */
    }
  }
  wss.close(() => process.exit(0));
  // Failsafe if close hangs.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
