import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export type ClassAccess = {
  error?: undefined;
  uid: string;
  role: string | undefined;
  /** The signed-in user is the professor assigned to this class. */
  isClassProfessor: boolean;
  /** The signed-in user is a student enrolled in this class. */
  isEnrolledStudent: boolean;
  isAdmin: boolean;
  /** The class currently accepts self-enrollment (PANEL-26). */
  classEnrollmentOpen: boolean;
};

/**
 * Whether a class document is open for self-enrollment (PANEL-26).
 *
 * `enrollmentOpen` is the class's only open/closed state, set by an admin from
 * the course detail page. A document without the field is OPEN: every class
 * that predates the flag would otherwise turn into a closed course silently,
 * and a `false` that isn't a boolean (a legacy string, say) is not trusted as
 * a close. Only an explicit `false` closes a course.
 */
export function isEnrollmentOpen(classData: DocumentData | undefined): boolean {
  return classData?.enrollmentOpen !== false;
}

type AccessError = { error: NextResponse };

/**
 * Verifies the request's Firebase ID token and works out how the caller
 * relates to the class. Returns an error response for a missing or invalid
 * token, a missing profile, or a class that doesn't exist.
 */
export async function getClassAccess(
  request: Request,
  classId: string
): Promise<ClassAccess | AccessError> {
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

  const role = userDoc.data()?.role as string | undefined;
  const isClassProfessor =
    role === "professor" && classDoc.data()?.professor_id === uid;

  let isEnrolledStudent = false;
  if (role === "student") {
    // Enrollment is stored as users/{uid}/classes/{doc} with a class_id field.
    const enrolled = await db
      .collection("users")
      .doc(uid)
      .collection("classes")
      .where("class_id", "==", classId)
      .limit(1)
      .get();
    isEnrolledStudent = !enrolled.empty;
  }

  return {
    uid,
    role,
    isClassProfessor,
    isEnrolledStudent,
    isAdmin: role === "admin",
    classEnrollmentOpen: isEnrollmentOpen(classDoc.data()),
  };
}
