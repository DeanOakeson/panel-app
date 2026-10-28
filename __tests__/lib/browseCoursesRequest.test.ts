// END-57 (browse UI, re-anchored onto 5ffbd22): the student action button is a
// REQUEST, and a pending request can be withdrawn again.
//
// The row renders three states, in precedence: enrolled -> the green "Enrolled"
// badge; a pending request -> the "Requested" badge plus a "Withdraw" button
// (DELETE on the enroll route); otherwise -> the "Request" action button (POST
// on the enroll route, in-flight label "Requesting...").
//
// Like __tests__/lib/adminDashboard.test.ts, the repo has no DOM testing stack,
// so this pins the component source with readFileSync + regex instead of
// rendering. Server behaviour is NOT asserted here:
// __tests__/api/classes/enroll.test.ts covers the route (200 withdrawn, 404
// nothing pending, 409 enrolled) against the emulators.

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
 * Comments are prose about the code, not rendered output: the component keeps
 * explanatory comments, and matching against raw source would let those words
 * satisfy assertions about rendered UI, so comments come out first.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // A `//` preceded by `:` is a URL inside a string, not a comment.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const browse = stripComments(readSource("app", "components", "classes", "BrowseCourses.tsx"));

/** The three row states, sliced out of the ternary chain in render order. */
function rowBranches(source: string) {
  const enrolledAt = source.indexOf("c.enrolled ?");
  const requestedAt = source.indexOf("c.requested ?", enrolledAt);
  const requestButtonAt = source.indexOf("void request(c.id)", requestedAt);
  return { enrolledAt, requestedAt, requestButtonAt };
}

describe("browse courses request + withdraw flow (END-57)", () => {
  it("renders a Requested badge for a pending request, separate from the Enrolled badge", () => {
    // The pending-request row carries a static "Requested" badge...
    expect(browse).toMatch(/>[\s\S]*?>\s*Requested\s*</);
    // ...plus a small "Withdraw" button next to it ("Withdrawing..." in flight).
    expect(browse).toMatch(
      /\{\s*withdrawingId === c\.id \? "Withdrawing\.\.\." : "Withdraw"\s*\}/
    );
    expect(browse).toMatch(/\bvoid\s+withdraw\(c\.id\)/);
    // ...and that badge is NOT the same element as the green "Enrolled" badge,
    // so the enrolled state was not repurposed.
    expect(browse).not.toMatch(/>[\s\S]*?>\s*Requested[\s\S]*?text-green-100/);
  });

  it("offers Withdraw for a pending request only, never for an enrollment", () => {
    // Render precedence in the ternary chain: enrolled badge, then the
    // requested branch (which owns the Withdraw button), then the Request
    // button. An enrolled row therefore cannot reach the Withdraw control.
    const { enrolledAt, requestedAt, requestButtonAt } = rowBranches(browse);
    expect(enrolledAt).toBeGreaterThan(-1);
    expect(requestedAt).toBeGreaterThan(enrolledAt);
    expect(requestButtonAt).toBeGreaterThan(requestedAt);

    const withdrawAt = browse.indexOf("void withdraw(c.id)");
    expect(withdrawAt).toBeGreaterThan(requestedAt);
    expect(withdrawAt).toBeLessThan(requestButtonAt);

    // The green Enrolled badge sits before the requested branch, so the
    // enrolled row keeps its own badge and gets no button.
    const enrolledBadgeMatch = />\s*Enrolled\s*</.exec(browse.slice(enrolledAt));
    expect(enrolledBadgeMatch).not.toBeNull();
    const enrolledBadgeAt = enrolledAt + (enrolledBadgeMatch?.index ?? 0);
    expect(enrolledBadgeAt).toBeLessThan(requestedAt);
  });

  it("labels the action button Request, and the regex cannot match Enrolled", () => {
    // \bEnroll\b would also match "Enrolled", so the pin uses lookarounds
    // that exclude any character after the word.
    expect(browse).toMatch(/"\s*Request\s*"/);
    expect(browse).toMatch(/"\s*Requesting\.\.\.\s*"/);
    expect(browse).not.toMatch(/"\s*Enroll(?!ed)\b[^"]*"/);
  });

  it("still renders Enrolled, driven by the enrolled field", () => {
    expect(browse).toMatch(/>\s*Enrolled\s*</);
    expect(browse).toMatch(/\bc\.enrolled\b/);
    // The Requested badge is only rendered on the non-enrolled branch, so
    // enrolled rows keep their own badge.
    expect(browse).toMatch(/\bc\.enrolled\s*\?[\s\S]*?\bc\.requested\b/);
  });

  it("creates a request with POST /enroll and withdraws with DELETE /enroll", () => {
    expect(browse).toMatch(
      /fetch\(\s*`\/api\/classes\/\$\{classId\}\/enroll`\s*,\s*\{[\s\S]*?method:\s*"POST"/
    );
    expect(browse).toMatch(
      /fetch\(\s*`\/api\/classes\/\$\{classId\}\/enroll`\s*,\s*\{[\s\S]*?method:\s*"DELETE"/
    );
  });

  it("a successful withdraw clears the pending request locally, a successful request sets it", () => {
    // The POST handler must not mark the row enrolled, and the DELETE handler
    // must drop `requested` back to false so the row shows "Request" again.
    expect(browse).toMatch(/requested:\s*!enrolledNow/);
    expect(browse).toMatch(/requested:\s*false/);
    expect(browse).not.toMatch(/enrolled:\s*true\s*\}/);
  });

  it("keeps a Withdraw request single-flight, like the request button", () => {
    expect(browse).toMatch(/\bif\s*\(\s*withdrawingId\s*\)\s*return/);
    expect(browse).toMatch(/disabled=\s*\{\s*withdrawingId !== null\s*\}/);
  });

  it("the helper copy says a request needs approval and no longer promises assignments", () => {
    expect(browse).toMatch(/approv/i);
    expect(browse).toMatch(/administrator|admin/i);
    expect(browse).not.toMatch(/assignments/i);
  });
});
