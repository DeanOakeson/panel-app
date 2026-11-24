import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";
import { deleteStudentExceptions } from "@/lib/classRoster";

type RouteContext = { params: Promise<{ classId: string; studentId: string }> };

/**
 * Removes a student's enrollment from the class, then their submission
 * exceptions on its assignments. Their submissions and grades stay.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const db = getAdminDb();
    const { classId, studentId } = await params;
    const classDoc = await db.collection("classes").doc(classId).get();
    if (!classDoc.exists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const studentDoc = await db.collection("users").doc(studentId).get();
    if (!studentDoc.exists) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const enrollmentRef = db
      .collection("users")
      .doc(studentId)
      .collection("classes")
      .doc(classId);
    const enrollment = await enrollmentRef.get();
    if (!enrollment.exists) {
      // Finishes the cleanup of an earlier unenroll that failed part way
      await deleteStudentExceptions(classId, studentId);

      return NextResponse.json(
        { error: "Student is not enrolled in this class" },
        { status: 404 }
      );
    }

    // The enrollment goes first, so a grant that starts after it is refused
    // by its own enrollment check and one that committed before it is swept
    await enrollmentRef.delete();
    await deleteStudentExceptions(classId, studentId);

    return NextResponse.json(
      { unenrolled: true, classId, studentId },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "DELETE /api/admin/classes/[classId]/enrollments/[studentId] failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to unenroll student" },
      { status: 500 }
    );
  }
}