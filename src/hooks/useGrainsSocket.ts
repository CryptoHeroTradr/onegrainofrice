"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client hook for the grains realtime socket.
 *
 * - Ensures the signed `grain_vid` session cookie exists (calls the session
 *   route) BEFORE opening the WebSocket, so the upgrade carries a valid cookie.
 * - Reconnects with exponential backoff.
 * - Buffers local grain clicks and flushes them every ~450ms as ONE
 *   { type:"grain", delta } message (fewer frames, server still clamps).
 * - Applies optimistic local increments for a snappy counter, reconciled by the
 *   server's authoritative "init" / "you" / "tick" messages.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/onegrainofrice";
// Client-side mirror of the visitor's personal total. The authoritative count is
// keyed to the signed `grain_vid` cookie server-side, but that cookie can be
// dropped between visits (iOS private browsing, cleared site data, ITP), which
// makes a returning visitor's "your rice" flash back to 0. Mirroring the total
// here lets the UI remember it locally and seed the bowl immediately; the server
// value still wins whenever it's ahead (see the `init` handler's Math.max).
const YOU_STORAGE_KEY = "grains:you";
const FLUSH_MS = 450;
const MAX_BUFFER = 100_000; // cap while disconnected so it can't grow unbounded
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export interface CountryTotal {
  code: string;
  name: string;
  total: number;
}


