import { NextRequest, NextResponse } from "next/server";
import { getClassAccess } from "@/lib/classAccess";
import { loadGradebook } from "@/lib/classRoster";

type RouteContext = { params: Promise<{ classId: string }> };

/**
 * Returns the course's gradebook: every student against every assignment.
 * Only the class's professor and admins may view it.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);

    if (access.error) return access.error;

    if (!access.isClassProfessor && !access.isAdmin) {
      return NextResponse.json(
        { error: "Only this class's professor can view the gradebook." },
        { status: 403 }
      );
    }

    const gradebook = await loadGradebook(classId, {
      canGradeSubmissions: access.isClassProfessor,
    });

    if (!gradebook) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    return NextResponse.json(gradebook, { status: 200 });
  } catch (error) {
    console.error("GET /api/classes/[classId]/gradebook failed:", error);

    return NextResponse.json(
      { error: "Failed to load the gradebook." },
      { status: 500 }
    );
  }
}
