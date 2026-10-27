import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";
import type { DocumentReference } from "firebase-admin/firestore";

type RouteContext = { params: Promise<{ classId: string }> };

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
