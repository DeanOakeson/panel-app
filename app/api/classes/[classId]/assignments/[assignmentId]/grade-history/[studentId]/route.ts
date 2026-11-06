import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";
import { loadGradeHistory, type GradeHistoryEntry } from "@/lib/gradeHistory";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

/**
 * Returns every saved version of a student's grade, oldest first, each with
 * the saver's name (null without a profile). Versions saved as a missing-work
 * grade have no submittedAt. Only the class's professor and admins can read
 * it. Students see their current grade only.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId, studentId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (!access.isClassProfessor && !access.isAdmin) {
      return NextResponse.json(
        { error: "Only this class's professor or an admin can view grade history." },
        { status: 403 }
      );
    }

    const db = getAdminDb();
    const assignmentRef = db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId);

    if (!(await assignmentRef.get()).exists) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const grade = await loadGradeHistory(assignmentRef.collection("grades").doc(studentId));

    const saverIds = [...new Set(grade.map((entry) => entry.savedBy))];
    // getAll() rejects an empty argument list
    const savers = saverIds.length === 0
      ? []
      : await db.getAll(...saverIds.map((uid) => db.collection("users").doc(uid)));
    const names = new Map(
      savers.map((saver) => [
        saver.id,
        (saver.data()?.name as string | undefined) ??
          (saver.data()?.email as string | undefined) ??
          null,
      ])
    );

    const withName = (entry: GradeHistoryEntry) => ({
      ...entry,
      savedByName: names.get(entry.savedBy) ?? null,
    });

    return NextResponse.json({ grade: grade.map(withName) });
  } catch (error) {
    console.error(
      "GET /api/classes/[classId]/assignments/[assignmentId]/grade-history/[studentId] failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to load grade history." },
      { status: 500 }
    );
  }
}
