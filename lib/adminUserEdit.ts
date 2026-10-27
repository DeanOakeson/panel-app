/**
 * The edit-row logic for `app/admin/users/page.tsx`, kept out of the component
 * so it can be unit-tested in the node test environment (the repo has no DOM
 * testing stack, so the decisions that decide *what gets sent to the server*
 * are pinned here instead of through rendered markup).
 */

/** Roles an admin can move someone into — mirrors the API's ASSIGNABLE_ROLES. */
export const ASSIGNABLE_ROLES = ["student", "professor"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/**
 * Whether the edit row may offer a role dropdown for this user.
 *
 * False in two cases, and both matter to what the PATCH body is allowed to
 * contain:
 * - the row's current role is not assignable (an `admin`, or a missing/unknown
 *   role): this endpoint refuses to move anyone into or out of `admin`, so a
 *   dropdown would be a lie;
 * - the row is the signed-in admin's own: the server refuses a self role change
 *   so the last admin cannot be locked out.
 */
export function canEditRole(role: string, isSelf: boolean): boolean {
  return isAssignableRole(role) && !isSelf;
}

export type UserChanges = {
  /** The stored name, as it arrived from the list. */
  targetName: string;
  /** The stored role, as it arrived from the list. */
  targetRole: string;
  /** Is this the signed-in admin's own row? */
  isSelf: boolean;
  /** Name currently typed in the input (already trimmed). */
  name: string;
  /** Role currently selected in the dropdown. */
  role: AssignableRole;
};

/**
 * Build the PATCH body for an edited row: only fields that actually changed,
 * and `role` only when the dropdown was shown *and* enabled.
 *
 * The `role` guard is the one that prevents a silent demotion. `editRole` has
 * to hold something when the dropdown is hidden — an admin row has no
 * assignable role to seed it with, so it holds the default `"student"`. If the
 * body builder compared that placeholder against the stored role, renaming an
 * admin would send `role: "student"`: renaming yourself would fail the
 * self-role guard outright, and renaming another admin would demote them to
 * student while the row reported a successful save.
 *
 * An empty object means "nothing to save" — the caller closes the editor
 * instead of issuing a request.
 */
export function buildUserChanges({
  targetName,
  targetRole,
  isSelf,
  name,
  role,
}: UserChanges): Record<string, string> {
  const changes: Record<string, string> = {};
  if (name !== targetName) changes.name = name;
  if (canEditRole(targetRole, isSelf) && role !== targetRole) {
    changes.role = role;
  }
  return changes;
}
