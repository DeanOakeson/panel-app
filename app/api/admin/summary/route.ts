import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { countUsersByRole, loadAdminClasses } from "@/lib/adminClasses";

/**
 * ADMIN-ONLY. Everything the /admin dashboard needs in one read: the three
 * tile counts and the course table rows.
 *
 *   GET /api/admin/summary -> { students, professors, courses, classes }
 *
 * `classes` is exactly what GET /api/admin/classes returns for the same data —
 * both go through loadAdminClasses, so the dashboard's professor column and
 * enrolled-student counts can never drift from the course list page. Read-only
 * by design, Admin SDK only, and the client never touches Firestore directly.
 *
 * `courses` is the count of classes documents; the course rows themselves are
 * under `classes` so the two names mean different things in one payload.
 */
export async function GET(req: Request) {
  try {
    const { error } = await requireAdmin(req);
    if (error) return error;

    const [students, professors, classes] = await Promise.all([
      countUsersByRole("student"),
      countUsersByRole("professor"),
      loadAdminClasses(),
    ]);

    return NextResponse.json(
      { students, professors, courses: classes.length, classes },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET /api/admin/summary error:", error);
    return NextResponse.json({ error: "Failed to load dashboard data." }, { status: 500 });
  }
}
