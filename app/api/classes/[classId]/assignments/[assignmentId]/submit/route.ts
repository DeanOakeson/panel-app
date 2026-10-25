
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    classId: string;
    assignmentId: string;
  }>;
};

const BUCKET = "assignment-submissions";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const TIME_ZONE = "America/Denver";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];



function getDeadline(dueDate: unknown): Date | null {
  if (typeof dueDate !== "string") {
    return null;
  }

  // Expect a date-only string: YYYY-MM-DD.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error("Invalid assignment due date.");
  }

  const [year, month, day] = dueDate.split("-").map(Number);

  // Validate that the date actually exists.
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new Error("Invalid assignment due date.");
  }

  // Find the UTC offset for Mountain Time on the following
  // calendar day, then convert local midnight to UTC.
  const nextDay = new Date(
    Date.UTC(year, month - 1, day + 1)
  );

  const nextDateString = [
    nextDay.getUTCFullYear(),
    String(nextDay.getUTCMonth() + 1).padStart(2, "0"),
    String(nextDay.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "longOffset",
    year: "numeric",
  }).formatToParts(
    new Date(`${nextDateString}T12:00:00Z`)
  );

  const offsetText =
    parts.find((part) => part.type === "timeZoneName")?.value;

  const offsetMatch = offsetText?.match(
    /^GMT([+-])(\d{2}):(\d{2})$/
  );

  if (!offsetMatch) {
    throw new Error("Could not determine assignment deadline timezone.");
  }

  const sign = offsetMatch[1] === "+" ? 1 : -1;
  const offsetMinutes =
    sign *
    (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));

  // Midnight at the start of the following local day, minus 1 ms.
  // This correctly handles daylight saving time.
  return new Date(
    nextDay.getTime() -
      offsetMinutes * 60 * 1000 -
      1
  );
}


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

    const { error: uploadError } = await supabaseAdmin.storage
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

      const previousSubmission = await submissionRef.get();
      const previousData = previousSubmission.data();

      await submissionRef.set({
        studentId: uid,
        filePath,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        submittedAt: new Date().toISOString(),
        status: "submitted",
        grade: previousData?.grade ?? null,
        feedback: previousData?.feedback ?? "",
      });
    } catch (error) {
      await supabaseAdmin.storage
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

    // Professors can view all submissions for their own class.
    if (role === "professor") {
      const snapshot = await submissionsRef.get();

      const submissions = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const submission = doc.data();

          const { data, error } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(submission.filePath, 60 * 10);

          if (error) {
            console.error(
              "Create submission download URL failed:",
              error
            );

            return {
              studentId: submission.studentId || doc.id,
              fileName: submission.fileName,
              fileType: submission.fileType,
              fileSize: submission.fileSize,
              submittedAt: submission.submittedAt,
              status: submission.status || "submitted",
              grade: submission.grade ?? null,
              feedback: submission.feedback ?? "",
              fileUrl: null,
            };
          }

          return {
            studentId: submission.studentId || doc.id,
            fileName: submission.fileName,
            fileType: submission.fileType,
            fileSize: submission.fileSize,
            submittedAt: submission.submittedAt,
            status: submission.status || "submitted",
            grade: submission.grade ?? null,
            feedback: submission.feedback ?? "",
            fileUrl: data.signedUrl,
          };
        })
      );

      return NextResponse.json({
        role,
        submissions,
      });
    }

    // Students can access only their own submission.
    const submissionDoc = await submissionsRef.doc(uid).get();

    if (!submissionDoc.exists) {
      return NextResponse.json({
        role,
        submission: null,
      });
    }

    const submission = submissionDoc.data()!;

    const { data, error } = await supabaseAdmin.storage
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
        grade: submission.grade ?? null,
        feedback: submission.feedback ?? "",
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
