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

    // 2. Get the professor's profile
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
    if (user?.role !== "professor") {
      return NextResponse.json(
        { error: "Only professors can use this endpoint" },
        { status: 403 }
      );
    }

    // 4. Find classes assigned to this professor
    const classSnapshot = await db
      .collection("classes")
      .where("professor_id", "==", uid)
      .get();

    // 5. Return the professor's classes
    const classes = classSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json(
      { classes },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET /api/classes/professor failed:", error);

    return NextResponse.json(
      { error: "Failed to fetch professor classes" },
      { status: 500 }
    );
  }
}