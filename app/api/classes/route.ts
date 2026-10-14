
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export async function GET(request: NextRequest) {
  try {
    // 1. Verify the Firebase ID token
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    let decodedToken;

    try {
      const token = authHeader.slice(7);
      decodedToken = await getAdminAuth().verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const uid = decodedToken.uid;
    const db = getAdminDb();

    // 2. Get the user's profile
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const user = userDoc.data();

    // 3. Verify the user's role
    if (user?.role !== "student") {
      return NextResponse.json(
        { error: "Only students can use this endpoint" },
        { status: 403 }
      );
    }

    // 4. Get the student's class references
    const classSnapshot = await userRef
      .collection("classes")
      .get();

    // 5. Use each class_id to fetch the full class
    const classResults = await Promise.all(
      classSnapshot.docs.map(async (doc) => {
        const classId = doc.data().class_id;

        if (typeof classId !== "string" || !classId.trim()) {
          return null;
        }

        const classDoc = await db
          .collection("classes")
          .doc(classId)
          .get();

        if (!classDoc.exists) {
          return null;
        }

        return {
          id: classDoc.id,
          ...classDoc.data(),
        };
      })
    );

    // 6. Remove invalid or missing classes
    const classes = classResults.filter(
      (classItem) => classItem !== null
    );

    // 7. Return the classes
    return NextResponse.json(
      { classes },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET /api/classes failed:", error);

    return NextResponse.json(
      { error: "Failed to fetch classes" },
      { status: 500 }
    );
  }
}
