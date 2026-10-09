/** Roles a user can have, stored as `role` on their `users/{uid}` record. */
export const ROLES = ["student", "professor", "admin"] as const;

/** One of the roles in `ROLES`. */
export type Role = (typeof ROLES)[number];

/** Returns whether `value` is one of the roles in `ROLES`. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
