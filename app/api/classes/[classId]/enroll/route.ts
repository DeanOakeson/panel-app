import { NextRequest, NextResponse } from "next/server";
import {
  addEnrollmentRequest,
  removeEnrollmentRequest,
} from "@/lib/enrollmentRequests";
import { getClassAccess } from "@/lib/classAccess";

type RouteContext = { params: Promise<{ classId: string }> };

/**
 * Records the signed-in student's REQUEST to join a class. It no longer
 * enrolls them.
 *
 * Enrollment was the one place in the product where a student could write
 * themselves onto a roster with no record of the ask and no one able to undo
 * it. This route now does what the professor-application flow does — record the
 * intent on the student's own user doc, and let an admin's approval make the
 * privileged write (see lib/enrollmentRequests.ts and
 * /api/admin/requests/[classId]/[studentId]).
 *
 * Responses, all on purpose:
 * - 201 `{ requested: true }` — the pending entry was created.
 * - 200 `{ requested: true, alreadyRequested: true }` — a request was already
 *   pending. The old route's idempotency property is kept: a double click
 *   cannot queue two decisions.
 * - 200 `{ enrolled: true, alreadyEnrolled: true }` — the student is on the
 *   roster already, so there is nothing to ask. Unchanged from the old route,
 *   and no pending entry is created behind their back.
 * - 401/403/404 — unchanged, all from `getClassAccess`: only a student who is
 *   not on the roster may ask, and the class must exist.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (access.role !== "student") {
      return NextResponse.json(
        { error: "Only students can request a course." },
        { status: 403 }
      );
    }

    if (access.isEnrolledStudent) {
      return NextResponse.json(
        { enrolled: true, alreadyEnrolled: true },
        { status: 200 }
      );
    }

    const outcome = await addEnrollmentRequest(access.uid, classId);

    if (outcome.kind === "alreadyEnrolled") {
      // An admin approved someone between the access check and this transaction.
      return NextResponse.json(
        { enrolled: true, alreadyEnrolled: true },
        { status: 200 }
      );
    }

    if (outcome.kind === "alreadyRequested") {
      return NextResponse.json(
        { requested: true, alreadyRequested: true },
        { status: 200 }
      );
    }

    return NextResponse.json({ requested: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/classes/[classId]/enroll failed:", error);
    return NextResponse.json(
      { error: "Failed to request the course." },
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
