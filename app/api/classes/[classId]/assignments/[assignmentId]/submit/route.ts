import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { DocumentData } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getEffectiveClosesAt,
  isLateSubmission,
} from "@/lib/assignmentDeadline";
import { loadEnrolledStudentIds } from "@/lib/classRoster";
import {
  getGradingStatus,
  gradingStatusRank,
  isMissingWorkGrade,
  summarizeMissingGrade,
} from "@/lib/gradingStatus";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    classId: string;
    assignmentId: string;
  }>;
};

const BUCKET = "assignment-submissions";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_STORED_SUBMISSIONS = 3;
const MAX_FILE_NAME_LENGTH = 255;

const ALLOWED_FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

class SubmissionRuleError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SubmissionRuleError";
    this.status = status;
  }
}

/**
 * Checks the current assignment settings before accepting a submission.
 */
function checkSubmissionRules(
  assignment: DocumentData,
  now = Date.now(),
): void {
  if (assignment.isLocked === true) {
    throw new SubmissionRuleError(
      "The professor has closed submissions for this assignment.",
      403,
    );
  }

  let closesAt: string | null;

  try {
    closesAt = getEffectiveClosesAt(assignment.dueDate, assignment.lateUntil);
  } catch {
    throw new SubmissionRuleError(
      "This assignment has invalid deadline settings.",
      500,
    );
  }

  if (closesAt) {
    const deadline = Date.parse(closesAt);

    if (!Number.isFinite(deadline)) {
      throw new SubmissionRuleError(
        "This assignment has invalid deadline settings.",
        500,
      );
    }

    if (now >= deadline) {
      throw new SubmissionRuleError(
        "The due date has passed or the late submission deadline has passed. You can no longer submit this assignment.",
        403,
      );
    }
  }
}

/**
 * Safely determines whether a submission was received after the original
 * due-date cutoff.
 */
function getIsLate(
  submittedAt: string | number | Date,
  dueDate: unknown,
): boolean {
  try {
    return isLateSubmission(submittedAt, dueDate);
  } catch {
    return false;
  }
}

/**
 * Checks whether a ZIP archive contains the required DOCX entries.
 * DOCX files are ZIP archives containing Word document XML files.
 */
