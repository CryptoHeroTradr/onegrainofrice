import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeBase58 } from "../src/lib/base58";
import { linkMessage, runAction, readDashboard, VIEW_MAX_AGE_MS } from "../src/lib/dcaDashboard";

/**
 * THE WRITE CLIENT, against the bridge AS DEPLOYED.
 *
 * The bot is live with SITE_BRIDGE_WRITES=false: reads answer, and all six mutation routes are not
 * mounted, so they 404. That is not an edge case to handle eventually — it is the only state that
 * exists in production today, so it is the DEFAULT CASE these tests are written around.
 *
 * The other property under test is the one that makes a wallet prompt worth reading: the client
 * signs the message the BRIDGE returned, byte for byte. If it ever composed that text itself, the
 * dialog would describe what this website claims will happen rather than what the bot will do.
 */

const WALLET = "RiceViL1agerWa11etAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** A wallet that records exactly what it was asked to sign. */
function spyWallet(): { address: string; signed: string[]; signMessage: (m: Uint8Array) => Promise<Uint8Array> } {
  const signed: string[] = [];
  return {
    address: WALLET,
    signed,
    signMessage: async (m: Uint8Array) => {
      signed.push(new TextDecoder().decode(m));
      return new Uint8Array(64).fill(7);
    },
  };
}

/** Stub `fetch` with a route table; every call is recorded. */
function stubFetch(routes: Record<string, { status: number; body: unknown }>): { calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, body });
    const hit = routes[url] ?? { status: 404, body: { ok: false, error: "not found" } };
    // `text()` as well as `json()`: the client reads bodies through
    // `lib/readJson`, which takes the text and parses it so that a non-JSON body
    // (an nginx 413 page, a gateway error) can be reported as what it is rather
    // than as a JSON.parse failure. A stub that only answers json() is not a
    // stand-in for a Response — it is a stand-in for the one method the code
    // used to call.
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      statusText: "",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => hit.body,
      text: async () => JSON.stringify(hit.body),
    } as unknown as Response;
  });
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

// ── writes off: the production default ────────────────────────────────────────────────────────

describe("with SITE_BRIDGE_WRITES=false — the state the bot is deployed in", () => {
  it("reports writes-disabled instead of throwing, and never asks the wallet to sign", async () => {
    // The bridge does not mount the route, so the SITE's proxy relays a 404. The dashboard turns
    // its controls off; it does not show an error, because nothing has gone wrong.
    stubFetch({ "/api/dca/action-challenge": { status: 404, body: { ok: false, error: "not found" } } });
    const wallet = spyWallet();

    const outcome = await runAction(wallet, { action: "pause", scheduleId: 12 }, 0);

    expect(outcome).toEqual({ kind: "writes-disabled" });
    // Nothing was signed: a signature for a change that cannot be delivered is a wallet popup the
    // user gains nothing by approving.
    expect(wallet.signed).toEqual([]);
  });

  it("detects it at the challenge, so no mutation is ever posted", async () => {
    const { calls } = stubFetch({ "/api/dca/action-challenge": { status: 404, body: {} } });
    await runAction(spyWallet(), { action: "stop-all" }, 0);
    expect(calls.map((c) => c.url)).toEqual(["/api/dca/action-challenge"]);
  });

  it("still reads the dashboard perfectly — the flag gates writes, not reads", async () => {
    stubFetch({
      "/api/dca/challenge": { status: 200, body: { ok: true, nonce: "N1", message: "RICE bot schedules\nnonce:N1" } },
      "/api/dca/dashboard": { status: 200, body: { ok: true, linked: true, schedules: [], banner: { tradeLive: false } } },
    });
    const d = await readDashboard(spyWallet());
    expect(d.linked).toBe(true);
  });

  it("reports it from the mutation too, if writes are switched off mid-session", async () => {
    // The challenge can succeed and the mutation still 404 — the operator flipped the flag between
    // the two calls, or the bot restarted. Same outcome, same quiet degradation.
    stubFetch({
      "/api/dca/action-challenge": { status: 200, body: { ok: true, nonce: "N", message: "RICE bot change\naction:pause" } },
      "/api/dca/action": { status: 404, body: { ok: false, error: "not found" } },
    });
    expect(await runAction(spyWallet(), { action: "pause", scheduleId: 3 }, 0)).toEqual({ kind: "writes-disabled" });
  });
});

// ── what the wallet is asked to approve ───────────────────────────────────────────────────────

