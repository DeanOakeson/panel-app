import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

/**
 * Grades a student's submission with a score from 0 to the assignment's points
 * and optional feedback. Only the class's professor can grade, each submission
 * can be graded once, and `submittedAt` must match the version being graded.
 * A 409 for an already graded submission includes the stored grade.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId, studentId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (!access.isClassProfessor) {
      return NextResponse.json(
        { error: "Only this class's professor can grade submissions." },
        { status: 403 }
      );
    }

    const db = getAdminDb();
    const assignmentRef = db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId);
    const assignmentDoc = await assignmentRef.get();

    if (!assignmentDoc.exists) {
      return NextResponse.json(
        { error: "Assignment not found." },
        { status: 404 }
      );
    }

    let body: Record<string, unknown>;

    try {
      body = (await request.json()) ?? {};
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const points = assignmentDoc.data()?.points as number;
    const score = body.score;
    const feedback =
      typeof body.feedback === "string" ? body.feedback.trim() : "";
    const submittedAt = body.submittedAt;

    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > points
    ) {
      return NextResponse.json(
        { error: `Score must be a number from 0 to ${points}.` },
        { status: 400 }
      );
    }

    if (feedback.length > 5000) {
      return NextResponse.json(
        { error: "Feedback must be 5000 characters or fewer." },
        { status: 400 }
      );
    }

    if (typeof submittedAt !== "string" || submittedAt === "") {
      return NextResponse.json(
        { error: "submittedAt of the reviewed submission is required." },
        { status: 400 }
      );
    }

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
        return {
          error:
            "The student resubmitted after you opened this submission. Reload the page to see the new file.",
          status: 409,
        };
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
        gradedBy: access.uid,
        gradedAt: new Date().toISOString(),
      };
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
