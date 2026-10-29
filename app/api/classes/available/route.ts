import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

/**
 * Lists every class a student could enroll in, with the professor's name and
 * whether the signed-in student is already enrolled. Students only.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }

    let uid: string;

    try {
      uid = (await getAdminAuth().verifyIdToken(authHeader.slice(7))).uid;
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired authentication token." },
        { status: 401 }
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.data()?.role !== "student") {
      return NextResponse.json(
        { error: "Only students can browse courses to enroll in." },
        { status: 403 }
      );
    }

    const [classSnapshot, enrollmentSnapshot] = await Promise.all([
      db.collection("classes").get(),
      userRef.collection("classes").get(),
    ]);

    const enrolledIds = new Set(
      enrollmentSnapshot.docs.map((doc) => doc.data().class_id)
    );

    // Look up each professor's name once. getAll() rejects an empty list.
    const professorIds = [
      ...new Set(
        classSnapshot.docs
          .map((doc) => doc.data().professor_id)
          .filter((id): id is string => typeof id === "string" && id !== "")
      ),
    ];
    const professorDocs = professorIds.length
      ? await db.getAll(
          ...professorIds.map((id) => db.collection("users").doc(id))
        )
      : [];
    const professorNames = new Map(
      professorDocs.map((doc) => [
        doc.id,
        (doc.data()?.name as string | undefined) ||
          (doc.data()?.email as string | undefined) ||
          null,
      ])
    );

    const classes = classSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        // Older classes may store numbers or leave fields out, so normalize
        // everything before sorting.
        const year = Number(data.year);
        return {
          id: doc.id,
          name: String(data.name ?? ""),
          courseCode: String(data.courseCode ?? ""),
          term: String(data.term ?? ""),
          year: Number.isFinite(year) ? year : null,
          section: String(data.section ?? ""),
          professorName: professorNames.get(data.professor_id) ?? null,
          enrolled: enrolledIds.has(doc.id),
        };
      })
      .sort(
        (a, b) =>
          (b.year ?? 0) - (a.year ?? 0) ||
          a.courseCode.localeCompare(b.courseCode) ||
          a.section.localeCompare(b.section)
      );

    return NextResponse.json({ classes }, { status: 200 });
  } catch (error) {
    console.error("GET /api/classes/available failed:", error);
    return NextResponse.json(
      { error: "Failed to load courses." },
      { status: 500 }
    );
  }
}
