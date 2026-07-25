/**
 * Grains persistence smoke test (Phase 1 scratch — safe to delete).
 *
 * Exercises src/lib/grains/db.ts end-to-end against a throwaway DB: opens it,
 * runs the migration, calls addGrains() twice for a fake visitor, and prints the
 * global / country / visitor totals so you can eyeball that all three counters
 * reflect BOTH writes.
 *
 *   pnpm exec tsx scripts/grains-smoke.ts
 *
 * Uses a temp GRAINS_DB_PATH so it never touches the real game DB. This is a
 * scratch harness, not part of the app — do not import it anywhere.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Configure a throwaway DB + dummy secrets BEFORE importing the db module (env
// is read on first use). Never point this at the production GRAINS_DB_PATH.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grains-smoke-"));
process.env.GRAINS_DB_PATH = path.join(tmpDir, "grains.db");
process.env.GRAINS_IP_SALT = process.env.GRAINS_IP_SALT ?? "smoke-test-salt-0123456789abcdef0123456789";
process.env.GRAINS_COOKIE_SECRET =
  process.env.GRAINS_COOKIE_SECRET ?? "smoke-test-cookie-0123456789abcdef0123456789";

async function main(): Promise<void> {
  // Import after env is set (the db module reads env lazily on first use).
  // The explicit .ts extension is required by tsx's ESM resolver; tsc would
  // otherwise flag it (this scratch harness only ever runs under tsx).
  // @ts-ignore -- allowImportingTsExtensions is off project-wide; scratch-only.
  const { addGrains, getGlobalTotal, getTopCountries, getVisitor, hashIp } = await import("../src/lib/grains/db.ts");

  const VID = "smoke-vid-001";
  const ipHash = hashIp("203.0.113.7"); // TEST-NET-3 example address

  console.log("DB:", process.env.GRAINS_DB_PATH);
  console.log("ip_hash:", ipHash);

  // Two separate writes for the same visitor/country.
  const afterFirst = addGrains(VID, ipHash, "JP", "Japan", 5);
  const afterSecond = addGrains(VID, ipHash, "JP", "Japan", 3);

  console.log("\nglobal total after write #1 (expect 5):", afterFirst);
  console.log("global total after write #2 (expect 8):", afterSecond);

  const global = getGlobalTotal();
  const visitor = getVisitor(VID);
  const countries = getTopCountries(10);

  console.log("\ngetGlobalTotal() (expect 8):", global);
  console.log("getVisitor(VID).total (expect 8):", visitor?.total);
  console.log("getTopCountries(10):", countries);

  // Cross-check + explicit pass/fail so this doubles as a self-verifying probe.
  const jp = countries.find((c) => c.code === "JP");
  const ok =
    global === 8 &&
    visitor?.total === 8 &&
    jp?.total === 8 &&
    typeof visitor?.first_seen === "number" &&
    typeof visitor?.last_seen === "number" &&
    visitor.last_seen >= visitor.first_seen;

  console.log("\nSMOKE", ok ? "PASS ✅" : "FAIL ❌");

  // Clean up the throwaway DB (+ WAL/SHM sidecars).
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (!ok) process.exit(1);
}

main().catch((err) => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.error(err);
  process.exit(1);
});
