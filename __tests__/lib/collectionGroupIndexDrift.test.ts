// END-62: collection-group index drift test.
//
// A filtered collection-group query
// (`db.collectionGroup("submissions").where("studentId", "==", uid)`) needs a
// single-field index with `queryScope: "COLLECTION_GROUP"` in
// firestore.indexes.json. The Firestore emulator does not enforce indexes, so
// our gate stayed green while every one of these queries was guaranteed to
// throw `failed-precondition` on production Firestore (END-62 / PR #57 review
// of 4a0490d): the admin user-delete cascade awaits two of them inside a
// try/catch, so an index error means the delete commits nothing and returns
// 500.
//
// This test reads the repo source (no network, no emulators, no Admin SDK)
// and fails if any `app/api/**/route.ts` contains a `.collectionGroup(...)`
// call whose `.where(...)` filter is not covered by a COLLECTION_GROUP-scoped
// index entry in the real `firestore.indexes.json` at the repo root. It reads
// the actual file, not a copy of the expectations: emptying fieldOverrides
// (or deleting the entries) turns this red.
//
// Note on `fieldOverrides[].indexes`: per the Cloud Firestore index docs, a
// field override REPLACES automatic indexing for that field, so every entry
// here must also re-list the default COLLECTION-scope ASCENDING/DESCENDING
// indexes or collection-scope queries on that field silently lose them.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const apiDir = path.join(repoRoot, "app", "api");
const indexesFile = path.join(repoRoot, "firestore.indexes.json");

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

/**
 * Every (collectionGroup, fieldPath) pair filtered by a collection-group
 * query in a route file. The calls are often split across lines
 * (`...collectionGroup("classes")\n  .where("class_id", ...)`) so the scan
 * runs on whitespace-collapsed source.
 */
function findFilteredCollectionGroups(source: string): Array<{
  collectionGroup: string;
  fieldPath: string;
}> {
  const flat = source.replace(/\s+/g, " ");
  const re = /\.collectionGroup\(\s*["'`](\w+)["'`]\s*\)\s*\.where\(\s*["'`](\w+)["'`]/g;
  const pairs: Array<{ collectionGroup: string; fieldPath: string }> = [];
  for (const m of flat.matchAll(re)) {
    pairs.push({ collectionGroup: m[1], fieldPath: m[2] });
  }
  return pairs;
}

/** All declared scopes for one fieldOverride, keyed collection+field. */
function indexScopesFor(
  file: ReturnType<typeof JSON.parse>,
  collectionGroup: string,
  fieldPath: string,
): Set<string> {
  const override = (file.fieldOverrides ?? []).find(
    (f: { collectionGroup?: string; fieldPath?: string }) =>
      f.collectionGroup === collectionGroup && f.fieldPath === fieldPath,
  );
  return new Set(
    (override?.indexes ?? []).map(
      (i: { queryScope?: string }) => i.queryScope ?? "<missing>",
    ),
  );
}

describe("collection-group index drift (END-62)", () => {
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

  it("firestore.indexes.json exists and parses", () => {
    expect(() => readFileSync(indexesFile, "utf8")).not.toThrow();
    expect(() => JSON.parse(readFileSync(indexesFile, "utf8"))).not.toThrow();
  });

  it("every filtered collection-group query has a COLLECTION_GROUP-scoped index", () => {
    const file = JSON.parse(readFileSync(indexesFile, "utf8"));
    const declared = (file.fieldOverrides ?? []).map(
      (f: { collectionGroup?: string; fieldPath?: string; indexes?: Array<{ queryScope?: string }> }) =>
        `${f.collectionGroup}.${f.fieldPath} -> [${(f.indexes ?? [])
          .map((i) => i.queryScope ?? "<missing>")
          .join(", ")}]`,
    );

    const missing: string[] = [];
    for (const relPath of routeFiles) {
      const source = readFileSync(path.join(repoRoot, relPath), "utf8");
      for (const { collectionGroup, fieldPath } of findFilteredCollectionGroups(source)) {
        const scopes = indexScopesFor(file, collectionGroup, fieldPath);
        if (!scopes.has("COLLECTION_GROUP")) {
          missing.push(
            `${relPath}: collectionGroup("${collectionGroup}").where("${fieldPath}", ...) has no queryScope "COLLECTION_GROUP" entry in firestore.indexes.json ` +
              `(declared for ${collectionGroup}.${fieldPath}: ${scopes.size ? [...scopes].join(", ") : "nothing"}). ` +
              "The emulator does not enforce indexes; on production Firestore this query throws failed-precondition. " +
              "Add a fieldOverrides entry for it (keep the default COLLECTION ASC/DESC scopes listed too — an override replaces automatic indexing for the field).",
          );
        }
      }
    }

    expect(
      missing,
      `undeclared collection-group indexes (would 500 on production Firestore):\n${missing.join("\n")}\n\ncurrently declared fieldOverrides:\n${declared.join("\n") || "(none)"}`,
    ).toEqual([]);
  });
});
