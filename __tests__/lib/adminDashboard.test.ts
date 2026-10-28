// END-23 (dashboard): the /admin dashboard replaced its placeholder tiles with
// real data from GET /api/admin/summary, logout moved from the /admin/professors
// page into the shared app/admin/layout.tsx header, and the two user tiles now
// deep-link into /admin/users with the role filter applied.
//
// Like __tests__/lib/adminNavLinks.test.ts, the repo has no DOM testing stack,
// so this pins the page sources with readFileSync + regex instead of rendering.
// It deliberately does NOT re-check that /admin/* hrefs resolve to real pages —
// adminNavLinks.test.ts already does that, and the query-string hrefs below are
// object-literal `href:` values rather than `href="..."` JSX attributes, so that
// regex never sees them and this file owns their matching.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function readSource(...segments: string[]): string {
  return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

/**
 * Comments are prose about the code, not rendered output: the dashboard's comment
 * says the tiles are "no longer 'coming soon' placeholders" and the professors
 * page's comment says "Log out lives in the shared admin header now". Matching
 * against raw source would make those explanatory comments fail the very
 * assertions they document, so comments come out first.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // A `//` preceded by `:` is a URL inside a string, not a comment.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const adminHome = stripComments(readSource("app", "admin", "page.tsx"));
const adminLayout = stripComments(readSource("app", "admin", "layout.tsx"));
const professorsPage = stripComments(readSource("app", "admin", "professors", "page.tsx"));

describe("admin dashboard (END-23)", () => {
  it("the admin home fetches /api/admin/summary", () => {
    expect(adminHome).toMatch(/fetch\(\s*"\/api\/admin\/summary"/);
  });

  it("the admin home renders no 'coming soon' placeholder", () => {
    expect(adminHome.toLowerCase()).not.toMatch(/coming\s+soon/);
  });

  it.each(["student", "professor"])(
    "the %s tile links to the user list with the role filter applied",
    (role) => {
      expect(adminHome).toContain(`"/admin/users?role=${role}"`);
    }
  );

  it("the shared admin header owns sign-out and links back to /admin", () => {
    // The layout is the only logout for the section: it calls signOut and offers
    // a route home for the dashboard.
    expect(adminLayout).toMatch(/\bsignOut\b/);
    expect(adminLayout).toMatch(/href="\/admin"/);
  });

  it("the professors page has no page-local logout of its own", () => {
    // Two logout buttons on one screen is what Kevin flagged; the shared header
    // above the page is now the only one.
    expect(professorsPage).not.toMatch(/\bsignOut\b/);
    expect(professorsPage).not.toContain("Log out");
  });
});
