
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";

type RouteContext = {
  params: Promise<{
    classId: string;
    assignmentId: string;
  }>;
};

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { classId, assignmentId } = await params;

    // Reuse the authentication and enrollment checks
    // from the existing class assignments endpoint.
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }

    const { getAdminAuth } = await import("@/lib/firebaseAdmin");

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

    return NextResponse.json(
      {
        assignment: {
          id: assignmentDoc.id,
          ...assignmentDoc.data(),
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
