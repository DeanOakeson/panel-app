// END-60 (browse UI): self-enrollment is the normal path again — the student
// action button is ENROLL, and it writes the roster doc directly (PANEL-26).
// A request that is already in flight (pre-END-60 leftovers) keeps its
// "Requested" badge and can still be withdrawn or decided by an admin.
//
// The row renders three states, in precedence: enrolled -> the green "Enrolled"
// badge; an in-flight request -> the "Requested" badge plus a "Withdraw"
// button (DELETE on the enroll route); otherwise -> the "Enroll" action button
// (POST on the enroll route, in-flight label "Enrolling...").
//
// Like __tests__/lib/adminDashboard.test.ts, the repo has no DOM testing stack,
// so this pins the component source with readFileSync + regex instead of
// rendering. Server behaviour is NOT asserted here:
// __tests__/api/classes/enroll.test.ts covers the route (201 enrolled, 200
// alreadyEnrolled, 200 withdrawn, 404 nothing pending, 409 enrolled) against
// the emulators.

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
  const enrollButtonAt = source.indexOf("void enroll(c.id)", requestedAt);
  return { enrolledAt, requestedAt, enrollButtonAt };
}

describe("browse courses enroll + withdraw flow (END-60)", () => {
  it("renders a Requested badge for an in-flight request, separate from the Enrolled badge", () => {
    // The in-flight-request row carries a static "Requested" badge...
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

  it("offers Withdraw for an in-flight request only, never for an enrollment", () => {
    // Render precedence in the ternary chain: enrolled badge, then the
    // requested branch (which owns the Withdraw button), then the Enroll
    // button. An enrolled row therefore cannot reach the Withdraw control.
    const { enrolledAt, requestedAt, enrollButtonAt } = rowBranches(browse);
    expect(enrolledAt).toBeGreaterThan(-1);
    expect(requestedAt).toBeGreaterThan(enrolledAt);
    expect(enrollButtonAt).toBeGreaterThan(requestedAt);

    const withdrawAt = browse.indexOf("void withdraw(c.id)");
    expect(withdrawAt).toBeGreaterThan(requestedAt);
    expect(withdrawAt).toBeLessThan(enrollButtonAt);

    // The green Enrolled badge sits before the requested branch, so the
    // enrolled row keeps its own badge and gets no button.
    const enrolledBadgeMatch = />\s*Enrolled\s*</.exec(browse.slice(enrolledAt));
    expect(enrolledBadgeMatch).not.toBeNull();
    const enrolledBadgeAt = enrolledAt + (enrolledBadgeMatch?.index ?? 0);
    expect(enrolledBadgeAt).toBeLessThan(requestedAt);
  });

  it("labels the action button Enroll — self-enrollment is the normal path", () => {
    expect(browse).toMatch(/"\s*Enroll\s*"/);
    expect(browse).toMatch(/"\s*Enrolling\.\.\.\s*"/);
    // The old request-button labels are gone: the words would describe an
    // exception as the normal path.
    expect(browse).not.toMatch(/"\s*Requesting\.\.\.\s*"/);
    expect(browse).not.toMatch(/>\s*Request\s*</);
  });

  it("still renders Enrolled, driven by the enrolled field", () => {
    expect(browse).toMatch(/>\s*Enrolled\s*</);
    expect(browse).toMatch(/\bc\.enrolled\b/);
    // The Requested badge is only rendered on the non-enrolled branch, so
    // enrolled rows keep their own badge.
    expect(browse).toMatch(/\bc\.enrolled\s*\?[\s\S]*?\bc\.requested\b/);
  });

  it("enrolls with POST /enroll and withdraws with DELETE /enroll", () => {
    expect(browse).toMatch(
      /fetch\(\s*`\/api\/classes\/\$\{classId\}\/enroll`\s*,\s*\{[\s\S]*?method:\s*"POST"/
    );
    expect(browse).toMatch(
      /fetch\(\s*`\/api\/classes\/\$\{classId\}\/enroll`\s*,\s*\{[\s\S]*?method:\s*"DELETE"/
    );
  });

  it("a successful enroll marks the row enrolled and drops the pending flag", () => {
    // The POST handler marks the row enrolled (the roster doc was written),
    // and the DELETE handler drops `requested` back to false so the row shows
    // the Enroll button again.
    expect(browse).toMatch(/enrolled:\s*true,\s*requested:\s*false/);
    expect(browse).toMatch(/requested:\s*false/);
  });

  it("keeps a Withdraw request single-flight, like the enroll button", () => {
    expect(browse).toMatch(/\bif\s*\(\s*withdrawingId\s*\)\s*return/);
    expect(browse).toMatch(/disabled=\s*\{\s*withdrawingId !== null\s*\}/);
  });

  it("the helper copy makes self-enrollment the normal path, not the exception", () => {
    // "Choosing Enroll adds the course to My classes right away. An
    // administrator can still decide a request that was already waiting."
    expect(browse).toMatch(/adds the course to My classes right away/);
    expect(browse).toMatch(/already waiting/);
    expect(browse).not.toMatch(/assignments/i);
  });
});
