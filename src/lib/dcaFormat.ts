import type { SiteSchedule, SiteExecution } from "@/lib/bot-contract";

/**
 * FORMATTING THE BOT'S DASHBOARD — pure, and deliberately string-first.
 *
 * TWO RULES RUN THROUGH EVERY FUNCTION HERE, and both come from the contract:
 *
 * 1. RAW AMOUNTS ARE STRINGS AND STAY STRINGS. They are u64 base units. `Number("18446744073709551615")`
 *    is not that number, and the corruption is silent: it renders a plausible-looking figure that is
 *    simply wrong, in the one place on this site where a wrong figure is about someone's money. So
 *    the conversion here is done by SPLITTING THE DIGITS around the decimal point — no float touches
 *    a raw amount on the way to the screen.
 *
 *    (Dollar fields — `spentTodayUsd`, `perExecUsd` — are a different thing entirely. They are
 *    already `number` in the contract because they are display dollars the bot computed, not base
 *    units. Those are formatted as ordinary numbers, which is correct.)
 *
 * 2. TIME IS MEASURED AGAINST `serverTime`, NEVER `Date.now()`. Every timestamp in the payload comes
 *    from the bot's clock; the browser's may be minutes off, and a countdown computed across two
 *    clocks renders "next in -4m" on a schedule that is running perfectly. The dashboard's clock
 *    offset is established once, at read time, and every relative figure is derived from it.
 */

const LAMPORTS_DECIMALS = 9;

/**
 * A u64 base-unit string -> a human decimal string, WITHOUT going through a float.
 *
 * "123456789" at 9 decimals -> "0.123456789", then trimmed to `maxFrac` significant fractional
 * digits with trailing zeros removed. Non-digit input yields "0" rather than throwing: this renders
 * a dashboard, and a malformed field should cost one cell, not the page.
 */
export function formatRaw(raw: string, decimals: number, maxFrac = 4): string {
  if (!/^\d+$/.test(raw)) return "0";
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = decimals > 0 ? padded.slice(padded.length - decimals) : "";
  const shown = frac.slice(0, maxFrac).replace(/0+$/, "");
  // Group the integer part for readability; it is a digit string, so this is safe on any size.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return shown.length > 0 ? `${grouped}.${shown}` : grouped;
}

/** Lamports (u64 string) -> "0.05 SOL". */
export function formatSol(lamports: string, maxFrac = 4): string {
  return `${formatRaw(lamports, LAMPORTS_DECIMALS, maxFrac)} SOL`;
}

/**
 * What a schedule buys or sells each cycle, in the words the panel uses.
 *
 * `percent_of_balance` is stored as BASIS POINTS in `amountRaw` (1000 = 10%) — a contract detail
 * that is easy to render as "1000%" if it is treated like every other amount, which is why it is
 * handled here once instead of at each call site.
 */
export function describeAmount(s: Pick<SiteSchedule, "side" | "amountKind" | "amountRaw">, ticker: string): string {
  if (s.amountKind === "percent_of_balance") {
    const bps = /^\d+$/.test(s.amountRaw) ? Number(s.amountRaw) : 0; // bps is small by construction
    return `Sell ${bps / 100}% of balance`;
  }
  if (s.side === "buy") return `Buy ${formatSol(s.amountRaw)}`;
  return `Sell ${formatRaw(s.amountRaw, 0, 0)} ${ticker.replace("$", "")}`;
}

/** "every 15 min" / "every 2h 30m" / "every 1d 6h" — the interval, humanised. */
export function describeInterval(minutes: number): string {
  if (minutes < 60) return `every ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m === 0 ? `every ${h}h` : `every ${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `every ${d}d` : `every ${d}d ${rh}h`;
}

/**
 * A duration in ms -> "3h 12m" / "45s" / "now". Used for both directions of time, so the sign is
 * the caller's business and this only ever sees a magnitude.
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * "next in 3h 12m", measured against the BOT'S clock.
 *
 * `now` here is the server time carried forward — see `serverNow` below. A schedule whose next run
 * is in the past is not an error: the tick loop runs on an interval, so "due" is the honest word
 * for a moment that has arrived but not yet been acted on.
 */
export function nextRunLabel(nextRunAt: number, now: number): string {
  const delta = nextRunAt - now;
  return delta <= 0 ? "due now" : `next in ${formatDuration(delta)}`;
}

/** "12m ago" against the bot's clock, or null when there is nothing to date. */
export function agoLabel(at: number | null, now: number): string | null {
  if (at == null) return null;
  return `${formatDuration(Math.max(0, now - at))} ago`;
}

/**
 * THE BOT'S CLOCK, CARRIED FORWARD.
 *
 * The payload's `serverTime` is a snapshot. A countdown has to keep moving between reads, so what
 * ticks is the browser's own elapsed time ADDED TO the server's instant — never the browser's
 * absolute wall clock, which may sit minutes away from the bot's.
 *
 * `readAt` is `performance.now()`-style elapsed input from the caller; passing the browser's
 * absolute clock for BOTH arguments cancels out to the same offset, which is why the caller is
 * asked for a monotonic delta rather than a timestamp.
 */
export function serverNow(serverTime: number, elapsedMsSinceRead: number): number {
  return serverTime + Math.max(0, elapsedMsSinceRead);
}

/** A cap and the spend against it, as a 0..1 fraction for a meter. Null cap -> null (no meter). */
export function capProgress(spentUsd: number, capUsd: number | null): number | null {
  if (capUsd == null || !(capUsd > 0)) return null;
  return Math.min(1, Math.max(0, spentUsd / capUsd));
}

/** "$12.40 of $200" / "$12.40 spent · no cap set". Display dollars, never base units. */
export function capLabel(spentUsd: number, capUsd: number | null): string {
  const spent = usd(spentUsd);
  return capUsd == null ? `${spent} spent · no cap set` : `${spent} of ${usd(capUsd)}`;
}

export function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The state chip's words. Deliberately the panel's vocabulary, not new ones. */
export const STATE_LABEL: Record<SiteSchedule["state"], string> = {
  active: "ACTIVE",
  paused: "PAUSED",
  halted: "HALTED",
};

/**
 * One execution, in a line. `inRaw`/`outRaw` are u64 strings and are formatted as such; which side
 * is SOL and which is the token depends on the schedule's side, so the caller supplies it.
 */
export function describeExecution(
  e: Pick<SiteExecution, "state" | "inRaw" | "outRaw" | "usdValue">,
  side: "buy" | "sell",
  ticker: string,
): string {
  const sym = ticker.replace("$", "");
  if (e.inRaw == null || e.outRaw == null) {
    return e.usdValue != null ? `${e.state} · ${usd(e.usdValue)}` : e.state;
  }
  const inS = side === "buy" ? formatSol(e.inRaw) : `${formatRaw(e.inRaw, 6, 2)} ${sym}`;
  const outS = side === "buy" ? `${formatRaw(e.outRaw, 6, 2)} ${sym}` : formatSol(e.outRaw);
  return `${inS} → ${outS}`;
}

/** Short form of an address or signature, for a link label. Never a key — these are public. */
export function shortId(s: string): string {
  return s.length <= 12 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`;
}
