import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";
import type { DocumentReference } from "firebase-admin/firestore";

type RouteContext = { params: Promise<{ classId: string }> };

/** Same guard as `POST /api/classes` — a class term is one of these four. */
const VALID_TERMS = ["Spring", "Summer", "Fall", "Winter"];

/**
 * Finds every student enrollment for a class. Enrollments are stored in
 * users/{uid}/classes/{classId}; the shared class_id field is what lets us
 * find them from the class side.
 */
async function findEnrollmentRefs(classId: string) {
  const snapshot = await getAdminDb()
    .collectionGroup("classes")
    .where("class_id", "==", classId)
    .get();
  return snapshot.docs.map((doc) => doc.ref);
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;
    const { classId } = await params;

    const db = getAdminDb();
    const classRef = db.collection("classes").doc(classId);
    const classDoc = await classRef.get();
    if (!classDoc.exists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }
    const classData = classDoc.data() ?? {};

    const professorDoc =
      typeof classData.professor_id === "string" && classData.professor_id
        ? await db.collection("users").doc(classData.professor_id).get()
        : null;
    const professorData = professorDoc?.exists ? professorDoc.data() : undefined;

    const enrollmentRefs = await findEnrollmentRefs(classId);
    const roster = await Promise.all(
      enrollmentRefs.map(async (ref) => {
        const uid = ref.parent?.parent?.id;
        if (!uid) return null;
        const studentDoc = await db.collection("users").doc(uid).get();
        const data = studentDoc.data();
        return {
          uid,
          name: data?.name ?? "Unknown",
          email: data?.email ?? "",
        };
      })
    );
    const resolved = roster.filter(
      (r): r is { uid: string; name: string; email: string } => r !== null
    );
    resolved.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      class: { id: classId, ...classData },
      professor: professorData
        ? {
            uid: professorDoc!.id,
            name: professorData.name ?? "",
            email: professorData.email ?? "",
          }
        : null,
      roster: resolved,
    });
  } catch (error) {
    console.error("GET /api/admin/classes/[classId] failed:", error);
    return NextResponse.json(
      { error: "Failed to load class" },
      { status: 500 }
    );
  }
}

/**
 * Edits a class's metadata: name, course code, year, term, section, and the
 * assigned professor. Only the fields present in the body are written, so a
 * form that sends just what the admin changed can't clobber anything else.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;
    const { classId } = await params;

    const db = getAdminDb();
    const classRef = db.collection("classes").doc(classId);
    const classDoc = await classRef.get();
    if (!classDoc.exists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
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

    const updates: Record<string, unknown> = {};

    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 150) {
        return NextResponse.json(
          { error: "Course name is required (150 characters max)." },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if ("courseCode" in body) {
      const courseCode =
        typeof body.courseCode === "string" ? body.courseCode.trim() : "";
      if (!courseCode || courseCode.length > 30) {
        return NextResponse.json(
          { error: "Course code is required (30 characters max)." },
          { status: 400 }
        );
      }
      updates.courseCode = courseCode;
    }

    if ("year" in body) {
      const year = body.year;
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
      updates.year = year;
    }

    if ("term" in body) {
      const term = typeof body.term === "string" ? body.term : "";
      if (!VALID_TERMS.includes(term)) {
        return NextResponse.json(
          { error: "Term must be Spring, Summer, Fall, or Winter." },
          { status: 400 }
        );
      }
      updates.term = term;
    }

    if ("section" in body) {
      const section =
        typeof body.section === "string" ? body.section.trim() : "";
      if (!section || section.length > 20) {
        return NextResponse.json(
          { error: "Section is required (20 characters max)." },
          { status: 400 }
        );
      }
      updates.section = section;
    }

    if ("professorId" in body) {
      const professorId =
        typeof body.professorId === "string" ? body.professorId.trim() : "";
      if (!professorId) {
        return NextResponse.json(
          { error: "Choose a professor for this class." },
          { status: 400 }
        );
      }

      const professorDoc = await db.collection("users").doc(professorId).get();
      if (!professorDoc.exists || professorDoc.data()?.role !== "professor") {
        return NextResponse.json(
          { error: "The selected user is not a professor." },
          { status: 400 }
        );
      }

      // Both professors' class lists are read with
      // `classes.where("professor_id", "==", uid)`, so rewriting this single
      // field drops the class from the old professor's list and adds it to the
      // new professor's list in one write — nothing else to keep in sync.
      updates.professor_id = professorId;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    updates.updatedAt = new Date().toISOString();
    await classRef.update(updates);

    const updated = await classRef.get();

    return NextResponse.json({
      class: { id: classId, ...(updated.data() ?? {}) },
    });
  } catch (error) {
    console.error("PATCH /api/admin/classes/[classId] failed:", error);
    return NextResponse.json(
      { error: "Failed to update class" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;
    const { classId } = await params;

    const db = getAdminDb();
    const classRef = db.collection("classes").doc(classId);
    const classDoc = await classRef.get();
    if (!classDoc.exists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Wipe the class document, every student enrollment, and the
    // subcollections that hang off the class (assignments, submissions,
    // materials) so nothing is left pointing at a deleted class.
    const enrollmentRefs = await findEnrollmentRefs(classId);
    const docsToDelete: DocumentReference[] = [classRef, ...enrollmentRefs];

    const assignments = await classRef.collection("assignments").get();
    for (const assignment of assignments.docs) {
      docsToDelete.push(assignment.ref);
      const submissions = await assignment.ref.collection("submissions").get();
      for (const submission of submissions.docs) {
        docsToDelete.push(submission.ref);
      }
    }

    const materials = await classRef.collection("materials").get();
    for (const material of materials.docs) {
      docsToDelete.push(material.ref);
    }

    for (let i = 0; i < docsToDelete.length; i += 500) {
      const batch = db.batch();
      for (const ref of docsToDelete.slice(i, i + 500)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    return NextResponse.json({
      deleted: true,
      classId,
      studentsRemoved: enrollmentRefs.length,
    });
  } catch (error) {
    console.error("DELETE /api/admin/classes/[classId] failed:", error);
    return NextResponse.json(
      { error: "Failed to delete class" },
      { status: 500 }
    );
  }
}
