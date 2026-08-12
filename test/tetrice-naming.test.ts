/**
 * TETRICE — the trademarked name appears nowhere it could ship.
 *
 * *Added 2026-08-13, Phase 3. It was written into the spec's acceptance criteria in Phase 0
 * and did not exist until now; the earlier phases were taking it on trust.*
 *
 * `CLAUDE.md` forbids the word in code, copy, metadata, alt text, filenames and commit
 * messages. This suite covers everything that is checkable from the repo: the shipped
 * source tree and asset filenames.
 *
 * TWO FILES ARE ALLOWED TO CONTAIN IT, AND THEY ARE NAMED RATHER THAN PATTERN-EXCLUDED.
 * `CLAUDE.md` states the rule, and `docs/tetrice-spec.md` quotes the mood board's title
 * block in order to say it must not be reproduced. A rule cannot be written down without
 * naming what it forbids. Anything else — a component, a string, a route, an image
 * filename — is a failure.
 *
 * The scan carries a POSITIVE CONTROL. A naming test is the easiest test in this repo to
 * write so that it always passes, and the most expensive one to trust wrongly: it looks
 * identical whether it is scanning the tree or scanning nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

/** Written split so this file does not itself contain the string it forbids. */
const FORBIDDEN = new RegExp(["tet", "ris"].join(""), "i");

/** Where the rule is STATED. Named, not pattern-matched, so the list stays a decision. */
const ALLOWED = new Set(["CLAUDE.md", "docs/tetrice-spec.md"]);

const SCAN_DIRS = ["src", "public", "deploy", "test", "docs"];
const SKIP_DIRS = new Set(["node_modules", "builds", ".next", ".git", "geoip"]);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|css|md|json|html|sh|txt|svg)$/;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function scan(): { hits: Hit[]; filesScanned: number; textFilesScanned: number } {
  const hits: Hit[] = [];
  let filesScanned = 0;
  let textFilesScanned = 0;

  for (const d of SCAN_DIRS) {
    for (const full of walk(join(ROOT, d))) {
      const rel = relative(ROOT, full);
      filesScanned += 1;

      // FILENAMES count too — an asset called after the trademark ships in the URL.
      if (FORBIDDEN.test(rel) && !ALLOWED.has(rel)) {
        hits.push({ file: rel, line: 0, text: "(the FILENAME contains it)" });
      }
      if (!TEXT_EXT.test(rel) || ALLOWED.has(rel)) continue;

      textFilesScanned += 1;
      const body = readFileSync(full, "utf8");
      if (!FORBIDDEN.test(body)) continue;
      body.split("\n").forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
      });
    }
  }
  return { hits, filesScanned, textFilesScanned };
}

describe("TETRICE naming", () => {
  it("scans a real tree — the control on the instrument", () => {
    // Without this, a walk that returned nothing would make every assertion below pass by
    // scanning an empty set, which is indistinguishable from a clean repo.
    const { filesScanned, textFilesScanned } = scan();
    expect(filesScanned).toBeGreaterThan(200);
    expect(textFilesScanned).toBeGreaterThan(150);
  });

  it("POSITIVE CONTROL: the matcher finds the word when it is present", () => {
    // The fixture is ASSEMBLED rather than written out, for the same reason the regex is:
    // a control that spelled the word would put it in the shipped tree and make this suite
    // fail on itself — and the tempting fix for that (allowlisting this file) would stop it
    // scanning the one place a fixture is most likely to be left behind.
    const WORD = ["TET", "RIS"].join("");
    expect(FORBIDDEN.test(`${WORD} RICE EDITION`)).toBe(true);
    expect(FORBIDDEN.test(`${WORD.toLowerCase()}.png`)).toBe(true);
    expect(FORBIDDEN.test("TETRICE / ONE GRAIN OF RICE")).toBe(false);
    expect(FORBIDDEN.test("pieces and shapes")).toBe(false);
  });

  it("the two files allowed to name it still do — or the allowlist is stale", () => {
    // The other direction: if the spec stops quoting the mood board's title block, this
    // allowlist entry is dead and should go, rather than sitting there weakening the scan.
    for (const rel of ALLOWED) {
      const body = readFileSync(join(ROOT, rel), "utf8");
      expect(FORBIDDEN.test(body), `${rel} no longer names it — drop it from ALLOWED`).toBe(true);
    }
  });

  it("appears nowhere else in the shipped tree, in content or in a filename", () => {
    const { hits } = scan();
    expect(
      hits,
      hits.length
        ? `the trademarked name is present in:\n${hits
            .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
            .join("\n")}`
        : "",
    ).toEqual([]);
  });
});