describe("the client signs what the bridge sent, never what it composed", () => {
  const CHALLENGE = "RICE bot change\naction:pause\nschedule:12\nvalue:\nnonce:NONCE-1";

  it("signs the returned message byte for byte", async () => {
    stubFetch({
      "/api/dca/action-challenge": { status: 200, body: { ok: true, nonce: "NONCE-1", message: CHALLENGE } },
      "/api/dca/action": { status: 200, body: { ok: true, message: "Schedule #12 paused." } },
    });
    const wallet = spyWallet();

    const outcome = await runAction(wallet, { action: "pause", scheduleId: 12 }, 0);

    expect(wallet.signed).toEqual([CHALLENGE]);
    expect(outcome).toEqual({ kind: "ok", message: "Schedule #12 paused." });
  });

  it("submits the intent, the wallet and the proof — and the signature is base58", async () => {
    const { calls } = stubFetch({
      "/api/dca/action-challenge": { status: 200, body: { ok: true, nonce: "NONCE-1", message: CHALLENGE } },
      "/api/dca/action": { status: 200, body: { ok: true, message: "ok" } },
    });
    await runAction(spyWallet(), { action: "amount", scheduleId: 12, amount: "0.05" }, 0);

    const posted = calls.find((c) => c.url === "/api/dca/action")!.body as Record<string, unknown>;
    expect(posted).toMatchObject({ action: "amount", scheduleId: 12, amount: "0.05", wallet: WALLET, nonce: "NONCE-1" });
    expect(posted.signature).toBe(encodeBase58(new Uint8Array(64).fill(7)));
  });

  it("does not build the signed text itself — the source contains no message template", () => {
    // The structural half of the same claim. A per-intent message assembled here would look
    // identical to the user and mean nothing: it would say whatever this site decided to say.
    const src = readFileSync(join(import.meta.dirname, "../src/lib/dcaDashboard.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // No template literal in this module may look like a signed message. (A TYPE literal such as
    // `readonly action: "pause"` is not one, which is why the check is for a backticked string
    // carrying the message's shape rather than for the word.)
    const templates = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1] as string);
    for (const t of templates) {
      expect(t, "a signed-message template must not be built here").not.toMatch(/action:|nonce:|schedule:/);
    }
    expect(src).not.toContain("RICE bot change");
  });
});

// ── staleness ─────────────────────────────────────────────────────────────────────────────────

describe("a control acting on a stale view refuses before it signs", () => {
  it("refuses locally once the view is older than the nonce window", async () => {
    const { calls } = stubFetch({});
    const wallet = spyWallet();

    const outcome = await runAction(wallet, { action: "pause", scheduleId: 1 }, VIEW_MAX_AGE_MS + 1);

    expect(outcome).toEqual({ kind: "stale" });
    expect(calls).toEqual([]); // nothing asked of the bot
    expect(wallet.signed).toEqual([]); // and nothing asked of the wallet
  });

  it("treats a 401 from the bridge as stale too — a consumed or expired nonce", async () => {
    stubFetch({
      "/api/dca/action-challenge": { status: 200, body: { ok: true, nonce: "N", message: "M" } },
      "/api/dca/action": { status: 401, body: { ok: false, error: "nonce is stale or already used" } },
    });
    expect(await runAction(spyWallet(), { action: "pause", scheduleId: 1 }, 0)).toEqual({ kind: "stale" });
  });
});

// ── refusals come back in the bot's words ─────────────────────────────────────────────────────

describe("a guard refusal is relayed verbatim", () => {
  it("keeps the bot's sentence, which is the Telegram panel's own", async () => {
    const REFUSAL = "that buy is about $0.80 — below the $1 minimum buy. Increase the amount.";
    stubFetch({
      "/api/dca/action-challenge": { status: 200, body: { ok: true, nonce: "N", message: "M" } },
      "/api/dca/action": { status: 400, body: { ok: false, error: REFUSAL } },
    });
    expect(await runAction(spyWallet(), { action: "amount", scheduleId: 1, amount: "0.004" }, 0)).toEqual({
      kind: "refused",
      message: REFUSAL,
    });
  });

  it("relays an UNKNOWN-halt refusal with its /resolve instruction intact", async () => {
    const REFUSAL =
      "⚠️ Schedule #12 is halted on an UNKNOWN outcome — execution 42 may or may not have landed " +
      "on-chain. Resume cannot clear that: check the transaction, then run /resolve 42 " +
      "confirmed|failed in the bot.";
    stubFetch({
      "/api/dca/action-challenge": { status: 200, body: { ok: true, nonce: "N", message: "M" } },
      "/api/dca/action": { status: 400, body: { ok: false, error: REFUSAL } },
    });
    const outcome = await runAction(spyWallet(), { action: "resume", scheduleId: 12 }, 0);
    expect(outcome.kind).toBe("refused");
    // Paraphrasing would drop the one thing the user has to do next.
    expect(outcome.kind === "refused" && outcome.message).toContain("/resolve 42");
  });

  it("a declined signature changes nothing and says so plainly", async () => {
    stubFetch({ "/api/dca/action-challenge": { status: 200, body: { ok: true, nonce: "N", message: "M" } } });
    const wallet = { address: WALLET, signMessage: async () => { throw new Error("User rejected"); } };
    const outcome = await runAction(wallet, { action: "stop-all" }, 0);
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" && outcome.message).toContain("nothing was changed");
  });
});

