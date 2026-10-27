import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

// gRPC status Firestore returns when create() finds an existing document
const ALREADY_EXISTS = 6;

/**
 * Grades a student's submission with a score from 0 to the assignment's points
 * and optional feedback. Only the class's professor can grade, and each
 * submission can be graded once.
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

    const assignmentRef = getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId);
    const [assignmentDoc, submissionDoc] = await Promise.all([
      assignmentRef.get(),
      assignmentRef.collection("submissions").doc(studentId).get(),
    ]);

    if (!assignmentDoc.exists) {
      return NextResponse.json(
        { error: "Assignment not found." },
        { status: 404 }
      );
    }

    if (!submissionDoc.exists) {
      return NextResponse.json(
        { error: "Submission not found." },
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

    const grade = {
      score,
      feedback,
      gradedBy: access.uid,
      gradedAt: new Date().toISOString(),
    };

    try {
      await assignmentRef.collection("grades").doc(studentId).create(grade);
    } catch (error) {
      if ((error as { code?: number }).code === ALREADY_EXISTS) {
        return NextResponse.json(
          { error: "This submission has already been graded." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ grade }, { status: 201 });
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
