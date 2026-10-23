
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

const VALID_TERMS = ["Spring", "Summer", "Fall", "Winter"];

export async function POST(request: NextRequest) {
  try {
    // 1. Verify authentication token
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      );
    }

    let decodedToken;

    try {
      const token = authHeader.slice(7);
      decodedToken = await getAdminAuth().verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired authentication token." },
        { status: 401 }
      );
    }

    const uid = decodedToken.uid;
    const db = getAdminDb();

    // 2. Verify that the user is an admin or a professor
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return NextResponse.json(
        { error: "User profile not found." },
        { status: 404 }
      );
    }

    const callerRole = userDoc.data()?.role;

    if (callerRole !== "admin" && callerRole !== "professor") {
      return NextResponse.json(
        { error: "Only admins and professors can create classes." },
        { status: 403 }
      );
    }

    // 3. Read and validate request body
    let body: Record<string, unknown>;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const courseCode =
      typeof body.courseCode === "string"
        ? body.courseCode.trim()
        : "";

    const year = body.year;

    const term =
      typeof body.term === "string" ? body.term : "";

    const section =
      typeof body.section === "string"
        ? body.section.trim()
        : "";

    if (!name || !courseCode || !section || !term || year === undefined) {
      return NextResponse.json(
        {
          error:
            "Course name, course code, year, term, and section are required.",
        },
        { status: 400 }
      );
    }

    if (name.length > 150 || courseCode.length > 30) {
      return NextResponse.json(
        { error: "Course name or course code is too long." },
        { status: 400 }
      );
    }

    if (
      typeof year !== "number" ||
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100
    ) {
      return NextResponse.json(
        { error: "Year must be a valid number between 2000 and 2100." },
        { status: 400 }
      );
    }

    if (!VALID_TERMS.includes(term)) {
      return NextResponse.json(
        { error: "Term must be Spring, Summer, Fall, or Winter." },
        { status: 400 }
      );
    }

    if (section.length > 20) {
      return NextResponse.json(
        { error: "Section must be 20 characters or fewer." },
        { status: 400 }
      );
    }

    // 4. Decide who teaches the class. A professor creates classes for
    //    themselves; an admin must choose an existing professor.
    let professorId = uid;

    if (callerRole === "admin") {
      const requested =
        typeof body.professorId === "string" ? body.professorId.trim() : "";

      if (!requested) {
        return NextResponse.json(
          { error: "Choose a professor for this class." },
          { status: 400 }
        );
      }

      const professorDoc = await db.collection("users").doc(requested).get();

      if (!professorDoc.exists || professorDoc.data()?.role !== "professor") {
        return NextResponse.json(
          { error: "The selected user is not a professor." },
          { status: 400 }
        );
      }

      professorId = requested;
    }

    // 5. Create the class in Firestore
    const classRef = db.collection("classes").doc();

    const newClass = {
      name,
      courseCode,
      year,
      term,
      section,
      professor_id: professorId,
      createdBy: uid,
      createdAt: new Date().toISOString(),
    };

    await classRef.set(newClass);

    // 6. Return the created class
    return NextResponse.json(
      {
        message: "Class created successfully.",
        class: {
          id: classRef.id,
          ...newClass,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/classes failed:", error);

    return NextResponse.json(
      { error: "Failed to create class." },
      { status: 500 }
    );
  }
}
