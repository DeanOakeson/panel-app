import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/classes/[classId]/assignments/[assignmentId]/submit/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const storage = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ storage: { from: () => storage } }),
}));

const classId = "class-1";
const assignmentId = "assignment-1";

const assignment = {
  name: "Project 1",
  description: "Build it",
  points: 100,
  dueDate: "2099-11-01",
};

function assignmentDoc(id = assignmentId) {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(id);
}

function getSubmissions(idToken?: string, ids = { classId, assignmentId }) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return GET(
    new NextRequest(
      `http://localhost/api/classes/${ids.classId}/assignments/${ids.assignmentId}/submit`,
      { headers }
    ),
    { params: Promise.resolve(ids) }
  );
}

/** Returns a stored submission document for a file the student uploaded. */
function fileSubmission(studentUid: string, submittedAt = "2026-10-30T12:00:00.000Z") {
  return {
    studentId: studentUid,
    filePath: `${classId}/${assignmentId}/${studentUid}/1-work.pdf`,
    fileName: "work.pdf",
    fileType: "application/pdf",
    fileSize: 2048,
    submittedAt,
    status: "submitted",
  };
}

/** Returns what the route sends back for `fileSubmission(studentUid)`. */
function submissionResponse(studentUid: string, submittedAt?: string) {
  const { filePath, ...submission } = fileSubmission(studentUid, submittedAt);

  return {
    ...submission,
    grade: null,
    feedback: "",
    gradedAt: null,
    resubmittedAfterGrading: false,
    fileUrl: `https://files.example.com/${filePath}`,
  };
}

/** Stores a student's submission, and their users profile when `name` is given. */
async function addSubmission(
  studentUid: string,
  name: string | null,
  submittedAt?: string,
  toAssignment = assignmentId
) {
  if (name) {
    await getAdminDb()
      .collection("users")
      .doc(studentUid)
      .set({ name, email: `${studentUid}@example.com`, role: "student" });
  }

  await assignmentDoc(toAssignment)
    .collection("submissions")
    .doc(studentUid)
    .set(fileSubmission(studentUid, submittedAt));
}

/**
 * Stores a grade for a student's submission. `submittedAt` is the version it
 * graded, the stored submission's by default.
 */
async function addGrade(
  studentUid: string,
  score: number,
  feedback = "",
  submittedAt = fileSubmission(studentUid).submittedAt
) {
  const grade = {
    score,
    feedback,
    submittedAt,
    gradedBy: "owner",
    gradedAt: "2026-11-02T09:00:00.000Z",
  };
  await assignmentDoc().collection("grades").doc(studentUid).set(grade);

  return grade;
}

/** Creates a signed-in student enrolled in the class. */
async function createEnrolledStudent(email = "student@example.com") {
  const student = await createSignedInUser(email, "student");
  await getAdminDb()
    .collection("users")
    .doc(student.uid)
    .collection("classes")
    .add({ class_id: classId });

  return student;
}

let ownerToken: string;

beforeEach(async () => {
  await clearEmulators();

  vi.restoreAllMocks();
  storage.createSignedUrl.mockReset();
  storage.createSignedUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: `https://files.example.com/${path}` },
    error: null,
  }));

  const owner = await createSignedInUser("owner@example.com", "professor");
  ownerToken = owner.idToken;

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: owner.uid });
  await assignmentDoc().set(assignment);
});

