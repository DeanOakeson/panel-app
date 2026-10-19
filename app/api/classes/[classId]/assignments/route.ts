import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

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
  const [userDoc, classDoc] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("classes").doc(classId).get(),
  ]);

  if (!userDoc.exists) {
    return {
      error: NextResponse.json(
        { error: "User profile not found." },
        { status: 404 }
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

    if (auth.role !== "professor" || auth.classData?.professor_id !== auth.uid) {
      return NextResponse.json(
        { error: "Only this class's professor can create assignments." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const points = body.points;
    const dueDate = typeof body.dueDate === "string" ? body.dueDate : "";

    if (!name || name.length > 150) {
      return NextResponse.json(
        { error: "Assignment name is required (150 characters max)." },
        { status: 400 }
      );
    }

    if (typeof points !== "number" || !Number.isFinite(points) || points <= 0) {
      return NextResponse.json(
        { error: "Points must be a number greater than 0." },
        { status: 400 }
      );
    }

    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return NextResponse.json(
        { error: "Due date must be in YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    if (description.length > 5000) {
      return NextResponse.json(
        { error: "Description must be 5000 characters or fewer." },
        { status: 400 }
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
      createdBy: auth.uid,
      createdAt: new Date().toISOString(),
    };

    await assignmentRef.set(assignment);

    return NextResponse.json(
      { assignment: { id: assignmentRef.id, ...assignment } },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/classes/[classId]/assignments failed:", error);
    return NextResponse.json(
      { error: "Failed to create assignment." },
      { status: 500 }
    );
  }
}

/** Lists a class's assignments for its professor or enrolled students. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const auth = await authorize(request, classId);
    if ("error" in auth) return auth.error;

    const db = getAdminDb();
    const isClassProfessor =
      auth.role === "professor" && auth.classData?.professor_id === auth.uid;

    if (!isClassProfessor && auth.role !== "admin") {
      // Students must be enrolled: users/{uid}/classes holds { class_id }
      // (same structure /api/classes/student reads).
      const enrolled = await db
        .collection("users")
        .doc(auth.uid)
        .collection("classes")
        .where("class_id", "==", classId)
        .limit(1)
        .get();

      if (enrolled.empty) {
        return NextResponse.json(
          { error: "You do not have access to this class." },
          { status: 403 }
        );
      }
    }

    const snapshot = await db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .orderBy("createdAt")
      .get();

    const assignments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ assignments }, { status: 200 });
  } catch (error) {
    console.error("GET /api/classes/[classId]/assignments failed:", error);
    return NextResponse.json(
      { error: "Failed to load assignments." },
      { status: 500 }
    );
  }
}
