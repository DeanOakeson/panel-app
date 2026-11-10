
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getEffectiveClosesAt } from "@/lib/assignmentDeadline";

type RouteContext = {
  params: Promise<{ classId: string; assignmentId: string }>;
};

/**
 * Returns one assignment to the class's professor, an admin, or an enrolled
 * student, with its effective submission closing instant.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { classId, assignmentId } = await params;

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }

    let uid: string;

    try {
      const decoded = await getAdminAuth().verifyIdToken(
        authHeader.slice(7)
      );
      uid = decoded.uid;
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired authentication token." },
        { status: 401 }
      );
    }

    const db = getAdminDb();

    const [userDoc, classDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("classes").doc(classId).get(),
    ]);

    if (!userDoc.exists || !classDoc.exists) {
      return NextResponse.json(
        { error: "User or class not found." },
        { status: 404 }
      );
    }

    const role = userDoc.data()?.role;
    const classData = classDoc.data();

    const isProfessor =
      role === "professor" && classData?.professor_id === uid;
    const isAdmin = role === "admin";

    if (!isProfessor && !isAdmin) {
      if (role !== "student") {
        return NextResponse.json(
          { error: "You do not have permission to view this assignment." },
          { status: 403 }
        );
      }

      const enrollment = await db
        .collection("users")
        .doc(uid)
        .collection("classes")
        .where("class_id", "==", classId)
        .limit(1)
        .get();

      if (enrollment.empty) {
        return NextResponse.json(
          { error: "You are not enrolled in this class." },
          { status: 403 }
        );
      }
    }

    const assignmentDoc = await db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId)
      .get();

    if (!assignmentDoc.exists) {
      return NextResponse.json(
        { error: "Assignment not found." },
        { status: 404 }
      );
    }

    const assignment = assignmentDoc.data();

    let closesAt: string | null = null;

    try {
      closesAt = getEffectiveClosesAt(
        assignment?.dueDate,
        assignment?.lateUntil
      );
    } catch (error) {
      console.error("Assignment has invalid deadline settings:", error);
    }

    return NextResponse.json(
      {
        assignment: {
          id: assignmentDoc.id,
          ...assignment,
          isLocked: assignment?.isLocked === true,
          lateUntil: assignment?.lateUntil ?? null,
          closesAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET assignment detail failed:", error);

    return NextResponse.json(
      { error: "Failed to load assignment." },
      { status: 500 }
    );
  }
}

/**
 * Verifies the caller is the professor assigned to this class and that the
 * assignment exists. Returns the assignment's document reference, or an error
 * response.
 */
async function authorizeClassProfessor(
  request: NextRequest,
  classId: string,
  assignmentId: string
) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      ),
    };
  }

  let uid: string;

  try {
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid or expired authentication token." },
        { status: 401 }
      ),
    };
  }

  const db = getAdminDb();
  const assignmentRef = db
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);

  const [userDoc, classDoc, assignmentDoc] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("classes").doc(classId).get(),
    assignmentRef.get(),
  ]);

  if (!classDoc.exists) {
    return {
      error: NextResponse.json({ error: "Class not found." }, { status: 404 }),
    };
  }

  if (
    userDoc.data()?.role !== "professor" ||
    classDoc.data()?.professor_id !== uid
  ) {
    return {
      error: NextResponse.json(
        { error: "Only this class's professor can change its assignments." },
        { status: 403 }
      ),
    };
  }

  if (!assignmentDoc.exists) {
    return {
      error: NextResponse.json(
        { error: "Assignment not found." },
        { status: 404 }
      ),
    };
  }

  return { assignmentRef, current: assignmentDoc.data() ?? {} };
}

/** Updates an assignment's details and submission settings. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId } = await params;
    const auth = await authorizeClassProfessor(request, classId, assignmentId);

    if (auth.error) return auth.error;

    let body: Record<string, unknown>;

    try {
      const parsed = await request.json();

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "Invalid JSON request body." },
          { status: 400 }
        );
      }

      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};

    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";

      if (!name || name.length > 150) {
        return NextResponse.json(
          { error: "Assignment name is required (150 characters max)." },
          { status: 400 }
        );
      }

      updates.name = name;
    }

    if ("description" in body) {
      const description =
        typeof body.description === "string" ? body.description.trim() : "";

      if (description.length > 5000) {
        return NextResponse.json(
          { error: "Description must be 5000 characters or fewer." },
          { status: 400 }
        );
      }

      updates.description = description;
    }

    if ("points" in body) {
      const points = body.points;

      if (
        typeof points !== "number" ||
        !Number.isFinite(points) ||
        points <= 0
      ) {
        return NextResponse.json(
          { error: "Points must be a number greater than 0." },
          { status: 400 }
        );
      }

      updates.points = points;
    }

    if ("dueDate" in body) {
      const dueDate = typeof body.dueDate === "string" ? body.dueDate : "";

      updates.dueDate = dueDate || null;
    }

    if ("lateUntil" in body) {
      if (
        body.lateUntil !== null &&
        body.lateUntil !== "" &&
        typeof body.lateUntil !== "string"
      ) {
        return NextResponse.json(
          { error: "Late until must be a valid date or empty." },
          { status: 400 }
        );
      }

      updates.lateUntil =
        typeof body.lateUntil === "string" && body.lateUntil
          ? body.lateUntil
          : null;
    }

    if ("isLocked" in body) {
      if (typeof body.isLocked !== "boolean") {
        return NextResponse.json(
          { error: "Lock submissions must be true or false." },
          { status: 400 }
        );
      }

      updates.isLocked = body.isLocked;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update." },
        { status: 400 }
      );
    }

    // Validate the final combined deadline settings, including any existing
    // values that were not included in this PATCH request.
    const finalDueDate =
      "dueDate" in updates ? updates.dueDate : auth.current.dueDate;

    const finalLateUntil =
      "lateUntil" in updates ? updates.lateUntil : auth.current.lateUntil;

    let closesAt: string | null;

    try {
      closesAt = getEffectiveClosesAt(finalDueDate, finalLateUntil);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid assignment deadline settings.",
        },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();

    await auth.assignmentRef.update(updates);

    return NextResponse.json(
      {
        assignment: {
          id: assignmentId,
          ...auth.current,
          ...updates,
          isLocked:
            "isLocked" in updates
              ? updates.isLocked
              : auth.current.isLocked === true,
          lateUntil: finalLateUntil ?? null,
          closesAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "PATCH /api/classes/[classId]/assignments/[assignmentId] failed:",
      error
    );

    return NextResponse.json(
      { error: "Failed to update assignment." },
      { status: 500 }
    );
  }
}

/** Deletes an assignment. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId } = await params;
    const auth = await authorizeClassProfessor(request, classId, assignmentId);

    if (auth.error) return auth.error;

    await auth.assignmentRef.delete();

    return NextResponse.json(
      { deleted: true, id: assignmentId },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "DELETE /api/classes/[classId]/assignments/[assignmentId] failed:",
      error
    );

    return NextResponse.json(
      { error: "Failed to delete assignment." },
      { status: 500 }
    );
  }
}