describe("GET /api/classes/[classId]/assignments/[assignmentId]/submit", () => {
  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const res = await getSubmissions();

      expect(res.status).toBe(401);
    });

    it("returns 401 for a token the Auth emulator did not issue", async () => {
      const res = await getSubmissions("not-a-real-token");

      expect(res.status).toBe(401);
    });
  });

  describe("authorization", () => {
    it("returns 403 for a professor who does not teach the class", async () => {
      const { idToken } = await createSignedInUser("other@example.com", "professor");

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(403);
    });

    it("returns 403 for a student who is not enrolled in the class", async () => {
      const { idToken } = await createSignedInUser("student@example.com", "student");

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(403);
    });

    it("returns 403 for an admin", async () => {
      const { idToken } = await createSignedInUser("admin@example.com", "admin");

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(403);
    });
  });

  describe("as the class's professor", () => {
    it("returns 404 for a class that does not exist", async () => {
      const res = await getSubmissions(ownerToken, { classId: "missing", assignmentId });

      expect(res.status).toBe(404);
    });

    it("returns 404 for an assignment that does not exist", async () => {
      const res = await getSubmissions(ownerToken, { classId, assignmentId: "missing" });

      expect(res.status).toBe(404);
    });

    it("returns an empty list when nobody has submitted", async () => {
      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role: "professor", submissions: [] });
    });

    it("lists the assignment's submissions by student name, with names and emails", async () => {
      await addSubmission("zoe", "Zoe Zhang", "2026-10-30T09:00:00.000Z");
      await addSubmission("ada", "Ada Lovelace", "2026-10-31T09:00:00.000Z");
      await assignmentDoc("assignment-2").set({ ...assignment, name: "Project 2" });
      await addSubmission("bob", "Bob Brown", undefined, "assignment-2");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).submissions).toEqual([
        {
          ...submissionResponse("ada", "2026-10-31T09:00:00.000Z"),
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
        },
        {
          ...submissionResponse("zoe", "2026-10-30T09:00:00.000Z"),
          studentName: "Zoe Zhang",
          studentEmail: "zoe@example.com",
        },
      ]);
    });

    it("lists students without a profile after named students, by student ID", async () => {
      await addSubmission("zoe", "Zoe Zhang");
      await addSubmission("ghost", null);
      await addSubmission("ada", "Ada Lovelace");
      await addSubmission("abe", null);

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).submissions).toEqual([
        {
          ...submissionResponse("ada"),
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
        },
        {
          ...submissionResponse("zoe"),
          studentName: "Zoe Zhang",
          studentEmail: "zoe@example.com",
        },
        {
          ...submissionResponse("abe"),
          studentName: null,
          studentEmail: null,
        },
        {
          ...submissionResponse("ghost"),
          studentName: null,
          studentEmail: null,
        },
      ]);
    });

    it("includes each submission's grade from the grades collection", async () => {
      await addSubmission("ada", "Ada Lovelace");
      await addSubmission("zoe", "Zoe Zhang");
      const grade = await addGrade("ada", 87.5, "Strong work");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const { submissions } = await res.json();
      expect(submissions[0]).toMatchObject({
        studentId: "ada",
        grade: 87.5,
        feedback: "Strong work",
        gradedAt: grade.gradedAt,
      });
      expect(submissions[1]).toMatchObject({
        studentId: "zoe",
        grade: null,
        feedback: "",
        gradedAt: null,
      });
    });

    it("flags a submission whose file is not the version that was graded", async () => {
      await addSubmission("ada", "Ada Lovelace", "2026-11-03T09:00:00.000Z");
      await addSubmission("zoe", "Zoe Zhang", "2026-11-01T09:00:00.000Z");
      await addGrade("ada", 90, "", "2026-11-01T08:00:00.000Z");
      await addGrade("zoe", 80, "", "2026-11-01T09:00:00.000Z");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const { submissions } = await res.json();
      expect(submissions[0]).toMatchObject({
        studentId: "ada",
        grade: 90,
        resubmittedAfterGrading: true,
      });
      expect(submissions[1]).toMatchObject({
        studentId: "zoe",
        grade: 80,
        resubmittedAfterGrading: false,
      });
    });

    it("lists a submission without a file link when the link cannot be made", async () => {
      await addSubmission("ada", "Ada Lovelace");
      storage.createSignedUrl.mockResolvedValue({
        data: null,
        error: new Error("Storage is down"),
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).submissions[0].fileUrl).toBeNull();
    });
  });

  describe("as an enrolled student", () => {
    it("returns a null submission when the student has not submitted", async () => {
      const { idToken } = await createEnrolledStudent();

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role: "student", submission: null });
    });

    it("returns only the student's own submission", async () => {
      const { uid, idToken } = await createEnrolledStudent();
      await addSubmission(uid, null);
      await addSubmission("zoe", "Zoe Zhang");

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        role: "student",
        submission: submissionResponse(uid),
      });
    });

    it("returns the student's grade and feedback from the grades collection", async () => {
      const { uid, idToken } = await createEnrolledStudent();
      await addSubmission(uid, null);
      const grade = await addGrade(uid, 0, "Missing the second half");
      await addGrade("zoe", 100);

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect((await res.json()).submission).toEqual({
        ...submissionResponse(uid),
        grade: 0,
        feedback: "Missing the second half",
        gradedAt: grade.gradedAt,
      });
    });

    it("flags the student's grade once they resubmit after grading", async () => {
      const { uid, idToken } = await createEnrolledStudent();
      await addSubmission(uid, null, "2026-11-01T09:00:00.000Z");
      await addGrade(uid, 85, "", "2026-11-01T09:00:00.000Z");

      const graded = await getSubmissions(idToken);

      expect((await graded.json()).submission).toMatchObject({
        grade: 85,
        resubmittedAfterGrading: false,
      });

      await addSubmission(uid, null, "2026-11-03T09:00:00.000Z");

      const resubmitted = await getSubmissions(idToken);

      expect(resubmitted.status).toBe(200);
      expect((await resubmitted.json()).submission).toMatchObject({
        submittedAt: "2026-11-03T09:00:00.000Z",
        grade: 85,
        resubmittedAfterGrading: true,
      });
    });
  });
});
