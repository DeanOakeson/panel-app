import { NextRequest, NextResponse } from "next/server";
import { authorizeAssignmentProfessor } from "@/lib/assignmentAccess";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

// gRPC status Firestore returns when create() finds an existing document
const ALREADY_EXISTS = 6;

/**
 * Grades a student's submission with a score from 0 to the assignment's points
 * and optional feedback. Each submission can be graded once.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId, studentId } = await params;
    const auth = await authorizeAssignmentProfessor(request, classId, assignmentId);
    if (auth.error) return auth.error;

    const assignmentRef = auth.assignmentDoc.ref;
    const submissionDoc = await assignmentRef
      .collection("submissions")
      .doc(studentId)
      .get();

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

    const points = auth.assignmentDoc.data()?.points as number;
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
      gradedBy: auth.uid,
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
