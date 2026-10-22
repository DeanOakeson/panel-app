import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";

type RouteContext = { params: Promise<{ classId: string }> };

/**
 * Returns the URL if it is a well-formed http(s) link, otherwise null.
 * Other schemes (javascript:, data:, file:) are rejected so a link can't run
 * code or point at the viewer's own machine.
 */
function parseLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Lists a class's course materials for its professor, admins, or enrolled students. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (!access.isClassProfessor && !access.isEnrolledStudent && !access.isAdmin) {
      return NextResponse.json(
        { error: "You do not have access to this class." },
        { status: 403 }
      );
    }

    const snapshot = await getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("materials")
      .orderBy("createdAt")
      .get();

    const materials = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ materials }, { status: 200 });
  } catch (error) {
    console.error("GET /api/classes/[classId]/materials failed:", error);
    return NextResponse.json(
      { error: "Failed to load course materials." },
      { status: 500 }
    );
  }
}

/** Adds a course material link. Only the class's professor may do this. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (!access.isClassProfessor) {
      return NextResponse.json(
        { error: "Only this class's professor can add course materials." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const url = parseLink(body.url);

    if (!title || title.length > 150) {
      return NextResponse.json(
        { error: "Title is required (150 characters max)." },
        { status: 400 }
      );
    }

    if (!url) {
      return NextResponse.json(
        { error: "Enter a valid link starting with http:// or https://." },
        { status: 400 }
      );
    }

    if (description.length > 1000) {
      return NextResponse.json(
        { error: "Description must be 1000 characters or fewer." },
        { status: 400 }
      );
    }

    const materialRef = getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("materials")
      .doc();

    const material = {
      title,
      url,
      description,
      createdBy: access.uid,
      createdAt: new Date().toISOString(),
    };

    await materialRef.set(material);

    return NextResponse.json(
      { material: { id: materialRef.id, ...material } },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/classes/[classId]/materials failed:", error);
    return NextResponse.json(
      { error: "Failed to add course material." },
      { status: 500 }
    );
  }
}
