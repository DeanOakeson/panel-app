
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";

type RouteContext = {
  params: Promise<{ classId: string; studentId: string }>;
};

const SUBMISSION_BUCKET = "assignment-submissions";

/** Removes a student's enrollment and submission files from the class. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const db = getAdminDb();
    const { classId, studentId } = await params;

    const classDoc = await db.collection("classes").doc(classId).get();
    if (!classDoc.exists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const studentDoc = await db.collection("users").doc(studentId).get();
    if (!studentDoc.exists) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const enrollmentRef = db
      .collection("users")
      .doc(studentId)
      .collection("classes")
      .doc(classId);

    const enrollment = await enrollmentRef.get();

    if (!enrollment.exists) {
      return NextResponse.json(
        { error: "Student is not enrolled in this class" },
        { status: 404 }
      );
    }

    // Find all assignment submission files belonging to this student in this class.
    const supabase = getSupabaseAdmin();
    const studentFolder = `${classId}`;

    const { data: folders, error: folderError } = await supabase.storage
      .from(SUBMISSION_BUCKET)
      .list(studentFolder);

    if (folderError) {
      throw folderError;
    }

    const filePaths: string[] = [];

    for (const assignmentFolder of folders ?? []) {
      if (!assignmentFolder.id) {
        const { data: studentFolders, error: studentFolderError } =
          await supabase.storage
            .from(SUBMISSION_BUCKET)
            .list(`${classId}/${assignmentFolder.name}`);

        if (studentFolderError) throw studentFolderError;

        for (const folder of studentFolders ?? []) {
          if (folder.name === studentId && !folder.id) {
            const { data: files, error: filesError } = await supabase.storage
              .from(SUBMISSION_BUCKET)
              .list(`${classId}/${assignmentFolder.name}/${studentId}`);

            if (filesError) throw filesError;

            for (const file of files ?? []) {
              if (file.id) {
                filePaths.push(
                  `${classId}/${assignmentFolder.name}/${studentId}/${file.name}`
                );
              }
            }
          }
        }
      }
    }

    // Delete the student's files from Supabase Storage.
    if (filePaths.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(SUBMISSION_BUCKET)
        .remove(filePaths);

      if (removeError) throw removeError;
    }

    // Remove the enrollment from Firestore.
    await enrollmentRef.delete();

    return NextResponse.json(
      {
        unenrolled: true,
        classId,
        studentId,
        removedSubmissionFiles: filePaths.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "DELETE /api/admin/classes/[classId]/enrollments/[studentId] failed:",
      error
    );

    return NextResponse.json(
      { error: "Failed to unenroll student" },
      { status: 500 }
    );
  }
}
