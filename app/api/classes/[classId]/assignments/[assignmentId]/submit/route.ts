
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getDeadline } from "@/lib/assignmentDeadline";

type RouteContext = {
  params: Promise<{
    classId: string;
    assignmentId: string;
  }>;
};

const BUCKET = "assignment-submissions";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { classId, assignmentId } = await params;
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Please sign in first." },
        { status: 401 }
      );
    }

    let uid: string;

    try {
      const decoded = await getAdminAuth().verifyIdToken(
        authorization.slice(7)
      );
      uid = decoded.uid;
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired login session." },
        { status: 401 }
      );
    }

    const db = getAdminDb();

    const [userDoc, classDoc, assignmentDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("classes").doc(classId).get(),
      db.collection("classes").doc(classId)
        .collection("assignments").doc(assignmentId).get(),
    ]);

    if (!userDoc.exists || !classDoc.exists || !assignmentDoc.exists) {
      return NextResponse.json(
        { error: "User, class, or assignment not found." },
        { status: 404 }
      );
    }

    if (userDoc.data()?.role !== "student") {
      return NextResponse.json(
        { error: "Only students can submit assignments." },
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

    // Check the deadline on the server before accepting the file.
    const assignmentData = assignmentDoc.data();
    const dueDate = assignmentData?.dueDate;

    if (dueDate) {
      let deadline: Date | null;

      try {
        deadline = getDeadline(dueDate);
      } catch {
        return NextResponse.json(
          { error: "This assignment has an invalid due date." },
          { status: 500 }
        );
      }

      if (deadline && Date.now() > deadline.getTime()) {
        return NextResponse.json(
          {
            error:
              "The due date has passed. You can no longer submit this assignment.",
          },
          { status: 403 }
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Please select a file to submit." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "The maximum file size is 10 MB." },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF, DOCX, JPG, and PNG files are allowed." },
        { status: 400 }
      );
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath =
      `${classId}/${assignmentId}/${uid}/` +
      `${Date.now()}-${safeName}`;

    const { error: uploadError } = await getSupabaseAdmin().storage
      .from(BUCKET)
      .upload(filePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Assignment file upload failed:", uploadError);

      return NextResponse.json(
        { error: "Failed to upload the file." },
        { status: 500 }
      );
    }

    try {
      const submissionRef = db
        .collection("classes")
        .doc(classId)
        .collection("assignments")
        .doc(assignmentId)
        .collection("submissions")
        .doc(uid);

      await submissionRef.set({
        studentId: uid,
        filePath,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        submittedAt: new Date().toISOString(),
        status: "submitted",
      });
    } catch (error) {
      await getSupabaseAdmin().storage
        .from(BUCKET)
        .remove([filePath]);

      throw error;
    }

    return NextResponse.json(
      { message: "Assignment submitted successfully." },
      { status: 201 }
    );
  } catch (error) {
    console.error("Assignment submission failed:", error);

    return NextResponse.json(
      { error: "Failed to submit assignment." },
      { status: 500 }
    );
  }
}


async function authorizeSubmissionAccess(
  request: NextRequest,
  classId: string
) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return { error: "Please sign in first.", status: 401 };
  }

  let uid: string;

  try {
    const decoded = await getAdminAuth().verifyIdToken(
      authorization.slice(7)
    );
    uid = decoded.uid;
  } catch {
    return {
      error: "Invalid or expired login session.",
      status: 401,
    };
  }

  const db = getAdminDb();

  const [userDoc, classDoc] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("classes").doc(classId).get(),
  ]);

  if (!userDoc.exists || !classDoc.exists) {
    return {
      error: "User or class not found.",
      status: 404,
    };
  }

  const role = userDoc.data()?.role;
  const classData = classDoc.data();

  if (role === "professor") {
    if (classData?.professor_id !== uid) {
      return {
        error: "You do not have permission to view this class's submissions.",
        status: 403,
      };
    }

    return { uid, db, role };
  }

  if (role === "student") {
    const enrollment = await db
      .collection("users")
      .doc(uid)
      .collection("classes")
      .where("class_id", "==", classId)
      .limit(1)
      .get();

    if (enrollment.empty) {
      return {
        error: "You are not enrolled in this class.",
        status: 403,
      };
    }

    return { uid, db, role };
  }

  return {
    error: "You do not have permission to access submissions.",
    status: 403,
  };
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { classId, assignmentId } = await params;

    const auth = await authorizeSubmissionAccess(request, classId);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const { uid, db, role } = auth;

    const assignmentRef = db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId);

    const assignmentDoc = await assignmentRef.get();

    if (!assignmentDoc.exists) {
      return NextResponse.json(
        { error: "Assignment not found." },
        { status: 404 }
      );
    }

    const submissionsRef = assignmentRef.collection("submissions");
    const gradesRef = assignmentRef.collection("grades");

    // Professors can view all submissions for their own class.
    if (role === "professor") {
      const [snapshot, gradeSnapshot] = await Promise.all([
        submissionsRef.get(),
        gradesRef.get(),
      ]);

      // getAll() rejects an empty argument list
      const studentDocs = snapshot.empty
        ? []
        : await db.getAll(
            ...snapshot.docs.map((doc) => db.collection("users").doc(doc.id))
          );
      const students = new Map(
        studentDocs.map((studentDoc) => [studentDoc.id, studentDoc.data()])
      );
      const grades = new Map(
        gradeSnapshot.docs.map((gradeDoc) => [gradeDoc.id, gradeDoc.data()])
      );

      const submissions = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const submission = doc.data();
          const student = students.get(doc.id);
          const grade = grades.get(doc.id);

          const { data, error } = await getSupabaseAdmin().storage
            .from(BUCKET)
            .createSignedUrl(submission.filePath, 60 * 10);

          if (error) {
            console.error(
              "Create submission download URL failed:",
              error
            );
          }

          return {
            studentId: submission.studentId || doc.id,
            studentName: (student?.name as string | undefined) ?? null,
            studentEmail: (student?.email as string | undefined) ?? null,
            fileName: submission.fileName,
            fileType: submission.fileType,
            fileSize: submission.fileSize,
            submittedAt: submission.submittedAt,
            status: submission.status || "submitted",
            grade: grade?.score ?? null,
            feedback: grade?.feedback ?? "",
            gradedAt: grade?.gradedAt ?? null,
            resubmittedAfterGrading:
              !!grade && submission.submittedAt !== grade.submittedAt,
            fileUrl: error ? null : data.signedUrl,
          };
        })
      );

      // Rows shown as "Unknown student" go after every named student
      submissions.sort((first, second) => {
        const firstName = first.studentName ?? first.studentEmail;
        const secondName = second.studentName ?? second.studentEmail;

        if (firstName !== null && secondName !== null) {
          return firstName.localeCompare(secondName);
        }

        if (firstName !== null) return -1;
        if (secondName !== null) return 1;

        return first.studentId.localeCompare(second.studentId);
      });

      return NextResponse.json({
        role,
        submissions,
      });
    }

    // Students can access only their own submission.
    const [submissionDoc, gradeDoc] = await Promise.all([
      submissionsRef.doc(uid).get(),
      gradesRef.doc(uid).get(),
    ]);

    if (!submissionDoc.exists) {
      return NextResponse.json({
        role,
        submission: null,
      });
    }

    const submission = submissionDoc.data()!;
    const grade = gradeDoc.data();

    const { data, error } = await getSupabaseAdmin().storage
      .from(BUCKET)
      .createSignedUrl(submission.filePath, 60 * 10);

    if (error) {
      console.error("Create submission download URL failed:", error);

      return NextResponse.json(
        { error: "Could not create a download link for your file." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      role,
      submission: {
        studentId: uid,
        fileName: submission.fileName,
        fileType: submission.fileType,
        fileSize: submission.fileSize,
        submittedAt: submission.submittedAt,
        status: submission.status || "submitted",
        grade: grade?.score ?? null,
        feedback: grade?.feedback ?? "",
        gradedAt: grade?.gradedAt ?? null,
        resubmittedAfterGrading:
          !!grade && submission.submittedAt !== grade.submittedAt,
        fileUrl: data.signedUrl,
      },
    });
  } catch (error) {
    console.error("Get assignment submission failed:", error);

    return NextResponse.json(
      { error: "Failed to load submissions." },
      { status: 500 }
    );
  }
}
