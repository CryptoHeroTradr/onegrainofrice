/**
 * Read a `fetch` Response as JSON, and fail with a sentence a human can act on
 * when the body is not JSON.
 *
 * WHY THIS EXISTS. Every `await res.json()` in this app used to be blind: it
 * assumed the response came from our own route handler, so anything else — an
 * nginx error page, a proxy timeout, an HTML 404 — surfaced to the user as
 *
 *     JSON.parse: unexpected character at line 1 column 1 of the JSON data
 *
 * which names the parser and not the problem. That exact string was the entire
 * user-visible symptom of the /home PFP generator being unusable for three days
 * (2026-08-02 → 2026-08-05): nginx was rejecting every real photo with a 413 and
 * a 192-byte HTML page, and the message said nothing about size, upload, or
 * nginx. The fix for that instance is a smaller upload (see
 * `components/pfp/imaging.ts`); the fix for the CLASS is here — a body that is
 * not JSON is a first-class outcome, described in terms of what came back.
 *
 * The status is always in the message, because "which layer answered" is the
 * first thing anyone debugging this needs and the response body of an edge error
 * usually cannot say it.
 */

/**
 * A response whose body was not JSON. Carries the status and content type so a
 * caller can branch (413 vs 502 vs a 200 serving HTML) instead of string-matching.
 */
export class NonJsonResponseError extends Error {
  readonly status: number;
  readonly contentType: string | null;
  /** First ~200 chars of the body, for logs. Never rendered to a user. */
  readonly bodySnippet: string;

  constructor(res: Response, bodySnippet: string) {
    super(describe(res, bodySnippet));
    this.name = "NonJsonResponseError";
    this.status = res.status;
    this.contentType = res.headers.get("content-type");
    this.bodySnippet = bodySnippet;
  }
}

function describe(res: Response, bodySnippet: string): string {
  // The cases worth naming outright, because the generic sentence sends people
  // looking in the wrong place. 413 in particular is never the app's doing: it
  // is a reverse proxy refusing the request before the app ever sees it.
  if (res.status === 413) {
    return "That upload is too large to send (413). Try a smaller image.";
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return `The server is not reachable right now (${res.status}). Try again in a moment.`;
  }
  if (res.status === 404) {
    return `That endpoint was not found (404) — it may have moved.`;
  }
  if (!res.ok) {
    return `The server returned an error (${res.status}${res.statusText ? ` ${res.statusText}` : ""}).`;
  }
  // 2xx with a non-JSON body: usually a redirect that landed on a page, or a
  // route handler that crashed into an HTML error page.
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() || "no content type";
  if (!bodySnippet.trim()) return `The server sent an empty response (${res.status}).`;
  return `Expected JSON but the server sent ${type} ("${bodySnippet.slice(0, 60)}…").`;
}

/**
 * Parse `res` as JSON, or throw `NonJsonResponseError`.
 *
 * Reads the body as text first and parses it here rather than calling
 * `res.json()`, so a body that is not JSON produces our message rather than the
 * parser's. Applies to error responses too: a route handler's `{ error }` body
 * is JSON and comes back normally, so `!res.ok` handling at the call site is
 * unaffected.
 *
 * WHETHER IT PARSES IS THE TEST — not the content type. Rejecting a body that
 * parses cleanly because its `Content-Type` says `text/plain` would be stricter
 * than the `res.json()` this replaces, and the point of the change is to
 * describe failures better, not to create new ones. The content type is only
 * consulted to WRITE the message once parsing has already failed.
 */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    if (text.trim()) return JSON.parse(text) as T;
  } catch {
    // fall through to the described error
  }
  throw new NonJsonResponseError(res, text.slice(0, 200));
}

/**
 * `readJson` for callers that already treat any failure as "no data" — polling
 * widgets, optional decorations, anything with a sensible empty state. Returns
 * `fallback` instead of throwing, so the existing `.catch(() => …)` shape at
 * those call sites becomes unnecessary rather than merely redundant.
 */
export async function readJsonOr<T>(res: Response, fallback: T): Promise<T> {
  try {
    return await readJson<T>(res);
  } catch {
    return fallback;
  }
}
