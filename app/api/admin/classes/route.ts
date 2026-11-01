import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { loadAdminClasses } from "@/lib/adminClasses";

/**
 * ADMIN-ONLY. Lists every class with its professor and how many students are
 * enrolled, so the admin can see the whole catalogue on one page.
 *
 *   GET /api/admin/classes       -> every class
 *   GET /api/admin/classes?q=cs  -> classes whose name or course code contains
 *                                   q, case-insensitively (server-side filter;
 *                                   at class scale this is cheaper than an
 *                                   index-backed range query)
 *
 * Read-only by design: editing and deleting a course live in the course detail
 * routes (END-19/END-20). Everything is read with the Admin SDK — the client
 * only ever talks to this route, never to Firestore directly.
 *
 * The professor join and the enrollment count live in lib/adminClasses.ts
 * because the /admin dashboard reads through GET /api/admin/summary: one
 * implementation, so the two pages can never report different numbers for the
 * same course.
 */
export async function GET(req: Request) {
  try {
    const { error } = await requireAdmin(req);
    if (error) return error;

    const search = new URL(req.url).searchParams.get("q") ?? "";
    const classes = await loadAdminClasses(search);

    return NextResponse.json({ classes }, { status: 200 });
  } catch (error) {
    console.error("GET /api/admin/classes error:", error);
    return NextResponse.json({ error: "Failed to load classes." }, { status: 500 });
  }
}
