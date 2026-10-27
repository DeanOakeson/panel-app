// END-22: the admin home must actually reach the user list.
//
// The repo has no DOM testing stack, so this reads the page source like
// __tests__/lib/adminGuardDrift.test.ts reads the routes. It pins two things:
// the admin home links to /admin/users, and every /admin/* link it renders
// points at a route that exists — a renamed or deleted page silently strands
// its nav button, which is how the user list nearly shipped unreachable.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const adminHome = readFileSync(
  path.join(repoRoot, "app", "admin", "page.tsx"),
  "utf8"
);

/** Every distinct `href="/admin/..."` literal in the admin home page. */
function adminHrefLinks(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/href="(\/admin\/[^"]*)"/g)) {
    found.add(match[1]);
  }
  return [...found];
}

/** Does a page exist at app{href}/page.tsx? */
function pageExists(href: string): boolean {
  return existsSync(path.join(repoRoot, "app", ...href.split("/"), "page.tsx"));
}

describe("admin home navigation", () => {
  it("links to the user list (/admin/users)", () => {
    expect(adminHrefLinks(adminHome)).toContain("/admin/users");
  });

  it("every /admin/* link points at a page that exists", () => {
    const links = adminHrefLinks(adminHome);
    expect(links.length).toBeGreaterThan(0);
    expect(links.filter((href) => !pageExists(href))).toEqual([]);
  });
});
