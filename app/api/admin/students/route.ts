import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";

export async function GET(req: Request) {
  try {
    // 1. Only admins may list students (role-based, see lib/adminGuard.ts).
    const { error } = await requireAdmin(req);
    if (error) return error;

    const db = getAdminDb();

    // 2. Retrieve all student profiles.
    const studentsSnapshot = await db
      .collection("users")
      .where("role", "==", "student")
      .get();

    // 3. Read each student's enrollments.
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

    // 4. Fetch each unique course document only once.
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

    // 5. Replace course IDs with course details.
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

    // 6. Return the students and their courses.
    return NextResponse.json({ students }, { status: 200 });
  } catch (error) {
    console.error("GET /api/admin/students error:", error);

    return NextResponse.json(
      { error: "Failed to load students." },
      { status: 500 }
    );
  }
}
