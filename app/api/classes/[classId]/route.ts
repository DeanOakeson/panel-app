import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";

type RouteContext = { params: Promise<{ classId: string }> };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * PANEL-90: shows which course a class page belongs to. Returns the course's
 * public identity — code, name, term, and section — to the professor who
 * teaches the class, its enrolled students, and admins. Internal fields
 * (roster, enrollment settings, professor id) are deliberately not returned.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (
      !access.isClassProfessor &&
      !access.isEnrolledStudent &&
      !access.isAdmin
    ) {
      return NextResponse.json(
        { error: "You do not have access to this class." },
        { status: 403 }
      );
    }

    const classDoc = await getAdminDb()
      .collection("classes")
      .doc(classId)
      .get();
    const data = classDoc.data() ?? {};

    return NextResponse.json(
      {
        class: {
          id: classId,
          name: text(data.name),
          courseCode: text(data.courseCode),
          term: text(data.term),
          year: typeof data.year === "number" ? data.year : null,
          section: text(data.section),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET /api/classes/[classId] failed:", error);

    return NextResponse.json(
      { error: "Failed to fetch the class." },
      { status: 500 }
    );
  }
}
