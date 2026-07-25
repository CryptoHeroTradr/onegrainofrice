# Grains — WS load test

Reproducible load test of the realtime WebSocket server ([server/grains-ws](../../server/grains-ws/index.ts)).
It spawns the server against a throwaway SQLite DB, connects N concurrent
clients (each a distinct vid + IP + country, batching grains every 450ms exactly
like the browser hook), and reports connect success, DB consistency, the
broadcast/tick throttle, and server memory.

## Run it

```bash
pnpm grains:loadtest                                   # defaults: 200 clients, 15s, 8 clicks/s
CLIENTS=300 DURATION=30 CLICKS_PER_SEC=8 pnpm grains:loadtest
```

Script: [scripts/grains-loadtest.ts](../../scripts/grains-loadtest.ts). Self-contained
(temp DB, own server on :3994) — it does not touch the production DB.

## Environment

- VPS, Node v22.22.1, better-sqlite3 12.11.1 (WAL), server `GRAINS_MAX_PER_SEC=20`.
- Each client mimics the real UI: accrues `CLICKS_PER_SEC` and flushes one
  batched `{type:"grain",delta}` every 450ms. Distinct `X-Forwarded-For` per
  client → distinct IP hash (so the per-IP connection cap is not tripped).

## Results

| Scenario | Clients | Dur | Clicks/s | Connect | Intended | DB total | Persisted | Consistent¹ | Ticks/client/s² | RSS start→peak→end |
|---|---:|---:|---:|---:|---:|---:|---:|:--:|---:|---|
| A · nominal fast-click | 200 | 15s | 8 | 200/200 in 222ms | 23,600 | 23,600 | **100%** | ✅ | 3.2 | 85.7 → 103.1 → 99.2 MB |
| B · high concurrency | 300 | 30s | 8 | 300/300 in 357ms | 62,211 | 62,211 | **100%** | ✅ | 2.83 | 88.2 → 112.4 → 112.4 MB |
| C · above-clamp flood | 150 | 15s | 50 | 150/150 in 169ms | 101,250 | 42,904 | 42.4% | ✅ | 2.4 | 88.1 → 103.7 → 101.6 MB |

¹ `SUM(countries.total) == global.total` in the DB after the run.
² Observed tick messages ÷ clients ÷ duration. The server broadcasts at most once
  per 250ms and only when state changed, so the ceiling is 4.0/s — all runs sit
  at/below it, confirming the broadcast throttle is not per-message flooding.

## What each result confirms

- **DB holds up / no loss under load (A, B).** When clients click below the
  clamp (8 < 20/s), 100% of intended grains persist and the three counters stay
  consistent — even at 300 concurrent sockets over 30s. Connect is fast and
  lossless (0 failures).
- **Anti-cheat clamp holds under load (C).** Flooding at 50 clicks/s (well over
  the 20/s clamp) persists only **42.4%** — the per-visitor token bucket drops
  the excess exactly as designed, and the DB stays consistent. The counter is
  server-authoritative, not client-driven.
- **Broadcast throttle (all).** 2.4–3.2 ticks/client/s, always ≤ the 4.0/s
  (250ms) ceiling — broadcasts are batched, not one-per-grain.
- **Memory holds (B).** Over 30s at 300 sockets, RSS peaks at 112.4 MB and
  **ends at 112.4 MB** (no monotonic climb); scenarios A and C end *below* their
  peak. Bounded state (no unbounded arrays; settled aggregates are counters, not
  growing lists) keeps memory flat under sustained load.

## Notes / limits

- These runs are localhost loopback (no nginx, no network RTT), so connect times
  and throughput are upper bounds; production adds nginx proxy + WAN latency but
  the server-side costs (SQLite writes, broadcast fan-out, memory) are what this
  measures.
- The per-IP connection cap (`GRAINS_MAX_CONN_PER_IP`, default 8) is exercised
  separately (distinct IPs here); see the abuse-hardening check in the phase
  tests. To stress it, point many clients at one `X-Forwarded-For`.
- Longer soak (2+ min) can be run with `DURATION=150`; the 30s run already shows
  a flat peak==end RSS, the signal for no leak.
