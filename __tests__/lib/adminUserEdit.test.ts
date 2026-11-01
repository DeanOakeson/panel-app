import { describe, expect, it } from "vitest";
import {
  buildUserChanges,
  canEditRole,
  isAssignableRole,
} from "@/lib/adminUserEdit";

/**
 * These cover what the admin user list page *sends*, not what it renders — the
 * repo has no DOM testing stack, so the row-edit decisions live in
 * `lib/adminUserEdit.ts` and are pinned here.
 *
 * The bug this file exists for: an edit row whose role dropdown is hidden (an
 * admin row, or the signed-in admin's own row) still holds a placeholder value
 * in `editRole`. Comparing that placeholder to the stored role made a plain
 * rename look like a role change, so renaming an admin sent `role: "student"` —
 * a silent demotion reported as a successful save.
 */

describe("isAssignableRole", () => {
  it.each(["student", "professor"])("accepts %s", (role) => {
    expect(isAssignableRole(role)).toBe(true);
  });

  it.each(["admin", "Admin", "ADMIN", "", "janitor", "studnet"])(
    "rejects %j",
    (role) => {
      expect(isAssignableRole(role)).toBe(false);
    }
  );
});

describe("canEditRole", () => {
  it("offers the dropdown for an assignable role on someone else's row", () => {
    expect(canEditRole("student", false)).toBe(true);
    expect(canEditRole("professor", false)).toBe(true);
  });

  it("offers nothing for the admin's own row", () => {
    expect(canEditRole("student", true)).toBe(false);
    expect(canEditRole("professor", true)).toBe(false);
  });

  it.each(["admin", "", "unknown"])(
    "offers nothing for the non-assignable role %j",
    (role) => {
      expect(canEditRole(role, false)).toBe(false);
      expect(canEditRole(role, true)).toBe(false);
    }
  );
});

describe("buildUserChanges", () => {
  const studentRow = {
    targetName: "Ada",
    targetRole: "student",
    isSelf: false,
  };

  it("sends nothing when the row is untouched", () => {
    expect(
      buildUserChanges({ ...studentRow, name: "Ada", role: "student" })
    ).toEqual({});
  });

  it("sends only the new name", () => {
    expect(
      buildUserChanges({ ...studentRow, name: "Ada L.", role: "student" })
    ).toEqual({ name: "Ada L." });
  });

  it("sends only the new role", () => {
    expect(
      buildUserChanges({ ...studentRow, name: "Ada", role: "professor" })
    ).toEqual({ role: "professor" });
  });

  it("sends both when both changed", () => {
    expect(
      buildUserChanges({ ...studentRow, name: "Ada L.", role: "professor" })
    ).toEqual({ name: "Ada L.", role: "professor" });
  });

  // The regression this whole file guards.
  it("never sends role when renaming an admin row", () => {
    expect(
      buildUserChanges({
        targetName: "Root",
        targetRole: "admin",
        isSelf: false,
        name: "Root User",
        role: "student", // the hidden dropdown's placeholder
      })
    ).toEqual({ name: "Root User" });
  });

  it("never sends role for an unrecognized role either", () => {
    expect(
      buildUserChanges({
        targetName: "Ghost",
        targetRole: "",
        isSelf: false,
        name: "Ghost",
        role: "professor",
      })
    ).toEqual({});
  });

  it("never sends role when the admin edits their own row", () => {
    expect(
      buildUserChanges({
        targetName: "Me",
        targetRole: "student",
        isSelf: true,
        name: "Me",
        role: "professor",
      })
    ).toEqual({});

    // Renaming yourself is still a plain name change.
    expect(
      buildUserChanges({
        targetName: "Me",
        targetRole: "admin",
        isSelf: true,
        name: "K. Pett",
        role: "student",
      })
    ).toEqual({ name: "K. Pett" });
  });
});
