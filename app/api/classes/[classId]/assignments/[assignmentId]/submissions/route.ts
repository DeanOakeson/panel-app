import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { authorizeAssignmentProfessor } from "@/lib/assignmentAccess";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string }>;
};

/**
 * Lists an assignment's submissions, sorted by student name. Each submission
 * is keyed by the student's uid and carries the student's name, email, and
 * grade (null until graded).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId } = await params;
    const auth = await authorizeAssignmentProfessor(request, classId, assignmentId);
    if (auth.error) return auth.error;

    const db = getAdminDb();
    const [snapshot, gradeSnapshot] = await Promise.all([
      auth.assignmentDoc.ref.collection("submissions").get(),
      auth.assignmentDoc.ref.collection("grades").get(),
    ]);

    // getAll() rejects an empty argument list
    const studentDocs = snapshot.empty
      ? []
      : await db.getAll(
          ...snapshot.docs.map((doc) => db.collection("users").doc(doc.id))
        );
    const students = new Map(
      studentDocs.map((studentDoc) => [studentDoc.id, studentDoc.data()])
    );
    const grades = new Map(
      gradeSnapshot.docs.map((gradeDoc) => [gradeDoc.id, gradeDoc.data()])
    );

    const submissions = snapshot.docs.map((doc) => {
      const student = students.get(doc.id);

      return {
        id: doc.id,
        ...doc.data(),
        studentName: (student?.name as string | undefined) ?? null,
        studentEmail: (student?.email as string | undefined) ?? null,
        grade: grades.get(doc.id) ?? null,
      };
    });

    const sortKey = (submission: (typeof submissions)[number]) =>
      submission.studentName ?? submission.studentEmail ?? submission.id;
    submissions.sort((first, second) =>
      sortKey(first).localeCompare(sortKey(second))
    );

    return NextResponse.json(
      {
        assignment: { id: auth.assignmentDoc.id, ...auth.assignmentDoc.data() },
        submissions,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "GET /api/classes/[classId]/assignments/[assignmentId]/submissions failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to load submissions." },
      { status: 500 }
    );
  }
}
