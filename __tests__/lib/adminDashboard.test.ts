// END-23 (dashboard): the /admin dashboard replaced its placeholder tiles with
// real data from GET /api/admin/summary, logout moved from the /admin/professors
// page into the shared admin header, and the two user tiles now deep-link into
// /admin/users with the role filter applied.
//
// END-61 (merge of main): since #56/PANEL-84 the shared header is no longer
// inline in app/admin/layout.tsx — it is app/components/admin/AdminHeader.tsx
// (the bar itself, including the link back to /admin) plus
// app/components/admin/LogoutButton.tsx (the sign-out). The layout only gates
// and mounts them, so the assertions below read the two components that own the
// behavior instead of the layout.
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
const adminHeader = stripComments(
  readSource("app", "components", "admin", "AdminHeader.tsx")
);
const logoutButton = stripComments(
  readSource("app", "components", "admin", "LogoutButton.tsx")
);
const professorsPage = stripComments(readSource("app", "admin", "professors", "page.tsx"));
const usersPage = stripComments(readSource("app", "admin", "users", "page.tsx"));

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
    // The header is the only logout for the section. Since #56 those two
    // behaviors live in the extracted components rather than in the layout, so
    // each is pinned where it is implemented: the button must actually call
    // signOut, and the bar must carry the href home.
    expect(logoutButton).toMatch(/\bsignOut\b/);
    expect(adminHeader).toMatch(/href="\/admin"/);
    // And the layout must still mount the bar, or "shared header" is a lie.
    expect(adminLayout).toMatch(/<AdminHeader\b/);
  });

  it("the professors page has no page-local logout of its own", () => {
    // Two logout buttons on one screen is what Kevin flagged; the shared header
    // above the page is now the only one.
    expect(professorsPage).not.toMatch(/\bsignOut\b/);
    expect(professorsPage).not.toContain("Log out");
  });
});

// PANEL-22/23: the dashboard's "View all students" / "View all professors"
// tiles deep-link into /admin/users?role=..., so that page is where the
// per-user course data has to show up: each student's enrolled courses, each
// professor's courses with the students in each roster. The repo has no DOM
// stack, so like the dashboard tests above this pins the page source.
describe("admin users page course data (END-60 / PANEL-22/23)", () => {
  it("renders the per-user course data the user list API returns", () => {
    // A student row's courses and a professor row's taught courses are both
    // driven by the payload's fields.
    expect(usersPage).toMatch(/\buser\.courses\b/);
    expect(usersPage).toMatch(/\buser\.teaching\b/);
  });

  it("expands a row into a detail cell rather than replacing the table", () => {
    // One row open at a time, toggled by the Courses cell; the detail is a
    // full-width second row, so edit/delete on the main row stay untouched.
    expect(usersPage).toMatch(/\bexpandedUid\b/);
    expect(usersPage).toMatch(/aria-expanded=/);
    expect(usersPage).toMatch(/colSpan=/);
  });

  it("professor detail shows each course's roster, student detail shows their courses", () => {
    // The roster renders member labels (name with email fallback)...
    expect(usersPage).toMatch(/rosterMemberLabel/);
    expect(usersPage).toMatch(/course\.students\b/);
    // ...and both roles fall back to a quiet empty state, never a blank cell.
    expect(usersPage).toMatch(/No students enrolled\./);
    expect(usersPage).toMatch(/Not enrolled in any courses\./);
  });

  it("keeps the role filter tabs that the dashboard tiles link to", () => {
    expect(usersPage).toMatch(/setFilterOverride/);
    expect(usersPage).toMatch(/ROLE_FILTERS/);
  });
});
