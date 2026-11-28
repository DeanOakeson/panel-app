import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { getClassAccess } from "@/lib/classAccess";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { attemptIsLate, type LateExcused } from "@/lib/lateness";

/**
 * Excuses a student's late submission, or removes the excuse (PANEL-115).
 *
 * The excuse is stored as `lateExcused: { by, at, reason, submittedAt }` on
 * the submission doc. It never changes a stored `isLate` or the history, so
 * the record of what was late stays honest; only the late penalty is lifted.
 * It covers the version it was given for and earlier ones.
 */

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

const MAX_REASON_LENGTH = 500;

type Authorized = {
  uid: string;
  assignmentRef: DocumentReference;
  submissionRef: DocumentReference;
};

/** Checks that the caller is the class's professor and finds the submission. */
async function authorize(
  request: NextRequest,
  { params }: RouteContext
): Promise<Authorized | { error: NextResponse }> {
  const { classId, assignmentId, studentId } = await params;
  const access = await getClassAccess(request, classId);
  if (access.error) return { error: access.error };

  if (!access.isClassProfessor) {
    return {
      error: NextResponse.json(
        { error: "Only this class's professor can excuse late work." },
        { status: 403 }
      ),
    };
  }

  const assignmentRef = getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);

  return {
    uid: access.uid,
    assignmentRef,
    submissionRef: assignmentRef.collection("submissions").doc(studentId),
  };
}

/**
 * Excuses the lateness of the student's current version. The body holds a
 * `reason` and the `submittedAt` of the version the professor reviewed, so a
 * resubmission in the meantime isn't excused by mistake.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authorize(request, context);
    if ("error" in auth) return auth.error;

    let body: Record<string, unknown>;

    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!reason || reason.length > MAX_REASON_LENGTH) {
      return NextResponse.json(
        { error: `A reason is required (${MAX_REASON_LENGTH} characters max).` },
        { status: 400 }
      );
    }

    if (typeof body.submittedAt !== "string" || body.submittedAt === "") {
      return NextResponse.json(
        { error: "submittedAt of the reviewed submission is required." },
        { status: 400 }
      );
    }

    const submittedAt = body.submittedAt;

    const result = await getAdminDb().runTransaction(async (transaction) => {
      const [submissionDoc, assignmentDoc] = await transaction.getAll(
        auth.submissionRef,
        auth.assignmentRef
      );

      if (!assignmentDoc.exists) return { error: "Assignment not found.", status: 404 };
      if (!submissionDoc.exists) return { error: "Submission not found.", status: 404 };

      const submission = submissionDoc.data() ?? {};

      if (submission.submittedAt !== submittedAt) {
        return {
          error: "The student resubmitted since you opened this. Review the new version first.",
          status: 409,
        };
      }

      if (!attemptIsLate(submission, assignmentDoc.data()?.dueDate)) {
        return { error: "This version was turned in on time.", status: 409 };
      }

      const lateExcused: LateExcused = {
        by: auth.uid,
        at: new Date().toISOString(),
        reason,
        submittedAt,
      };

      // Only lateExcused changes: isLate and the history stay as recorded
      transaction.update(auth.submissionRef, { lateExcused });

      return { lateExcused };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ lateExcused: result.lateExcused }, { status: 200 });
  } catch (error) {
    console.error("PUT late-excuse failed:", error);
    return NextResponse.json({ error: "Failed to excuse late work." }, { status: 500 });
  }
}

/** Removes the excuse, so the late penalty applies again. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authorize(request, context);
    if ("error" in auth) return auth.error;

    const submissionDoc = await auth.submissionRef.get();

    if (!submissionDoc.exists) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    await auth.submissionRef.update({ lateExcused: FieldValue.delete() });

    return NextResponse.json({ lateExcused: null }, { status: 200 });
  } catch (error) {
    console.error("DELETE late-excuse failed:", error);
    return NextResponse.json({ error: "Failed to remove the excuse." }, { status: 500 });
  }
}
