import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  approveEnrollmentRequest,
  removeEnrollmentRequest,
} from "@/lib/enrollmentRequests";

type RouteContext = {
  params: Promise<{ classId: string; studentId: string }>;
};

/**
 * ADMIN-ONLY. Decides one pending course request:
 *
 *   PATCH /api/admin/requests/{classId}/{studentId}  { action: "approve" | "reject" }
 *
 * Approve makes the enrollment write AND clears the pending entry in the same
 * transaction, so a decision can never leave a request sitting in the queue.
 * If the student is already on the roster — they self-enrolled while their
 * request was still in flight, the normal path since PANEL-26 came back — the
 * approval is a clean no-op 200 (`alreadyEnrolled: true`): the decision is
 * already satisfied, so repeating it must not error or write a duplicate.
 * Reject only clears the entry: the student is not enrolled and, matching the
 * professor flow, the rejection is not stored — the request simply stops being
 * pending, and the student may enroll themselves the normal way.
 *
 * Statuses:
 * - 200 `{ approved: true, enrolled: true }`, or the same body with
 *   `alreadyEnrolled: true` when the roster seat was already taken; or
 *   `{ rejected: true }`
 * - 400 invalid body, or the student is no longer a student profile
 * - 401/403 straight from `requireAdmin`
 * - 404 unknown class, or unknown student
 * - 409 the request is no longer pending (reject only)
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const { classId, studentId } = await params;

    let body: { action?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const action = body.action;
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "Provide a valid action: approve or reject" },
        { status: 400 }
      );
    }

    const trimmedStudent = studentId.trim();
    if (!trimmedStudent) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const db = getAdminDb();
    const classDoc = await db.collection("classes").doc(classId).get();
    if (!classDoc.exists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    if (action === "reject") {
      const outcome = await removeEnrollmentRequest(trimmedStudent, classId);

      if (outcome.kind === "notPending") {
        return NextResponse.json(
          { error: "This request is no longer pending" },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { rejected: true, classId, studentId: trimmedStudent },
        { status: 200 }
      );
    }

    const outcome = await approveEnrollmentRequest(trimmedStudent, classId);

    if (outcome.kind === "noProfile") {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (outcome.kind === "notStudent") {
      return NextResponse.json(
        { error: "Only students can be enrolled in a class" },
        { status: 400 }
      );
    }

    if (outcome.kind === "alreadyEnrolled") {
      // The student self-enrolled (or an admin added them) while the request
      // was in flight: the decision is already satisfied. A no-op 200, not a
      // 409 — repeating an approval must be safe, and there is nothing left to
      // write (the pending entry, if any, was cleared by whatever enrolled
      // them). No duplicate roster doc is created.
      return NextResponse.json(
        {
          approved: true,
          enrolled: true,
          alreadyEnrolled: true,
          classId,
          studentId: trimmedStudent,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { approved: true, enrolled: true, classId, studentId: trimmedStudent },
      { status: 200 }
    );
  } catch (error) {
    console.error("PATCH /api/admin/requests/[classId]/[studentId] failed:", error);
    return NextResponse.json(
      { error: "Failed to update the enrollment request" },
      { status: 500 }
    );
  }
}
