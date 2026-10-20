/**
 * Where each user lands after logging in, based on their users/{uid} profile.
 *
 * Kept free of Firebase imports so it can be unit-tested and shared by the
 * login page, /dashboard, and any other "go home" link.
 */

/** Home view for each role. */
export const HOME_PATHS = {
  // Student course dashboard: the student's enrolled courses
  student: "/classes",
  // Professor home view: "Your courses"
  professor: "/classes",
  // Admin home view: the admin panel
  admin: "/admin",
} as const;

/** Students who applied to be a professor wait here until an admin decides. */
export const PENDING_APPROVAL_PATH = "/pending-approval";

/** Users with no profile, or a role we don't recognize. */
export const NO_ROLE_PATH = "/no-role";

/** The fields of a users/{uid} profile that routing depends on. */
export type RoutableProfile = {
  role?: unknown;
  professorStatus?: unknown;
};

/**
 * Returns the path a user should be sent to. `null` means the user has no
 * profile document at all.
 */
export function getHomePath(profile: RoutableProfile | null): string {
  switch (profile?.role) {
    case "admin":
      return HOME_PATHS.admin;
    case "professor":
      return HOME_PATHS.professor;
    case "student":
      // A rejected applicant is still a student, so only "pending" is held back
      return profile.professorStatus === "pending"
        ? PENDING_APPROVAL_PATH
        : HOME_PATHS.student;
    default:
      return NO_ROLE_PATH;
  }
}
