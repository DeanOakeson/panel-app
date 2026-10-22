import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string }>;
};

/**
 * Verifies the caller is the professor assigned to this class and that the
 * assignment exists. Returns the assignment's document, or an error response.
 */
async function authorizeClassProfessor(
  request: NextRequest,
  classId: string,
  assignmentId: string
) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      ),
    };
  }

  let uid: string;

  try {
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid or expired authentication token." },
        { status: 401 }
      ),
    };
  }

  const db = getAdminDb();
  const [userDoc, classDoc, assignmentDoc] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("classes").doc(classId).get(),
    db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId)
      .get(),
  ]);

  if (!classDoc.exists) {
    return {
      error: NextResponse.json({ error: "Class not found." }, { status: 404 }),
    };
  }

  if (
    userDoc.data()?.role !== "professor" ||
    classDoc.data()?.professor_id !== uid
  ) {
    return {
      error: NextResponse.json(
        { error: "Only this class's professor can view submissions." },
        { status: 403 }
      ),
    };
  }

  if (!assignmentDoc.exists) {
    return {
      error: NextResponse.json(
        { error: "Assignment not found." },
        { status: 404 }
      ),
    };
  }

  return { assignmentDoc };
}

/**
 * Lists an assignment's submissions, sorted by student name. Each submission
 * is keyed by the student's uid and carries the student's name and email.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId } = await params;
    const auth = await authorizeClassProfessor(request, classId, assignmentId);
    if (auth.error) return auth.error;

    const db = getAdminDb();
    const snapshot = await auth.assignmentDoc.ref.collection("submissions").get();

    // getAll() rejects an empty argument list
    const studentDocs = snapshot.empty
      ? []
      : await db.getAll(
          ...snapshot.docs.map((doc) => db.collection("users").doc(doc.id))
        );
    const students = new Map(
      studentDocs.map((studentDoc) => [studentDoc.id, studentDoc.data()])
    );

    const submissions = snapshot.docs.map((doc) => {
      const student = students.get(doc.id);

      return {
        id: doc.id,
        ...doc.data(),
        studentName: (student?.name as string | undefined) ?? null,
        studentEmail: (student?.email as string | undefined) ?? null,
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