// ── the read ──────────────────────────────────────────────────────────────────────────────────

describe("the read proves the wallet with the bot's own challenge", () => {
  it("signs the challenge message the bridge returned, then posts it", async () => {
    const MESSAGE = "RICE bot schedules\nnonce:ABC";
    const { calls } = stubFetch({
      "/api/dca/challenge": { status: 200, body: { ok: true, nonce: "ABC", message: MESSAGE } },
      "/api/dca/dashboard": { status: 200, body: { ok: true, linked: false, banner: {}, schedules: [] } },
    });
    const wallet = spyWallet();

    await readDashboard(wallet);

    expect(wallet.signed).toEqual([MESSAGE]);
    const posted = calls.find((c) => c.url === "/api/dca/dashboard")!.body as Record<string, unknown>;
    expect(posted).toMatchObject({ wallet: WALLET, nonce: "ABC" });
  });

  it("an unlinked wallet is a valid dashboard, not an error", async () => {
    stubFetch({
      "/api/dca/challenge": { status: 200, body: { ok: true, nonce: "A", message: "M" } },
      "/api/dca/dashboard": { status: 200, body: { ok: true, linked: false, schedules: [], banner: { tradeLive: true } } },
    });
    const d = await readDashboard(spyWallet());
    expect(d.linked).toBe(false);
    expect(d.banner.tradeLive).toBe(true); // the banner is answered even for a wallet nobody owns
  });

  it("throws only when the read genuinely could not happen", async () => {
    stubFetch({ "/api/dca/challenge": { status: 502, body: { ok: false } } });
    await expect(readDashboard(spyWallet())).rejects.toThrow(/reachable/);
  });
});

// ── the one message the site composes ─────────────────────────────────────────────────────────

describe("the link message matches the bot's, byte for byte", () => {
  const BOT_MESSAGES = "/home/deploy/ricebuybot-src/src/site-bridge/messages.ts";

  it("produces the same string the bot's linkMessage does", () => {
    // Linking has no challenge endpoint (the bot cannot mint a nonce for a wallet it does not yet
    // know), so this is the ONE message built on this side. A duplicated constant drifts unless
    // something checks it, so this reads the bot's source and re-derives the string from it.
    let src: string;
    try {
      src = readFileSync(BOT_MESSAGES, "utf8");
    } catch {
      return; // no bot checkout on this machine; the shape assertion below still ran elsewhere
    }
    const body = /export function linkMessage\([^)]*\): string \{\s*return `([^`]+)`/.exec(src);
    expect(body, "the bot's linkMessage changed shape — re-check src/lib/dcaDashboard.ts").not.toBeNull();
    const template = (body as RegExpExecArray)[1] as string;
    // The source shows escapes as two characters; the runtime string has the real newlines.
    const expected = template
      .replace(/\\n/g, "\n")
      .replace("${wallet}", WALLET)
      .replace("${code}", "A1B2C3D4E5");
    expect(linkMessage(WALLET, "A1B2C3D4E5")).toBe(expected);
  });

  it("is the only message this side builds", () => {
    expect(linkMessage(WALLET, "CODE")).toBe(`Link RICE site\nwallet:${WALLET}\ncode:CODE`);
  });
});

// ── base58 ────────────────────────────────────────────────────────────────────────────────────

describe("base58 encoding is exact for a 64-byte signature", () => {
  it("matches known vectors", () => {
    expect(encodeBase58(new Uint8Array([]))).toBe("");
    expect(encodeBase58(new Uint8Array([0]))).toBe("1");
    expect(encodeBase58(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(encodeBase58(new TextEncoder().encode("hello world"))).toBe("StV1DL6CwTryKyV");
    expect(encodeBase58(new Uint8Array([255, 255, 255, 255]))).toBe("7YXq9G");
  });

  it("encodes 64 bytes without going through a Number", () => {
    const sig = new Uint8Array(64).fill(255);
    const out = encodeBase58(sig);
    expect(out).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(out.length).toBeGreaterThan(80); // ~87 chars for 64 bytes; a lossy path would be shorter
  });
});
