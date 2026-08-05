/**
 * ONE SOCIALS ROW, AND EVERY ID HAS A GLYPH.
 *
 * `HomeFooter` used to carry a hand-copied duplicate of `SocialLinks` — its own
 * `<ul>`, its own inline X logo, its own `SocialIcon` switch — and by 2026-08-05
 * it had already drifted: the footer's switch had no `instagram` case, so
 * Instagram rendered as a generic globe there while showing its real mark in the
 * nav. Nothing was broken enough to report; it was just quietly wrong on one of
 * the two places it appeared.
 *
 * Adding TikTok is what surfaced it, because it meant writing the same glyph
 * twice. The duplicate is gone; this keeps it gone, and keeps the icon switch
 * exhaustive so the next id added to `SocialId` cannot silently become a globe.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { site } from "@/config/site";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SITE_TS = read("src/config/site.ts");
const SOCIAL_LINKS = code("src/components/primitives/SocialLinks.tsx");

/** The union members, straight from the type — so this cannot drift from it. */
function socialIds(): string[] {
  const m = /export type SocialId\s*=\s*([^;]+);/.exec(SITE_TS);
  if (!m) throw new Error("SocialId is not declared in config/site.ts");
  return [...m[1]!.matchAll(/"([a-z]+)"/g)].map((x) => x[1]!);
}

describe("the socials row", () => {
  it("is rendered by one component everywhere", () => {
    const footer = code("src/components/journey/HomeFooter.tsx");
    expect(footer).toMatch(/<SocialLinks\b/);
    // The tells of the deleted copy: its own map over site.socials, its own switch.
    expect(footer).not.toMatch(/site\.socials\.map/);
    expect(footer).not.toMatch(/function SocialIcon/);
    expect(footer).not.toMatch(/<svg/);
  });

  it("has a glyph for every SocialId — no id falls through to the globe", () => {
    const ids = socialIds().filter((id) => id !== "globe");
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) {
      expect(SOCIAL_LINKS, `SocialIcon has no case for "${id}"`).toMatch(
        new RegExp(`case\\s+"${id}":`),
      );
    }
  });
});

describe("TikTok", () => {
  const tiktok = site.socials.find((s) => s.id === "tiktok");

  it("is in the socials list", () => {
    expect(tiktok).toBeDefined();
  });

  it("points at the project account", () => {
    expect(tiktok!.href).toBe("https://www.tiktok.com/@1grainproject");
  });

  it("has a label that says which network it is", () => {
    // aria-label is the only thing a screen reader gets — the glyph is aria-hidden.
    expect(tiktok!.label).toMatch(/tiktok/i);
  });
});
