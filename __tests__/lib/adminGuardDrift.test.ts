// END-27: admin guard drift test.
//
// END-18 landed the shared `requireAdmin` helper (`lib/adminGuard.ts`) as the
// only supported way for a route to answer "is this caller an admin?". This
// test reads the repo source (no network, no emulators, no Admin SDK) and
// fails the build if any `app/api/**/route.ts` still makes an
// ADMIN_UID-based authorization decision — either directly
// (`decoded.uid === process.env.ADMIN_UID`) or through a local alias of that
// env var (`const adminUid = process.env.ADMIN_UID` + a `===`/`!==` on it).
//
// If you need to allowlist a file, add it to `allowlist` below with a
// one-line reason. Every entry must name a route that still exists, so a
// rename forces a re-review instead of a stale entry surviving forever.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const apiDir = path.join(repoRoot, "app", "api");

/**
 * Routes allowed to keep an ADMIN_UID comparison, with the reason. Keep this
 * list minimal — the drift this test exists to prevent is one entry at a time.
 */
const allowlist: Record<string, string> = {
  "app/api/admin/professors/route.ts":
    "Legacy inline admin-auth guard; migrating it onto requireAdmin is PR #49 (open and green) — remove this entry once #49 merges.",
  "app/api/users/route.ts":
    "The approve/reject guard (uid === ADMIN_UID) is a deliberate privilege-escalation stop that keeps approve/reject from rewriting the admin account, not an admin-auth check — it must stay.",
};

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry === "route.ts") {
      out.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** A comparison operator in its strict or loose form. */
const hasComparison = (line: string): boolean =>
  line.includes("==") || line.includes("!=");

/**
 * Returns the source lines that make an ADMIN_UID authorization decision:
 * either they compare directly against `process.env.ADMIN_UID`, or they
 * compare against a local alias of it declared in the same file.
 */
function findDrift(source: string): string[] {
  const aliasDecl = /const\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\.ADMIN_UID\b/;
  const aliases = [...source.matchAll(new RegExp(aliasDecl, "g"))].map(
    (m) => m[1],
  );

  const hits: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (!hasComparison(line)) return;

    if (line.includes("process.env.ADMIN_UID")) {
      hits.push(`line ${i + 1}: ${line.trim()}`);
    } else {
      for (const alias of aliases) {
        if (new RegExp(`\\b${alias}\\b`).test(line)) {
          hits.push(`line ${i + 1}: ${line.trim()} (via local alias "${alias}")`);
          break;
        }
      }
    }
  });
  return hits;
}

describe("admin guard drift (END-27)", () => {
  const routeFiles = collectRouteFiles(apiDir);

  it("the scan actually found route files", () => {
    // Fail loudly if the repo layout changed so the scan is vacuous — a path
    // refactor must not be able to turn this guard into a silent no-op.
    expect(
      routeFiles,
      "no route.ts files found under app/api — the drift check would pass vacuously; fix the scan if the layout changed.",
    ).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it("allowlist entries still point at real route files", () => {
    const stale = Object.keys(allowlist).filter((rel) => !routeFiles.includes(rel));
    expect(
      stale,
      `stale allowlist entries — remove them or fix the path: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  for (const relPath of routeFiles) {
    it(`has no inline ADMIN_UID authorization: ${relPath}`, () => {
      if (allowlist[relPath]) {
        // Allowlisted on purpose — see the reason in the allowlist above.
        return;
      }

      const source = readFileSync(path.join(repoRoot, relPath), "utf8");
      const hits = findDrift(source);

      expect(
        hits,
        `ADMIN_UID-based authorization in ${relPath}:\n${hits.join("\n")}\n\nUse the shared requireAdmin helper from lib/adminGuard.ts (END-18) instead of comparing against process.env.ADMIN_UID. If the comparison is deliberate, add the file to the allowlist in __tests__/lib/adminGuardDrift.test.ts with a one-line reason.`,
      ).toEqual([]);
    });
  }
});
