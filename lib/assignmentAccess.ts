import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

/**
 * Verifies the caller is the professor assigned to the class and that the
 * assignment exists. Returns the caller's uid and the assignment's document,
 * or an error response.
 */
export async function authorizeAssignmentProfessor(
  request: Request,
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
  const [userDoc, classDoc, assignmentDoc] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("classes").doc(classId).get(),
    db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId)
      .get(),
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
        { error: "Only this class's professor can view or grade submissions." },
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

  return { uid, assignmentDoc };
}
