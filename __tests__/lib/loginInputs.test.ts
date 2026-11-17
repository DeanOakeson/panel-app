// PANEL-87: the login inputs were white text with a currentColor (white)
// border on a white card, so light-mode users signed in blind.
//
// The repo has no DOM testing stack, so this reads the page source.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

describe("login form inputs", () => {
  const loginPage = readFileSync(
    path.join(repoRoot, "app", "login", "page.tsx"),
    "utf8"
  );
  const fieldClasses = [
    ...loginPage.matchAll(/<(?:input|select)\b[\s\S]*?className="([^"]*)"/g),
  ].map((match) => match[1].split(/\s+/));

  it("finds the form's fields", () => {
    expect(fieldClasses.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every field readable light-mode text and a visible border", () => {
    for (const classes of fieldClasses) {
      expect(classes).not.toContain("text-white");
      expect(classes.some((c) => /^text-gray-(7|8|9)00$/.test(c))).toBe(true);
      expect(classes.some((c) => /^border-gray-\d+$/.test(c))).toBe(true);
    }
  });
});