function isValidDocx(buffer: Buffer): boolean {
  if (buffer.length < 22) {
    return false;
  }

  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  let endRecordOffset = -1;

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = buffer.readUInt16LE(offset + 20);

      if (offset + 22 + commentLength === buffer.length) {
        endRecordOffset = offset;
        break;
      }
    }
  }

  if (endRecordOffset === -1) {
    return false;
  }

  const diskNumber = buffer.readUInt16LE(endRecordOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(endRecordOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(endRecordOffset + 8);
  const totalEntries = buffer.readUInt16LE(endRecordOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endRecordOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endRecordOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0 ||
    totalEntries > 1000 ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    return false;
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (
    centralDirectoryOffset < 0 ||
    centralDirectoryEnd > endRecordOffset ||
    centralDirectoryEnd > buffer.length
  ) {
    return false;
  }

  const entries = new Set<string>();
  let totalUncompressedSize = 0;
  let offset = centralDirectoryOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (
      offset + 46 > centralDirectoryEnd ||
      buffer.readUInt32LE(offset) !== 0x02014b50
    ) {
      return false;
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    const entryEnd = offset + 46 + fileNameLength + extraLength + commentLength;

    if (
      entryEnd > centralDirectoryEnd ||
      (flags & 0x0001) !== 0 ||
      (compressionMethod !== 0 && compressionMethod !== 8) ||
      uncompressedSize === 0xffffffff
    ) {
      return false;
    }

    totalUncompressedSize += uncompressedSize;

    if (totalUncompressedSize > 50 * 1024 * 1024) {
      return false;
    }

    const fileName = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    entries.add(fileName);
    offset = entryEnd;
  }

  if (offset !== centralDirectoryEnd) {
    return false;
  }

  return entries.has("[Content_Types].xml") && entries.has("word/document.xml");
}

/**
 * Detects the file format using its actual contents.
 * This does not rely on the browser-provided MIME type.
 */
function detectFileType(buffer: Buffer): string | null {
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  ) {
    return "application/pdf";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }

  if (isValidDocx(buffer)) {
    return ALLOWED_FILE_TYPES[".docx"];
  }

  return null;
}

/**
 * Validates the extension, declared MIME type, and actual file contents.
 */
function validateUploadedFile(
  fileName: string,
  declaredMimeType: string,
  buffer: Buffer,
): string | null {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();

  const expectedMimeType = ALLOWED_FILE_TYPES[extension];

  if (!expectedMimeType) {
    return null;
  }

  if (declaredMimeType && declaredMimeType !== expectedMimeType) {
    return null;
  }

  const detectedMimeType = detectFileType(buffer);

  if (detectedMimeType !== expectedMimeType) {
    return null;
  }

  return detectedMimeType;
}

/**
 * Returns the grade fields a submission row shows, which describe only a
 * grade that belongs to a submission. A missing-work grade shows as ungraded.
 */
function submissionGradeFields(
  submission: DocumentData,
  stored: DocumentData | undefined,
) {
  const grade = stored && !isMissingWorkGrade(stored) ? stored : undefined;

  return {
    grade: grade?.score ?? null,
    feedback: grade?.feedback ?? "",
    gradedAt: grade?.gradedAt ?? null,
    gradeUpdatedAt: grade?.updatedAt ?? null,
    resubmittedAfterGrading:
      !!grade && submission.submittedAt !== grade.submittedAt,
    submittedAfterMissingGrade: !!stored && isMissingWorkGrade(stored),
  };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  let uploadedFilePath: string | null = null;
  let submissionSaved = false;

  try {
    const { classId, assignmentId } = await params;
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Please sign in first." },
        { status: 401 },
      );
    }

    let uid: string;

    try {
      const decoded = await getAdminAuth().verifyIdToken(
        authorization.slice(7),
      );
      uid = decoded.uid;
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired login session." },
        { status: 401 },
      );
    }

    const db = getAdminDb();

    const assignmentRef = db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc(assignmentId);

    const [userDoc, classDoc, assignmentDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("classes").doc(classId).get(),
      assignmentRef.get(),
    ]);

    if (!userDoc.exists || !classDoc.exists || !assignmentDoc.exists) {
      return NextResponse.json(
        { error: "User, class, or assignment not found." },
        { status: 404 },
      );
    }

    if (userDoc.data()?.role !== "student") {
      return NextResponse.json(
        { error: "Only students can submit assignments." },
        { status: 403 },
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
        { status: 403 },
      );
    }

    // Check the current lock and effective deadline before accepting the file.
    checkSubmissionRules(assignmentDoc.data() ?? {});

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Please select a file to submit." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "The maximum file size is 10 MB." },
        { status: 400 },
      );
    }

    if (
      !file.name ||
      file.name.length > MAX_FILE_NAME_LENGTH ||
      file.name.includes("\0")
    ) {
      return NextResponse.json(
        { error: "Invalid file name." },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const detectedMimeType = validateUploadedFile(
      file.name,
      file.type,
      fileBuffer,
    );

    if (!detectedMimeType) {
      return NextResponse.json(
        {
          error:
            "The file type is invalid. Please upload a valid PDF, DOCX, JPG, or PNG file.",
        },
        { status: 400 },
      );
    }

    const safeName =
      file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "submission";

    uploadedFilePath =
      `${classId}/${assignmentId}/${uid}/` +
      `${Date.now()}-${randomUUID()}-${safeName}`;

    const { error: uploadError } = await getSupabaseAdmin()
      .storage.from(BUCKET)
      .upload(uploadedFilePath, fileBuffer, {
        contentType: detectedMimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Assignment file upload failed:", uploadError);

      return NextResponse.json(
        { error: "Failed to upload the file." },
        { status: 500 },
      );
    }

    const submissionRef = assignmentRef.collection("submissions").doc(uid);

    // Recheck the assignment settings inside the transaction. This prevents
    // a student from uploading while a professor locks or closes the assignment.
    const rotation = await db.runTransaction(async (transaction) => {
      const currentAssignmentDoc = await transaction.get(assignmentRef);
      const submissionDoc = await transaction.get(submissionRef);

      if (!currentAssignmentDoc.exists) {
        throw new SubmissionRuleError("This assignment no longer exists.", 404);
      }

      const currentAssignment = currentAssignmentDoc.data() ?? {};

      checkSubmissionRules(currentAssignment);

      const submittedAt = new Date().toISOString();

      const newSubmission = {
        studentId: uid,
        filePath: uploadedFilePath!,
        fileName: file.name,
        fileType: detectedMimeType,
        fileSize: file.size,
        submittedAt,
        status: "submitted",
        isLate: getIsLate(submittedAt, currentAssignment.dueDate),
      };

      const existing = submissionDoc.data();

      const history = Array.isArray(existing?.submissionHistory)
        ? existing.submissionHistory.filter(
            (entry: DocumentData) => typeof entry?.filePath === "string",
          )
        : existing?.filePath
          ? [
              {
                filePath: existing.filePath,
                fileName: existing.fileName,
                fileType: existing.fileType,
                fileSize: existing.fileSize,
                submittedAt: existing.submittedAt,
                status: existing.status || "submitted",
                isLate:
                  typeof existing.isLate === "boolean"
                    ? existing.isLate
                    : getIsLate(
                        existing.submittedAt,
                        currentAssignment.dueDate,
                      ),
              },
            ]
          : [];

      history.push(newSubmission);

      const removedFilePaths: string[] = [];

      while (history.length > MAX_STORED_SUBMISSIONS) {
        const removed = history.shift();

        if (removed?.filePath) {
          removedFilePaths.push(removed.filePath);
        }
      }

      transaction.set(
        submissionRef,
        {
          ...newSubmission,
          submissionHistory: history,
        },
        { merge: true },
      );

      return {
        removedFilePaths,
        keptCount: history.length,
      };
    });

    // The new file is now safely referenced by Firestore.
    submissionSaved = true;

    // Delete older files after the new submission has been saved.
    if (rotation.removedFilePaths.length > 0) {
      const { error: deleteError } = await getSupabaseAdmin()
        .storage.from(BUCKET)
        .remove(rotation.removedFilePaths);

      if (deleteError) {
        console.error(
          "Could not remove old assignment submissions:",
          deleteError,
        );
      }
    }

    return NextResponse.json(
      {
        message: "Assignment submitted successfully.",
        submissionsKept: rotation.keptCount,
      },
      { status: 201 },
    );
  } catch (error) {
    // Remove the uploaded file if the transaction did not save its reference.
    if (uploadedFilePath && !submissionSaved) {
      try {
        await getSupabaseAdmin()
          .storage.from(BUCKET)
          .remove([uploadedFilePath]);
      } catch (cleanupError) {
        console.error(
          "Could not clean up failed assignment upload:",
          cleanupError,
        );
      }
    }

    if (error instanceof SubmissionRuleError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error("Assignment submission failed:", error);

    return NextResponse.json(
      { error: "Failed to submit assignment." },
      { status: 500 },
    );
  }
}

async function authorizeSubmissionAccess(
  request: NextRequest,
  classId: string,
) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return { error: "Please sign in first.", status: 401 };
  }

  let uid: string;

  try {
    const decoded = await getAdminAuth().verifyIdToken(authorization.slice(7));
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

  if (role === "admin") {
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

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, assignmentId } = await params;

    const auth = await authorizeSubmissionAccess(request, classId);

    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
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
        { status: 404 },
      );
    }

    const assignment = assignmentDoc.data() ?? {};
    const dueDate = assignment.dueDate;

    const submissionsRef = assignmentRef.collection("submissions");
    const gradesRef = assignmentRef.collection("grades");

    // Professors and admins see every enrolled student.
    if (role === "professor" || role === "admin") {
      const [snapshot, gradeSnapshot, enrolledIds] = await Promise.all([
        submissionsRef.get(),
        gradesRef.get(),
        loadEnrolledStudentIds(classId),
      ]);

      const submissionsById = new Map(
        snapshot.docs.map((doc) => [doc.id, doc.data()]),
      );

      const grades = new Map(
        gradeSnapshot.docs.map((gradeDoc) => [gradeDoc.id, gradeDoc.data()]),
      );

      const studentIds = [
        ...new Set([
          ...enrolledIds,
          ...submissionsById.keys(),
          ...grades.keys(),
        ]),
      ];

      const studentDocs =
        studentIds.length === 0
          ? []
          : await db.getAll(
              ...studentIds.map((studentId) =>
                db.collection("users").doc(studentId),
              ),
            );

      const students = new Map(
        studentDocs.map((studentDoc) => [studentDoc.id, studentDoc.data()]),
      );

      const rows = await Promise.all(
        studentIds.map(async (studentId) => {
          const student = students.get(studentId);
          const submission = submissionsById.get(studentId);
          const grade = grades.get(studentId);

          const identity = {
            studentId,
            studentName: (student?.name as string | undefined) ?? null,
            studentEmail: (student?.email as string | undefined) ?? null,
            gradingStatus: getGradingStatus(submission, grade),
            missingGrade: summarizeMissingGrade(grade),
          };

          if (!submission) {
            return identity;
          }

          const { data, error } = await getSupabaseAdmin()
            .storage.from(BUCKET)
            .createSignedUrl(submission.filePath, 60 * 10);

          if (error) {
            console.error("Create submission download URL failed:", error);
          }

          return {
            ...identity,
            fileName: submission.fileName,
            fileType: submission.fileType,
            fileSize: submission.fileSize,
            submittedAt: submission.submittedAt,
            isLate:
              typeof submission.isLate === "boolean"
                ? submission.isLate
                : getIsLate(submission.submittedAt, dueDate),
            status: submission.status || "submitted",
            ...submissionGradeFields(submission, grade),
            fileUrl: error ? null : data.signedUrl,
          };
        }),
      );

      rows.sort((first, second) => {
        const rankDifference =
          gradingStatusRank(first.gradingStatus) -
          gradingStatusRank(second.gradingStatus);

        if (rankDifference !== 0) return rankDifference;

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
        students: rows,
      });
    }

    // Students can access only their own submission and grades.
    const [submissionDoc, gradeDoc] = await Promise.all([
      submissionsRef.doc(uid).get(),
      gradesRef.doc(uid).get(),
    ]);

    const grade = gradeDoc.data();
    const missingGrade = summarizeMissingGrade(grade);

    if (!submissionDoc.exists) {
      return NextResponse.json({
        role,
        submission: null,
        submissions: [],
        missingGrade,
      });
    }

    const submission = submissionDoc.data()!;

    const history = Array.isArray(submission.submissionHistory)
      ? submission.submissionHistory.filter(
          (entry: DocumentData) => typeof entry?.filePath === "string",
        )
      : [submission];

    // Show the latest three submissions, newest first.
    const submissions = await Promise.all(
      history
        .slice(-MAX_STORED_SUBMISSIONS)
        .reverse()
        .map(async (entry: DocumentData) => {
          const { data, error } = await getSupabaseAdmin()
            .storage.from(BUCKET)
            .createSignedUrl(entry.filePath, 60 * 10);

          if (error) {
            console.error("Create submission download URL failed:", error);
          }

          return {
            studentId: uid,
            fileName: entry.fileName,
            fileType: entry.fileType,
            fileSize: entry.fileSize,
            submittedAt: entry.submittedAt,
            isLate:
              typeof entry.isLate === "boolean"
                ? entry.isLate
                : getIsLate(entry.submittedAt, dueDate),
            status: entry.status || "submitted",
            ...submissionGradeFields(entry, grade),
            fileUrl: error ? null : data.signedUrl,
          };
        }),
    );

    const latestSubmission = submissions[0] ?? null;

    return NextResponse.json({
      role,
      submission: latestSubmission,
      submissions,
      missingGrade,
    });
  } catch (error) {
    console.error("Get assignment submission failed:", error);

    return NextResponse.json(
      { error: "Failed to load submissions." },
      { status: 500 },
    );
  }
}
