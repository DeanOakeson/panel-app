import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { loadEnrollmentRequests } from "@/lib/enrollmentRequests";

/**
 * ADMIN-ONLY. Every course request a student has made that no one has answered
 * yet, each with the course it is for and the student who asked:
 *
 *   GET /api/admin/requests
 *     -> { requests: [{ classId, courseCode, name, term, year, section,
 *                       studentUid, studentName, studentEmail, requestedAt }] }
 *
 * This is the read that answers "which course did this student ask to join?" —
 * the question the admin enrollment view could not answer before END-54. Every
 * row carries its course (code, name, term, year, section) and its student
 * (name, email); a request whose course or student can no longer be resolved is
 * dropped by lib/enrollmentRequests.ts rather than shown as a nameless row.
 *
 * Read-only and Admin SDK only, like every other admin route; the client never
 * touches `users/{uid}.requestedCourses` directly.
 */
export async function GET(req: Request) {
  try {
    const { error } = await requireAdmin(req);
    if (error) return error;

    const requests = await loadEnrollmentRequests();

    return NextResponse.json({ requests }, { status: 200 });
  } catch (error) {
    console.error("GET /api/admin/requests error:", error);

    return NextResponse.json(
      { error: "Failed to load enrollment requests." },
      { status: 500 }
    );
  }
}
