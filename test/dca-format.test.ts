import { describe, expect, it } from "vitest";

import {
  agoLabel,
  capLabel,
  capProgress,
  describeAmount,
  describeExecution,
  describeInterval,
  formatDuration,
  formatRaw,
  formatSol,
  nextRunLabel,
  serverNow,
  usd,
} from "../src/lib/dcaFormat";

/**
 * THE TWO WAYS THIS DASHBOARD COULD LIE ABOUT SOMEONE'S MONEY, pinned.
 *
 * 1. A u64 THROUGH A FLOAT. Raw amounts arrive as strings because they are base units and `Number`
 *    cannot hold them. The failure is silent and plausible — a figure appears, it is simply the
 *    wrong one — so the conversion is done by splitting digits and these tests use values that a
 *    float would visibly mangle.
 *
 * 2. THE WRONG CLOCK. Every timestamp comes from the bot. A countdown computed against the
 *    browser's wall clock renders nonsense on any machine whose time is off, which is common and
 *    invisible. So relative time is derived from `serverTime` plus elapsed, and never from now.
 */

describe("u64 base units survive the trip to the screen", () => {
  it("formats amounts that a float cannot hold", () => {
    // 2^64-1 lamports. Number() would render 18446744073709552000 — off by ~1616 lamports.
    expect(formatRaw("18446744073709551615", 9, 9)).toBe("18,446,744,073.709551615");
    // The digits are preserved exactly; nothing here goes through a float.
    expect(formatRaw("9007199254740993", 0, 0)).toBe("9,007,199,254,740,993");
  });

  it("places the decimal point by splitting digits, not by dividing", () => {
    expect(formatRaw("123456789", 9)).toBe("0.1234");
    expect(formatRaw("1", 9, 9)).toBe("0.000000001");
    expect(formatRaw("1000000000", 9)).toBe("1");
    expect(formatRaw("0", 9)).toBe("0");
    expect(formatSol("50000000")).toBe("0.05 SOL");
  });

  it("trims trailing zeros but never significant digits", () => {
    expect(formatRaw("1500000000", 9)).toBe("1.5");
    expect(formatRaw("1050000000", 9)).toBe("1.05");
  });

  it("returns 0 for anything that is not a digit string, rather than throwing", () => {
    // One malformed field should cost one cell, not the page.
    for (const bad of ["", "abc", "-1", "1.5", "1e9", "0x10"]) expect(formatRaw(bad, 9)).toBe("0");
  });

  it("renders a percent-of-balance amount from BASIS POINTS, not as a raw number", () => {
    // 1000 bps is 10%. Treated like any other amount it would read "1000%", which is the kind of
    // wrong that looks like a UI bug and is actually a contract misreading.
    expect(describeAmount({ side: "sell", amountKind: "percent_of_balance", amountRaw: "1000" }, "$RICE")).toBe(
      "Sell 10% of balance",
    );
    expect(describeAmount({ side: "buy", amountKind: "absolute", amountRaw: "50000000" }, "$RICE")).toBe(
      "Buy 0.05 SOL",
    );
    expect(describeAmount({ side: "sell", amountKind: "absolute", amountRaw: "5000" }, "$RICE")).toBe(
      "Sell 5,000 RICE",
    );
  });

  it("formats an execution's in/out by side, both as strings", () => {
    const e = { state: "confirmed" as const, inRaw: "50000000", outRaw: "4200000000", usdValue: 20 };
    expect(describeExecution(e, "buy", "$RICE")).toBe("0.05 SOL → 4,200 RICE");
    expect(describeExecution(e, "sell", "$RICE")).toBe("50 RICE → 4.2 SOL");
  });

  it("falls back to the dollar figure when an execution has no amounts yet", () => {
    expect(describeExecution({ state: "UNKNOWN", inRaw: null, outRaw: null, usdValue: 12 }, "buy", "$RICE")).toBe(
      "UNKNOWN · $12.00",
    );
    expect(describeExecution({ state: "claimed", inRaw: null, outRaw: null, usdValue: null }, "buy", "$RICE")).toBe(
      "claimed",
    );
  });
});

describe("time is the bot's, not the browser's", () => {
  it("advances from serverTime by elapsed browser time — never from the wall clock", () => {
    const serverTime = 1_700_000_000_000;
    expect(serverNow(serverTime, 0)).toBe(serverTime);
    expect(serverNow(serverTime, 65_000)).toBe(serverTime + 65_000);
    // A browser clock that is an hour behind cannot drag the countdown backwards, because the
    // browser's absolute time is never an input.
    expect(serverNow(serverTime, -5_000)).toBe(serverTime);
  });

  it("counts down to the next run against that clock", () => {
    const now = 1_700_000_000_000;
    expect(nextRunLabel(now + 3 * 3_600_000 + 12 * 60_000, now)).toBe("next in 3h 12m");
    expect(nextRunLabel(now + 45_000, now)).toBe("next in 45s");
    // A run whose moment has arrived is DUE, not overdue and not negative: the tick loop runs on
    // an interval, so a few seconds past is the normal state of a healthy schedule.
    expect(nextRunLabel(now - 90_000, now)).toBe("due now");
    expect(nextRunLabel(now, now)).toBe("due now");
  });

  it("dates the past the same way, and says nothing when there is nothing to date", () => {
    const now = 1_700_000_000_000;
    expect(agoLabel(now - 120_000, now)).toBe("2m 0s ago");
    expect(agoLabel(null, now)).toBeNull();
    // A timestamp slightly in the future (a read that raced the bot's own clock) clamps to zero
    // rather than rendering a negative age.
    expect(agoLabel(now + 5_000, now)).toBe("now ago");
  });

  it("humanises durations across the units", () => {
    expect(formatDuration(0)).toBe("now");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3 * 3_600_000)).toBe("3h 0m");
    expect(formatDuration(30 * 3_600_000)).toBe("1d 6h");
  });

  it("humanises the interval as the panel does", () => {
    expect(describeInterval(15)).toBe("every 15 min");
    expect(describeInterval(60)).toBe("every 1h");
    expect(describeInterval(150)).toBe("every 2h 30m");
    expect(describeInterval(1440)).toBe("every 1d");
    expect(describeInterval(1500)).toBe("every 1d 1h");
  });
});

describe("budgets: a missing cap is not a zero cap", () => {
  it("renders no meter and says so when no cap is set", () => {
    // "no cap set" and "a $0 cap" are opposites; the contract sends null for the first, and a
    // meter drawn at 0% would read as the second.
    expect(capProgress(12, null)).toBeNull();
    expect(capLabel(12.4, null)).toBe("$12.40 spent · no cap set");
  });

  it("fills the meter proportionally and clamps at full", () => {
    expect(capProgress(50, 200)).toBeCloseTo(0.25);
    expect(capProgress(250, 200)).toBe(1);
    expect(capProgress(-5, 200)).toBe(0);
    expect(capProgress(5, 0)).toBeNull();
    expect(capLabel(12.4, 200)).toBe("$12.40 of $200.00");
  });

  it("formats display dollars as dollars", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(Number.NaN)).toBe("$0.00");
  });
});
