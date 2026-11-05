import { NextRequest, NextResponse } from "next/server";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";
import { isStudentEnrolled } from "@/lib/classRoster";
import { readJsonBody, readScoreAndFeedback } from "@/lib/gradeInput";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

type MissingGradeRequest = {
  classId: string;
  assignmentId: string;
  studentId: string;
  uid: string;
  db: Firestore;
  assignmentRef: DocumentReference;
  body: Record<string, unknown>;
  score: number;
  feedback: string;
};

/**
 * Checks that the caller is the class's professor or an admin, that the
 * assignment exists, and that the body holds a valid score and feedback.
 * Returns the parsed request, or an error response.
 */
async function readMissingGradeRequest(
  request: NextRequest,
  { params }: RouteContext
): Promise<MissingGradeRequest | { error: NextResponse }> {
  const { classId, assignmentId, studentId } = await params;
  const access = await getClassAccess(request, classId);
  if (access.error) return { error: access.error };

  if (!access.isClassProfessor && !access.isAdmin) {
    return {
      error: NextResponse.json(
        { error: "Only this class's professor or an admin can grade missing work." },
        { status: 403 }
      ),
    };
  }

  const db = getAdminDb();
  const assignmentRef = db
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
  const assignmentDoc = await assignmentRef.get();

  if (!assignmentDoc.exists) {
    return {
      error: NextResponse.json(
        { error: "Assignment not found." },
        { status: 404 }
      ),
    };
  }

  const body = await readJsonBody(request);

  if (body === null) {
    return {
      error: NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      ),
    };
  }

  const scoreAndFeedback = readScoreAndFeedback(
    body,
    assignmentDoc.data()?.points as number
  );

  if ("error" in scoreAndFeedback) {
    return {
      error: NextResponse.json(
        { error: scoreAndFeedback.error },
        { status: 400 }
      ),
    };
  }

  return {
    classId,
    assignmentId,
    studentId,
    uid: access.uid,
    db,
    assignmentRef,
    body,
    ...scoreAndFeedback,
  };
}

/**
 * Grades an enrolled student who has not submitted, with a score from 0 to the
 * assignment's points and optional feedback. Saves to the assignment's
 * missingGrades collection and never creates a submission. A 409 for a
 * student who has submitted points to normal grading, and a 409 for missing
 * work already graded includes the stored grade.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const gradeRequest = await readMissingGradeRequest(request, context);
    if ("error" in gradeRequest) return gradeRequest.error;

    const {
      classId,
      assignmentId,
      studentId,
      uid,
      db,
      assignmentRef,
      score,
      feedback,
    } = gradeRequest;

    if (!(await isStudentEnrolled(classId, studentId))) {
      return NextResponse.json(
        { error: "This student is not enrolled in this class." },
        { status: 404 }
      );
    }

    const submissionRef = assignmentRef.collection("submissions").doc(studentId);
    const missingGradeRef = assignmentRef.collection("missingGrades").doc(studentId);

    // Reading the submission in the transaction keeps a submission from
    // landing between the check and the missing-work grade
    const result = await db.runTransaction(async (transaction) => {
      const [submissionDoc, missingGradeDoc] = await transaction.getAll(
        submissionRef,
        missingGradeRef
      );

      if (submissionDoc.exists) {
        return {
          error: "This student has submitted. Grade their submission instead.",
          status: 409,
        };
      }

      if (missingGradeDoc.exists) {
        return {
          error: "This student's missing work has already been graded.",
          status: 409,
          grade: missingGradeDoc.data(),
        };
      }

      const grade = {
        studentId,
        classId,
        assignmentId,
        score,
        feedback,
        gradedBy: uid,
        gradedAt: new Date().toISOString(),
      };
      transaction.create(missingGradeRef, grade);

      return { grade };
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, grade: result.grade },
        { status: result.status }
      );
    }

    return NextResponse.json({ grade: result.grade }, { status: 201 });
  } catch (error) {
    console.error(
      "POST /api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId] failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to save the missing-work grade." },
      { status: 500 }
    );
  }
}

/**
 * Edits a missing-work grade's score and feedback. Takes the same body as
 * POST plus `lastSavedAt`, the grade's `updatedAt` (or `gradedAt` when never
 * edited) as the professor saw it. A 409 for a grade saved since then
 * includes the stored grade. `gradedAt` and `gradedBy` keep the original
 * grading.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const gradeRequest = await readMissingGradeRequest(request, context);
    if ("error" in gradeRequest) return gradeRequest.error;

    const { studentId, uid, db, assignmentRef, body, score, feedback } =
      gradeRequest;
    const lastSavedAt = body.lastSavedAt;

    if (typeof lastSavedAt !== "string" || lastSavedAt === "") {
      return NextResponse.json(
        { error: "lastSavedAt of the grade being edited is required." },
        { status: 400 }
      );
    }

    const missingGradeRef = assignmentRef.collection("missingGrades").doc(studentId);

    const result = await db.runTransaction(async (transaction) => {
      const missingGradeDoc = await transaction.get(missingGradeRef);

      if (!missingGradeDoc.exists) {
        return {
          error: "This student's missing work has not been graded yet.",
          status: 404,
        };
      }

      const stored = missingGradeDoc.data()!;

      if ((stored.updatedAt ?? stored.gradedAt) !== lastSavedAt) {
        return {
          error: "This grade was changed after you opened it.",
          status: 409,
          grade: stored,
        };
      }

      const changes = {
        score,
        feedback,
        updatedAt: new Date().toISOString(),
        updatedBy: uid,
      };
      transaction.update(missingGradeRef, changes);

      return { grade: { ...stored, ...changes } };
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, grade: result.grade },
        { status: result.status }
      );
    }

    return NextResponse.json({ grade: result.grade });
  } catch (error) {
    console.error(
      "PATCH /api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId] failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to update the missing-work grade." },
      { status: 500 }
    );
  }
}
