import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";

type RouteContext = { params: Promise<{ classId: string }> };

/**
 * Enrolls the signed-in student in a class. Enrolling twice is harmless:
 * the second call reports the existing enrollment instead of adding another.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (access.role !== "student") {
      return NextResponse.json(
        { error: "Only students can enroll in a course." },
        { status: 403 }
      );
    }

    if (access.isEnrolledStudent) {
      return NextResponse.json(
        { enrolled: true, alreadyEnrolled: true },
        { status: 200 }
      );
    }

    // Enrollment lives at users/{uid}/classes/{doc} with a class_id field.
    // Using the class ID as the doc ID means a double click can't create two.
    await getAdminDb()
      .collection("users")
      .doc(access.uid)
      .collection("classes")
      .doc(classId)
      .set({ class_id: classId, enrolledAt: new Date().toISOString() });

    return NextResponse.json(
      { enrolled: true, alreadyEnrolled: false },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/classes/[classId]/enroll failed:", error);
    return NextResponse.json(
      { error: "Failed to enroll in the course." },
      { status: 500 }
    );
  }
}
