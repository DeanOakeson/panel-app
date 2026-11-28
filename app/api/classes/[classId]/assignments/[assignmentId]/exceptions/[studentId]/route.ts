import { NextRequest, NextResponse } from "next/server";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  getDeadline,
  getEffectiveClosesAt,
  hasClosed,
} from "@/lib/assignmentDeadline";
import { getClassAccess } from "@/lib/classAccess";
import { enrollmentQuery } from "@/lib/classRoster";
import { readJsonBody } from "@/lib/gradeInput";
import {
  MAX_EXCEPTION_REASON_LENGTH,
  summarizeException,
} from "@/lib/submissionException";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string; studentId: string }>;
};

type ExceptionRequest = {
  classId: string;
  assignmentId: string;
  studentId: string;
  uid: string;
  db: Firestore;
  assignmentRef: DocumentReference;
  exceptionRef: DocumentReference;
};

type ExceptionFields = {
  dueDate: string;
  lateUntil: string | null;
  allowResubmit: boolean;
  reason: string;
};

/**
 * Checks that the caller is the class's professor or an admin and that the
 * assignment exists. Returns the request's ids and references, or an error
 * response.
 */
async function readExceptionRequest(
  request: NextRequest,
  { params }: RouteContext
): Promise<ExceptionRequest | { error: NextResponse }> {
  const { classId, assignmentId, studentId } = await params;
  const access = await getClassAccess(request, classId);
  if (access.error) return { error: access.error };

  if (!access.isClassProfessor && !access.isAdmin) {
    return {
      error: NextResponse.json(
        {
          error:
            "Only this class's professor or an admin can manage submission exceptions.",
        },
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

  return {
    classId,
    assignmentId,
    studentId,
    uid: access.uid,
    db,
    assignmentRef,
    exceptionRef: assignmentRef.collection("exceptions").doc(studentId),
  };
}

/**
 * Reads an exception's fields from a request body. The due date is a
 * required YYYY-MM-DD date, the optional late-until date must be later than
 * it, and the window they make must not have ended. Returns the fields, or
 * the message for a 400 response.
 */
function readExceptionFields(
  body: Record<string, unknown>
): ExceptionFields | { error: string } {
  const { dueDate, allowResubmit, reason } = body;
  const lateUntil =
    body.lateUntil === undefined || body.lateUntil === "" ? null : body.lateUntil;

  if (typeof dueDate !== "string") {
    return { error: "A due date in YYYY-MM-DD form is required." };
  }

  if (lateUntil !== null && typeof lateUntil !== "string") {
    return { error: "Late until must be a date in YYYY-MM-DD form." };
  }

  try {
    getDeadline(dueDate);
  } catch {
    return { error: "The due date must be a real date in YYYY-MM-DD form." };
  }

  try {
    if (lateUntil !== null) getDeadline(lateUntil);
  } catch {
    return { error: "Late until must be a real date in YYYY-MM-DD form." };
  }

  let closesAt: string | null;

  try {
    closesAt = getEffectiveClosesAt(dueDate, lateUntil);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid dates." };
  }

  if (hasClosed(closesAt)) {
    return {
      error:
        "This exception would already have ended. Choose a due date or late-until date that has not passed.",
    };
  }

  if (allowResubmit !== undefined && typeof allowResubmit !== "boolean") {
    return { error: "Allow resubmission must be true or false." };
  }

  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return { error: "The reason must be text." };
  }

  const trimmedReason = typeof reason === "string" ? reason.trim() : "";

  if (trimmedReason.length > MAX_EXCEPTION_REASON_LENGTH) {
    return {
      error: `The reason must be ${MAX_EXCEPTION_REASON_LENGTH} characters or fewer.`,
    };
  }

  return {
    dueDate,
    lateUntil,
    allowResubmit: allowResubmit === true,
    reason: trimmedReason,
  };
}

/**
 * Grants an enrolled student an exception on an assignment, or replaces the
 * one they have. Takes `dueDate`, and optionally `lateUntil`, `allowResubmit`
 * and `reason`. A replace keeps `grantedBy` and `grantedAt` and records
 * `updatedBy` and `updatedAt`. Returns the stored exception with 201 for a
 * grant and 200 for a replace.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const exceptionRequest = await readExceptionRequest(request, context);
    if ("error" in exceptionRequest) return exceptionRequest.error;

    const {
      classId,
      assignmentId,
      studentId,
      uid,
      db,
      assignmentRef,
      exceptionRef,
    } = exceptionRequest;

    const body = await readJsonBody(request);

    if (body === null) {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const fields = readExceptionFields(body);

    if ("error" in fields) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }

    const result = await db.runTransaction(async (transaction) => {
      const [assignmentDoc, existingDoc] = await transaction.getAll(
        assignmentRef,
        exceptionRef
      );
      const enrollment = await transaction.get(enrollmentQuery(classId, studentId));

      if (!assignmentDoc.exists) {
        return { error: "Assignment not found.", status: 404 };
      }

      if (enrollment.empty) {
        return { error: "This student is not enrolled in this class.", status: 404 };
      }

      const now = new Date().toISOString();
      const existing = existingDoc.data();
      const exception = {
        studentId,
        classId,
        assignmentId,
        ...fields,
        grantedBy: existing?.grantedBy ?? uid,
        grantedAt: existing?.grantedAt ?? now,
        ...(existing && { updatedBy: uid, updatedAt: now }),
      };

      transaction.set(exceptionRef, exception);

      return { exception, replaced: !!existing };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { exception: summarizeException(result.exception) },
      { status: result.replaced ? 200 : 201 }
    );
  } catch (error) {
    console.error(
      "PUT /api/classes/[classId]/assignments/[assignmentId]/exceptions/[studentId] failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to save the exception." },
      { status: 500 }
    );
  }
}

/**
 * Removes a student's exception on an assignment. Submissions they already
 * made, and their lateness, stay as stored. Returns 404 when the student has
 * no exception.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const exceptionRequest = await readExceptionRequest(request, context);
    if ("error" in exceptionRequest) return exceptionRequest.error;

    const { db, exceptionRef } = exceptionRequest;

    const removed = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(exceptionRef);

      if (!existing.exists) return false;

      transaction.delete(exceptionRef);
      return true;
    });

    if (!removed) {
      return NextResponse.json(
        { error: "This student has no exception on this assignment." },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error(
      "DELETE /api/classes/[classId]/assignments/[assignmentId]/exceptions/[studentId] failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to remove the exception." },
      { status: 500 }
    );
  }
}