/** Read the locally-remembered personal total (0 if none / unavailable / SSR). */
function readStoredYou(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(YOU_STORAGE_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export interface PlayerTotal {
  /** The player's chosen name, or their generated rice handle. */
  handle: string;
  code: string;
  total: number;
}

export interface GrainsSocketState {
  global: number;
  you: number;
  yourCountry: CountryTotal | null;
  topCountries: CountryTotal[];
  /** Top individual players (chosen names / generated handles). */
  topPlayers: PlayerTotal[];
  /** This visitor's own leaderboard name, so the UI can highlight + edit it. */
  youHandle: string;
  /** Change this visitor's leaderboard name (server sanitizes + persists). */
  setName: (name: string) => void;
  connected: boolean;
  /**
   * The visitor's saved total as reported by the most recent `init` payload.
   * Lets the UI seed the bowl with a returning visitor's already-earned grains.
   * 0 until the first init arrives.
   */
  restoredYou: number;
  /** Add `n` grains: optimistic locally, buffered, flushed to the server. */
  /** Add `n` grains. Returns the visitor's new personal total. */
  sendGrain: (n?: number) => number;
}

type ServerMsg =
  | {
      type: "init";
      global: number;
      you: number;
      yourCountry: CountryTotal;
      topCountries: CountryTotal[];
      topPlayers?: PlayerTotal[];
      youHandle?: string;
    }
  | { type: "you"; total: number }
  | { type: "name"; name: string }
  | { type: "tick"; global: number; topCountries: CountryTotal[]; topPlayers?: PlayerTotal[] };

function wsUrl(): string {
  // Dev override lets you point at the WS server's port directly (nginx proxies
  // the path in prod). Include a /onegrainofrice/... path so the cookie (scoped
  // to the basePath) is sent on the handshake.
  const override = process.env.NEXT_PUBLIC_GRAINS_WS_URL;
  if (override) return override;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${BASE_PATH}/grains/ws`;
}

export function useGrainsSocket(): GrainsSocketState {
  const [global, setGlobalState] = useState(0);
  const [you, setYouState] = useState(0);
  const [yourCountry, setYourCountry] = useState<CountryTotal | null>(null);
  const [topCountries, setTopCountries] = useState<CountryTotal[]>([]);
  const [topPlayers, setTopPlayers] = useState<PlayerTotal[]>([]);
  const [youHandle, setYouHandle] = useState("");
  const [connected, setConnected] = useState(false);
  const [restoredYou, setRestoredYou] = useState(0);

  // Refs mirror the displayed optimistic values so reconciliation can compare
  // without stale closures.
  const globalRef = useRef(0);
  const youRef = useRef(0);
  const bufferRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(RECONNECT_MIN_MS);
  const closedRef = useRef(false); // component unmounted → stop reconnecting

  const setGlobal = (n: number) => {
    globalRef.current = n;
    setGlobalState(n);
  };
  const setYou = (n: number) => {
    youRef.current = n;
    setYouState(n);
  };

  const flush = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const delta = bufferRef.current;
    if (delta <= 0) return;
    bufferRef.current = 0;
    try {
      ws.send(JSON.stringify({ type: "grain", delta }));
    } catch {
      // Send failed; put the grains back so the next flush retries them.
      bufferRef.current += delta;
    }
  }, []);

  /** Ask the server to change our leaderboard name. It sanitizes and acks. */
  const setName = useCallback((name: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "name", name }));
    } catch {
      /* dropped; the user can retry */
    }
  }, []);

  /**
   * Returns the visitor's new personal total — the number the counter is about
   * to show. Callers need it synchronously: `you` is state and won't have
   * updated yet, and milestone feedback has to key off the total THIS tap
   * produced, not off watching `you` change (which also moves when the server
   * reconciles an already-earned total on load).
   */
  const sendGrain = useCallback((n = 1) => {
    if (!Number.isFinite(n) || n <= 0) return youRef.current;
    const inc = Math.floor(n);
    bufferRef.current = Math.min(MAX_BUFFER, bufferRef.current + inc);
    // Optimistic: bump immediately for a responsive counter.
    setGlobal(globalRef.current + inc);
    const nextYou = youRef.current + inc;
    setYou(nextYou);
    setYourCountry((c) => (c ? { ...c, total: c.total + inc } : c));
    return nextYou;
  }, []);

  // Seed the displayed total from the local mirror once on mount (post-hydration
  // to avoid an SSR mismatch). Runs before the first `init` arrives, so a
  // returning visitor sees their grains — and the bowl prefills to them — even if
  // the session cookie was dropped. The server's `init` still reconciles upward.
  useEffect(() => {
    const stored = readStoredYou();
    if (stored > youRef.current) {
      setYou(stored);
      setRestoredYou((r) => Math.max(r, stored));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the personal total whenever it climbs, so it survives a reload.
  useEffect(() => {
    if (typeof window === "undefined" || you <= 0) return;
    try {
      window.localStorage.setItem(YOU_STORAGE_KEY, String(you));
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }, [you]);

  useEffect(() => {
    closedRef.current = false;

    async function ensureSessionThenConnect() {
      try {
        await fetch(`${BASE_PATH}/grains/session`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });
      } catch {
        // Even if this fails we still try to connect; the server will close the
        // socket (4401) and the backoff loop will retry (and re-run this).
      }
      connect();
    }

    function connect() {
      if (closedRef.current) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        backoffRef.current = RECONNECT_MIN_MS;
        flush(); // drain anything buffered while disconnected
      };

      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        if (msg.type === "init") {
          setGlobal(Math.max(globalRef.current, msg.global));
          setYou(Math.max(youRef.current, msg.you));
          setRestoredYou(msg.you);
          setYourCountry(msg.yourCountry);
          setTopCountries(msg.topCountries ?? []);
          // Seed the players board + our own name straight from init. Without
          // this the board stays empty until the next `tick` (which only fires
          // when somebody drops a grain), and the rename row shows no name.
          setTopPlayers(msg.topPlayers ?? []);
          if (msg.youHandle) setYouHandle(msg.youHandle);
        } else if (msg.type === "you") {
          // Authoritative visitor total; only adopt if it's ahead so unflushed
          // optimistic clicks don't visibly dip.
          if (msg.total > youRef.current) setYou(msg.total);
        } else if (msg.type === "name") {
          // Server-sanitized name (it may differ from what we sent).
          setYouHandle(msg.name);
        } else if (msg.type === "tick") {
          if (msg.global > globalRef.current) setGlobal(msg.global);
          setTopCountries(msg.topCountries ?? []);
          if (msg.topPlayers) setTopPlayers(msg.topPlayers);
          setYourCountry((c) => {
            if (!c) return c;
            const mine = msg.topCountries?.find((t) => t.code === c.code);
            return mine && mine.total > c.total ? { ...c, ...mine } : c;
          });
        }
      };

      const onDown = () => {
        setConnected(false);
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      };
      ws.onclose = onDown;
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          onDown();
        }
      };
    }

    function scheduleReconnect() {
      if (closedRef.current) return;
      if (reconnectTimer.current) return;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(RECONNECT_MAX_MS, backoffRef.current * 2);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        // Re-ensure the session in case the cookie was the reason we dropped.
        ensureSessionThenConnect();
      }, delay);
    }

    flushTimer.current = setInterval(flush, FLUSH_MS);
    ensureSessionThenConnect();

    // Flush the buffer the moment the page is hidden or unloading (a tab switch,
    // navigation, or — common on mobile — backgrounding the browser), so the
    // last <FLUSH_MS of taps aren't lost with the buffered delta. Best-effort:
    // only sends if the socket is open, but that covers the usual case.
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flush);

    return () => {
      closedRef.current = true;
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flush);
      if (flushTimer.current) clearInterval(flushTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [flush]);

  return {
    global,
    you,
    yourCountry,
    topCountries,
    topPlayers,
    youHandle,
    setName,
    connected,
    restoredYou,
    sendGrain,
  };
}
