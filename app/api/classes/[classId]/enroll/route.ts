import { NextRequest, NextResponse } from "next/server";
import {
  removeEnrollmentRequest,
  selfEnroll,
} from "@/lib/enrollmentRequests";
import { getClassAccess } from "@/lib/classAccess";

type RouteContext = { params: Promise<{ classId: string }> };

/**
 * Enrolls the signed-in student directly (PANEL-26).
 *
 * Self-enrollment is the normal path: the student's own POST writes the
 * enrollment doc at `users/{uid}/classes/{classId}` — the same doc an admin's
 * approval writes — and answers 201 `{ enrolled: true }`. The pending-request
 * flow around it survives for requests that are already in flight: any entry
 * the student still had pending for this class is cleared by the same
 * transaction (see lib/enrollmentRequests.ts), and an admin can still approve
 * or reject an entry that predates the enroll (see
 * /api/admin/requests/[classId]/[studentId], whose Approve answers a
 * self-enrolled student with a no-op 200).
 *
 * Responses, all on purpose:
 * - 201 `{ enrolled: true }` — the roster doc was written, and any pending
 *   request for this class was cleared with it.
 * - 200 `{ enrolled: true, alreadyEnrolled: true }` — the student is on the
 *   roster already, including the older auto-ID enrollment docs (the read
 *   matches on the `class_id` field, not the doc id). Idempotency, unchanged
 *   from every version of this route: a double click cannot create two
 *   roster docs, and no pending entry is created behind their back.
 * - 401/403/404 — unchanged, all from `getClassAccess`: only a student who is
 *   not on the roster may enroll, and the class must exist.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (access.role !== "student") {
      return NextResponse.json(
        { error: "Only students can enroll in a course." },
        { status: 403 }
      );
    }

    if (access.isEnrolledStudent) {
      return NextResponse.json(
        { enrolled: true, alreadyEnrolled: true },
        { status: 200 }
      );
    }

    const outcome = await selfEnroll(access.uid, classId);

    if (outcome.kind === "noProfile") {
      // The profile vanished between the access check and the transaction.
      return NextResponse.json(
        { error: "User profile not found." },
        { status: 404 }
      );
    }

    if (outcome.kind === "notStudent") {
      // The role flipped between the access check and the transaction.
      return NextResponse.json(
        { error: "Only students can enroll in a course." },
        { status: 403 }
      );
    }

    if (outcome.kind === "alreadyEnrolled") {
      // An admin approved someone between the access check and this transaction.
      return NextResponse.json(
        { enrolled: true, alreadyEnrolled: true },
        { status: 200 }
      );
    }

    return NextResponse.json({ enrolled: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/classes/[classId]/enroll failed:", error);
    return NextResponse.json(
      { error: "Failed to enroll in the course." },
      { status: 500 }
    );
  }
}

/**
 * Withdraws the signed-in student's own pending request for the class.
 *
 * A request is removed rather than flagged `cancelled`, the way the professor
 * flow clears an application instead of keeping a rejection on the user doc:
 * nothing in the product can act on a cancelled request, and the browse list
 * reads "Request" again the moment the entry is gone. An already-enrolled
 * student is not withdrawn here — leaving a course is the unenroll path, not
 * this one.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (access.role !== "student") {
      return NextResponse.json(
        { error: "Only students can withdraw a course request." },
        { status: 403 }
      );
    }

    if (access.isEnrolledStudent) {
      return NextResponse.json(
        { error: "You are already enrolled. Ask an admin to remove you instead." },
        { status: 409 }
      );
    }

    const outcome = await removeEnrollmentRequest(access.uid, classId);

    if (outcome.kind === "notPending") {
      return NextResponse.json(
        { error: "You have no pending request for this course." },
        { status: 404 }
      );
    }

    return NextResponse.json({ withdrawn: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/classes/[classId]/enroll failed:", error);
    return NextResponse.json(
      { error: "Failed to withdraw the course request." },
      { status: 500 }
    );
  }
}
