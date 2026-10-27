import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";

type RouteContext = { params: Promise<{ classId: string }> };

/** Enrolls an existing student in the class by creating the enrollment doc. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const db = getAdminDb();
    const { classId } = await params;
    const classDoc = await db.collection("classes").doc(classId).get();
    if (!classDoc.exists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    let body: { studentId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const studentId = body.studentId;
    if (typeof studentId !== "string" || !studentId.trim()) {
      return NextResponse.json(
        { error: "studentId is required" },
        { status: 400 }
      );
    }

    const studentDoc = await db.collection("users").doc(studentId.trim()).get();
    if (!studentDoc.exists) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    if (studentDoc.data()?.role !== "student") {
      return NextResponse.json(
        { error: "Only students can be enrolled in a class" },
        { status: 400 }
      );
    }

    const enrollmentRef = db
      .collection("users")
      .doc(studentId.trim())
      .collection("classes")
      .doc(classId);
    const existing = await enrollmentRef.get();
    if (existing.exists) {
      return NextResponse.json(
        { error: "Student is already enrolled in this class" },
        { status: 409 }
      );
    }

    await enrollmentRef.set({
      class_id: classId,
      enrolledAt: Date.now(),
    });

    return NextResponse.json(
      {
        enrolled: true,
        classId,
        studentId: studentId.trim(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/admin/classes/[classId]/enrollments failed:", error);
    return NextResponse.json(
      { error: "Failed to enroll student" },
      { status: 500 }
    );
  }
}
