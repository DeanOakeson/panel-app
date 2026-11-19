// PANEL-89: every Course Navigation link must lead to a page that exists.
//
// The repo has no DOM testing stack, so this reads the course layout source
// like __tests__/lib/adminNavLinks.test.ts reads the admin home. The sidebar
// once linked to /modules with no page behind it, which sent people to a bare
// 404 that also dropped the course sidebar.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const courseDir = path.join(repoRoot, "app", "classes", "[classId]");

const courseLayout = readFileSync(path.join(courseDir, "layout.tsx"), "utf8");

/** Every `path: "..."` entry in the course navigation's items list. */
function courseNavPaths(source: string): string[] {
  const list = source.match(/const items = \[([\s\S]*?)\];/);
  if (!list) return [];
  return [...list[1].matchAll(/path:\s*"([^"]*)"/g)].map((match) => match[1]);
}

/** Does a page exist at app/classes/[classId]{navPath}/page.tsx? */
function coursePageExists(navPath: string): boolean {
  const segments = navPath.split("/").filter(Boolean);
  return existsSync(path.join(courseDir, ...segments, "page.tsx"));
}

describe("course navigation", () => {
  it("links to the course home, assignments and grades", () => {
    expect(courseNavPaths(courseLayout)).toEqual(
      expect.arrayContaining(["", "/assignments", "/grades"])
    );
  });

  it("every link points at a page that exists", () => {
    const paths = courseNavPaths(courseLayout);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((navPath) => !coursePageExists(navPath))).toEqual([]);
  });
});
