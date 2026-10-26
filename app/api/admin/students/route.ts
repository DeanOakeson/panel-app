import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export async function GET(req: Request) {
  try {
    // 1. Require a Firebase Authentication ID token.
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return NextResponse.json(
        { error: "Missing authentication token." },
        { status: 401 }
      );
    }

    // 2. Verify the token.
    let decoded: { uid: string };

    try {
      decoded = await getAdminAuth().verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired token." },
        { status: 401 }
      );
    }

    // 3. Require the configured administrator.
    if (decoded.uid !== process.env.ADMIN_UID) {
      return NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      );
    }

    const db = getAdminDb();

    // 4. Verify that the account also has the admin role in Firestore.
    const adminDoc = await db.collection("users").doc(decoded.uid).get();

    if (!adminDoc.exists || adminDoc.data()?.role !== "admin") {
      return NextResponse.json(
        { error: "Your account does not have the admin role." },
        { status: 403 }
      );
    }

    // 5. Retrieve all student profiles.
    const studentsSnapshot = await db
      .collection("users")
      .where("role", "==", "student")
      .get();

    // 6. Read each student's enrollments.
    const studentsWithEnrollments = await Promise.all(
      studentsSnapshot.docs.map(async (studentDoc) => {
        const studentData = studentDoc.data();

        const enrollmentsSnapshot = await db
          .collection("users")
          .doc(studentDoc.id)
          .collection("classes")
          .get();

        const classIds = [
          ...new Set(
            enrollmentsSnapshot.docs
              .map((enrollmentDoc) => enrollmentDoc.data().class_id)
              .filter(
                (classId): classId is string =>
                  typeof classId === "string" && classId.trim().length > 0
              )
          ),
        ];

        return {
          uid: studentDoc.id,
          name: studentData.name ?? "",
          email: studentData.email ?? "",
          courses: classIds,
        };
      })
    );

    // 7. Fetch each unique course document only once.
    const allClassIds = [
      ...new Set(studentsWithEnrollments.flatMap((student) => student.courses)),
    ];

    const classDocuments = await Promise.all(
      allClassIds.map(async (classId) => {
        const classDoc = await db.collection("classes").doc(classId).get();

        if (!classDoc.exists) {
          return null;
        }

        return {
          id: classDoc.id,
          ...classDoc.data(),
        };
      })
    );

    const classesById = new Map(
      classDocuments
        .filter((course) => course !== null)
        .map((course) => [course.id, course])
    );

    // 8. Replace course IDs with course details.
    const students = studentsWithEnrollments
      .map((student) => ({
        uid: student.uid,
        name: student.name,
        email: student.email,
        courses: student.courses
          .map((classId) => classesById.get(classId))
          .filter((course) => course !== undefined),
      }))
      .sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email)
      );

    // 9. Return the students and their courses.
    return NextResponse.json({ students }, { status: 200 });
  } catch (error) {
    console.error("GET /api/admin/students error:", error);

    return NextResponse.json(
      { error: "Failed to load students." },
      { status: 500 }
    );
  }
}
