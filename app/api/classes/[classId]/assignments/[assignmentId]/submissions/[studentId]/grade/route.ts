import { NextRequest, NextResponse } from "next/server";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";
import { readJsonBody, readScoreAndFeedback } from "@/lib/gradeInput";
import { appendHistory, entryFromStoredGrade, hasHistory } from "@/lib/gradeHistory";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

type GradeRequest = {
  classId: string;
  assignmentId: string;
  studentId: string;
  uid: string;
  db: Firestore;
  assignmentRef: DocumentReference;
  body: Record<string, unknown>;
  score: number;
  feedback: string;
  submittedAt: string;
};

const resubmittedError =
  "The student resubmitted after you opened this submission. Reload the page to see the new file.";

/**
 * Checks that the caller is the class's professor, that the assignment exists,
 * and that the body holds a valid score, feedback, and `submittedAt`. Returns
 * the parsed request, or an error response.
 */
async function readGradeRequest(
  request: NextRequest,
  { params }: RouteContext
): Promise<GradeRequest | { error: NextResponse }> {
  const { classId, assignmentId, studentId } = await params;
  const access = await getClassAccess(request, classId);
  if (access.error) return { error: access.error };

  if (!access.isClassProfessor) {
    return {
      error: NextResponse.json(
        { error: "Only this class's professor can grade submissions." },
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

  const points = assignmentDoc.data()?.points as number;
  const scoreAndFeedback = readScoreAndFeedback(body, points);

  if ("error" in scoreAndFeedback) {
    return {
      error: NextResponse.json(
        { error: scoreAndFeedback.error },
        { status: 400 }
      ),
    };
  }

  const { score, feedback } = scoreAndFeedback;
  const submittedAt = body.submittedAt;

  if (typeof submittedAt !== "string" || submittedAt === "") {
    return {
      error: NextResponse.json(
        { error: "submittedAt of the reviewed submission is required." },
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
    score,
    feedback,
    submittedAt,
  };
}

/**
 * Grades a student's submission with a score from 0 to the assignment's points
 * and optional feedback. Only the class's professor can grade, each submission
 * can be graded once, and `submittedAt` must match the version being graded.
 * A 409 for an already graded submission includes the stored grade. Each save
 * adds an entry to the grade's history subcollection.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const gradeRequest = await readGradeRequest(request, context);
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
      submittedAt,
    } = gradeRequest;
    const submissionRef = assignmentRef.collection("submissions").doc(studentId);
    const gradeRef = assignmentRef.collection("grades").doc(studentId);

    // Reading the submission in the transaction keeps a resubmission from
    // landing between the version check and the grade write
    const result = await db.runTransaction(async (transaction) => {
      const [submissionDoc, gradeDoc] = await transaction.getAll(
        submissionRef,
        gradeRef
      );

      if (!submissionDoc.exists) {
        return { error: "Submission not found.", status: 404 };
      }

      if (submissionDoc.data()?.submittedAt !== submittedAt) {
        return { error: resubmittedError, status: 409 };
      }

      if (gradeDoc.exists) {
        return {
          error: "This submission has already been graded.",
          status: 409,
          grade: gradeDoc.data(),
        };
      }

      const grade = {
        studentId,
        classId,
        assignmentId,
        score,
        feedback,
        submittedAt,
        gradedBy: uid,
        gradedAt: new Date().toISOString(),
      };
      transaction.create(gradeRef, grade);
      appendHistory(transaction, gradeRef, {
        score,
        feedback,
        submittedAt,
        savedBy: uid,
        savedAt: grade.gradedAt,
        action: "created",
      });

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
      "POST /api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to save grade." },
      { status: 500 }
    );
  }
}

/**
 * Edits an existing grade's score and feedback. Takes the same body as POST
 * plus `lastSavedAt`, the grade's `updatedAt` (or `gradedAt` when never edited)
 * as the professor saw it. A 409 for a grade saved since then includes the
 * stored grade. `gradedAt` and `gradedBy` keep the original grading, and the
 * edit is added to the grade's history.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const gradeRequest = await readGradeRequest(request, context);
    if ("error" in gradeRequest) return gradeRequest.error;

    const {
      studentId,
      uid,
      db,
      assignmentRef,
      body,
      score,
      feedback,
      submittedAt,
    } = gradeRequest;
    const lastSavedAt = body.lastSavedAt;

    if (typeof lastSavedAt !== "string" || lastSavedAt === "") {
      return NextResponse.json(
        { error: "lastSavedAt of the grade being edited is required." },
        { status: 400 }
      );
    }

    const submissionRef = assignmentRef.collection("submissions").doc(studentId);
    const gradeRef = assignmentRef.collection("grades").doc(studentId);

    const result = await db.runTransaction(async (transaction) => {
      const [submissionDoc, gradeDoc] = await transaction.getAll(
        submissionRef,
        gradeRef
      );

      if (!submissionDoc.exists) {
        return { error: "Submission not found.", status: 404 };
      }

      if (!gradeDoc.exists) {
        return {
          error: "This submission has not been graded yet.",
          status: 404,
        };
      }

      if (submissionDoc.data()?.submittedAt !== submittedAt) {
        return { error: resubmittedError, status: 409 };
      }

      const stored = gradeDoc.data()!;

      if ((stored.updatedAt ?? stored.gradedAt) !== lastSavedAt) {
        return {
          error: "This grade was changed after you opened it.",
          status: 409,
          grade: stored,
        };
      }

      const recorded = await hasHistory(transaction, gradeRef);
      const changes = {
        score,
        feedback,
        submittedAt,
        updatedAt: new Date().toISOString(),
        updatedBy: uid,
      };
      transaction.update(gradeRef, changes);

      // A grade saved before history was kept gets its stored version first
      if (!recorded) {
        appendHistory(transaction, gradeRef, entryFromStoredGrade(stored));
      }

      appendHistory(transaction, gradeRef, {
        score,
        feedback,
        submittedAt,
        savedBy: uid,
        savedAt: changes.updatedAt,
        action: "edited",
      });

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
      "PATCH /api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to update grade." },
      { status: 500 }
    );
  }
}
