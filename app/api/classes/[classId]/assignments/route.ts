import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { closesAtOrNull } from "@/lib/assignmentDeadline";
import { loadEnrolledStudentIds, loadGradingCounts } from "@/lib/classRoster";
import { isMissingWorkGrade } from "@/lib/gradingStatus";

type RouteContext = { params: Promise<{ classId: string }> };

/**
 * Verifies the caller's ID token and loads the class.
 * Returns either the caller's uid, role, and the class data, or an error response.
 */
async function authorize(request: NextRequest, classId: string) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 },
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
        { status: 401 },
      ),
    };
  }

  const db = getAdminDb();
  const [userDoc, classDoc] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("classes").doc(classId).get(),
  ]);

  if (!userDoc.exists) {
    return {
      error: NextResponse.json(
        { error: "User profile not found." },
        { status: 404 },
      ),
    };
  }

  if (!classDoc.exists) {
    return {
      error: NextResponse.json({ error: "Class not found." }, { status: 404 }),
    };
  }

  return {
    uid,
    role: userDoc.data()?.role as string | undefined,
    classData: classDoc.data(),
  };
}

/** Creates an assignment in a class. Only the class's professor may do this. */

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const auth = await authorize(request, classId);
    if ("error" in auth) return auth.error;

    if (
      auth.role !== "professor" ||
      auth.classData?.professor_id !== auth.uid
    ) {
      return NextResponse.json(
        { error: "Only this class's professor can create assignments." },
        { status: 403 },
      );
    }

    let body: Record<string, unknown>;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 },
      );
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const points = body.points;
    const dueDate = typeof body.dueDate === "string" ? body.dueDate : "";
    const lateUntil =
      typeof body.lateUntil === "string" ? body.lateUntil : "";
    const isLocked = body.isLocked === true;

    if (!name || name.length > 150) {
      return NextResponse.json(
        { error: "Assignment name is required (150 characters max)." },
        { status: 400 },
      );
    }

    if (typeof points !== "number" || !Number.isFinite(points) || points <= 0) {
      return NextResponse.json(
        { error: "Points must be a number greater than 0." },
        { status: 400 },
      );
    }

    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return NextResponse.json(
        { error: "Due date must be in YYYY-MM-DD format." },
        { status: 400 },
      );
    }

    if (lateUntil && !/^\d{4}-\d{2}-\d{2}$/.test(lateUntil)) {
      return NextResponse.json(
        { error: "Late submission deadline must be in YYYY-MM-DD format." },
        { status: 400 },
      );
    }

    if (lateUntil && !dueDate) {
      return NextResponse.json(
        { error: "A due date is required when setting a late submission deadline." },
        { status: 400 },
      );
    }

    if (lateUntil && lateUntil <= dueDate) {
      return NextResponse.json(
        { error: "Late submission deadline must be after the due date." },
        { status: 400 },
      );
    }

    if (description.length > 5000) {
      return NextResponse.json(
        { error: "Description must be 5000 characters or fewer." },
        { status: 400 },
      );
    }

    const assignmentRef = getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc();

    const assignment = {
      name,
      description,
      points,
      dueDate: dueDate || null,
      lateUntil: lateUntil || null,
      isLocked,
      createdBy: auth.uid,
      createdAt: new Date().toISOString(),
    };

    await assignmentRef.set(assignment);

    return NextResponse.json(
      { assignment: { id: assignmentRef.id, ...assignment } },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/classes/[classId]/assignments failed:", error);
    return NextResponse.json(
      { error: "Failed to create assignment." },
      { status: 500 },
    );
  }
}


/**
 * Lists assignments for the class professor, admin, or enrolled students.
 * Students also receive their earned grade for each assignment.
 * Professors and admins receive grading counts.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const auth = await authorize(request, classId);

    if ("error" in auth) return auth.error;

    const db = getAdminDb();

    const isClassProfessor =
      auth.role === "professor" && auth.classData?.professor_id === auth.uid;

    const isAdmin = auth.role === "admin";
    const isStudent = auth.role === "student";

    if (!isClassProfessor && !isAdmin && !isStudent) {
      return NextResponse.json(
        { error: "You do not have permission to view assignments." },
        { status: 403 },
      );
    }

    if (isStudent) {
      const enrollment = await db
        .collection("users")
        .doc(auth.uid)
        .collection("classes")
        .where("class_id", "==", classId)
        .limit(1)
        .get();

      if (enrollment.empty) {
        return NextResponse.json(
          { error: "You are not enrolled in this class." },
          { status: 403 },
        );
      }
    }

    const snapshot = await db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .orderBy("createdAt", "desc")
      .get();

    const assignments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      closesAt: closesAtOrNull(doc.data().dueDate),
    }));

    if (isStudent) {
      const studentAssignments = await Promise.all(
        snapshot.docs.map(async (assignmentDoc, index) => {
          const [submissionDoc, gradeDoc] = await Promise.all([
            assignmentDoc.ref.collection("submissions").doc(auth.uid).get(),
            assignmentDoc.ref.collection("grades").doc(auth.uid).get(),
          ]);

          const grade = gradeDoc.data();

          let studentGrade: number | null = null;

          if (
            grade &&
            !isMissingWorkGrade(grade) &&
            typeof grade.score === "number" &&
            Number.isFinite(grade.score)
          ) {
            studentGrade = grade.score;
          }

          return {
            ...assignments[index],
            studentGrade,
          };
        }),
      );

      return NextResponse.json(
        { assignments: studentAssignments },
        { status: 200 },
      );
    }

    const enrolledIds = await loadEnrolledStudentIds(classId);
    const gradingCounts = await Promise.all(
      snapshot.docs.map((doc) => loadGradingCounts(doc.ref, enrolledIds)),
    );

    return NextResponse.json(
      {
        assignments: assignments.map((assignment, index) => ({
          ...assignment,
          grading: gradingCounts[index],
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("GET /api/classes/[classId]/assignments failed:", error);

    return NextResponse.json(
      { error: "Failed to load assignments." },
      { status: 500 },
    );
  }
}
