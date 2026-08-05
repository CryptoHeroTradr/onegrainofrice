/**
 * A body that is not JSON reports what it IS.
 *
 * The bug this pins was three days of the /home PFP generator being unusable
 * (2026-08-02 → 2026-08-05) behind one sentence:
 *
 *     JSON.parse: unexpected character at line 1 column 1 of the JSON data
 *
 * nginx's `client_max_body_size` defaults to 1 MB, this site's vhost carried the
 * default, and every real photo — a 1024px PNG is 1.5–2.5 MB before base64 — was
 * rejected at the proxy with a 192-byte HTML error page. The app never saw the
 * request. The message named the parser, so it read as "the generator is broken"
 * rather than "your photo is too big", and the actual cause was nowhere in it.
 *
 * `readJson` exists so no fetch in this app can say that again. What is asserted
 * here is the CONTRACT rather than the wording: the failure is typed, it carries
 * the status, and the sentence a user sees is about the response instead of about
 * a parser.
 */
import { describe, expect, it } from "vitest";
import { NonJsonResponseError, readJson, readJsonOr } from "@/lib/readJson";

/** The real thing, byte for byte — nginx 1.24.0's 413 page. */
const NGINX_413 = `<html>
<head><title>413 Request Entity Too Large</title></head>
<body>
<center><h1>413 Request Entity Too Large</h1></center>
<hr><center>nginx/1.24.0 (Ubuntu)</center>
</body>
</html>
`;

const res = (body: string, init: ResponseInit = {}) => new Response(body, init);

/** The rejection, typed — `.catch()` widens the result union back to unknown. */
async function failureOf(p: Promise<unknown>): Promise<NonJsonResponseError> {
  let thrown: unknown;
  let resolved = false;
  try {
    await p;
    resolved = true;
  } catch (e) {
    thrown = e;
  }
  if (resolved) throw new Error("expected readJson to reject, but it resolved");
  return thrown as NonJsonResponseError;
}

describe("readJson", () => {
  it("parses a JSON body", async () => {
    const out = await readJson<{ image: string }>(
      res(JSON.stringify({ image: "data:image/png;base64,AA" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    expect(out.image).toBe("data:image/png;base64,AA");
  });

  it("parses a JSON body that is not LABELLED as JSON", async () => {
    // Deliberately laxer than a content-type check: this replaced res.json(),
    // which parsed on content alone, and being stricter than the code it
    // replaces would break working callers to fix a broken one.
    const out = await readJson<{ ok: boolean }>(
      res(JSON.stringify({ ok: true }), { headers: { "content-type": "text/plain" } }),
    );
    expect(out.ok).toBe(true);
  });

  it("still returns an error BODY, so !res.ok handling is unaffected", async () => {
    const out = await readJson<{ error: string }>(
      res(JSON.stringify({ error: "Upload a photo first." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(out.error).toBe("Upload a photo first.");
  });

  it("describes nginx's 413 in terms of the upload, not the parser", async () => {
    const err = await failureOf(
      readJson(res(NGINX_413, { status: 413, headers: { "content-type": "text/html" } })),
    );

    expect(err).toBeInstanceOf(NonJsonResponseError);
    expect(err.status).toBe(413);
    // The two words that would have saved three days.
    expect(err.message).toMatch(/too large/i);
    expect(err.message).toMatch(/413/);
    // And the sentence a user reads is never about JSON.
    expect(err.message).not.toMatch(/JSON/i);
    expect(err.message).not.toMatch(/parse/i);
  });

  it("names the status for any other non-JSON body", async () => {
    for (const status of [404, 502, 503, 504]) {
      const err = await failureOf(readJson(res("<html>nope</html>", { status })));
      expect(err).toBeInstanceOf(NonJsonResponseError);
      expect(err.message).toMatch(String(status));
      expect(err.message).not.toMatch(/JSON\.parse/);
    }
  });

  it("treats a 200 serving HTML as a failure, naming what arrived", async () => {
    // The redirect-landed-on-a-page case: status says fine, body is a document.
    const err = await failureOf(
      readJson(
        res("<!doctype html><title>Not the API</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    expect(err.status).toBe(200);
    expect(err.message).toMatch(/text\/html/);
  });

  it("keeps a body snippet for logs but never puts a whole page in the message", async () => {
    const err = await failureOf(readJson(res(NGINX_413, { status: 413 })));
    expect(err.bodySnippet).toContain("413 Request Entity Too Large");
    expect(err.message.length).toBeLessThan(120);
  });

  it("reports an empty body as empty rather than as bad JSON", async () => {
    // 200 with nothing in it — a 204 cannot carry a body to test with.
    const err = await failureOf(readJson(res("", { status: 200 })));
    expect(err.message).toMatch(/empty/i);
  });
});

describe("readJsonOr", () => {
  it("returns the fallback instead of throwing", async () => {
    expect(await readJsonOr(res(NGINX_413, { status: 413 }), { aiEnabled: false })).toEqual({
      aiEnabled: false,
    });
  });

  it("still parses a good body", async () => {
    expect(await readJsonOr(res('{"aiEnabled":true}'), { aiEnabled: false })).toEqual({
      aiEnabled: true,
    });
  });
});
