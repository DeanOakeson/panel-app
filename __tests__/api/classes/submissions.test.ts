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
    gradeUpdatedAt: null,
    resubmittedAfterGrading: false,
    submittedAfterMissingGrade: false,
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
 * graded, the stored submission's by default. `edit` adds the fields a later
 * edit of the grade stores.
 */
async function addGrade(
  studentUid: string,
  score: number,
  feedback = "",
  submittedAt = fileSubmission(studentUid).submittedAt,
  edit: { updatedAt: string; updatedBy: string } | null = null
) {
  const grade = {
    score,
    feedback,
    submittedAt,
    gradedBy: "owner",
    gradedAt: "2026-11-02T09:00:00.000Z",
    ...edit,
  };
  await assignmentDoc().collection("grades").doc(studentUid).set(grade);

  return grade;
}

/**
 * Stores a student's profile and enrolls them in a class, without signing
 * them in. Returns the student's uid.
 */
async function enrollStudent(uid: string, name: string, toClass = classId) {
  await getAdminDb()
    .collection("users")
    .doc(uid)
    .set({ name, email: `${uid}@example.com`, role: "student" });
  await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .doc(toClass)
    .set({ class_id: toClass });

  return uid;
}

/** Stores a missing-work grade for a student who has not submitted. */
async function addMissingGrade(
  studentUid: string,
  score: number,
  feedback = "",
  edit: { updatedAt: string; updatedBy: string } | null = null
) {
  const grade = {
    studentId: studentUid,
    classId,
    assignmentId,
    score,
    feedback,
    gradedBy: "owner",
    gradedAt: "2026-11-02T08:00:00.000Z",
    ...edit,
  };
  await assignmentDoc().collection("missingGrades").doc(studentUid).set(grade);

  return grade;
}

type ListedStudent = { studentId: string; gradingStatus: string };

/** Returns the row for one student from a professor's list. */
function rowFor(students: ListedStudent[], studentId: string) {
  return students.find((student) => student.studentId === studentId);
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

    it("gives an admin the class's roster", async () => {
      const { idToken } = await createSignedInUser("admin@example.com", "admin");
      await enrollStudent("ada", "Ada Lovelace");
      await addSubmission("zoe", "Zoe Zhang");

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe("admin");
      expect(
        body.students.map((student: ListedStudent) => [student.studentId, student.gradingStatus])
      ).toEqual([
        ["zoe", "needs-grading"],
        ["ada", "missing"],
      ]);
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

    it("returns an empty list when nobody is enrolled or has submitted", async () => {
      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role: "professor", students: [] });
    });

    it("lists enrolled students who have not submitted as missing", async () => {
      await enrollStudent("ada", "Ada Lovelace");
      await enrollStudent("zoe", "Zoe Zhang");
      await addSubmission("zoe", "Zoe Zhang");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).students).toEqual([
        {
          ...submissionResponse("zoe"),
          studentName: "Zoe Zhang",
          studentEmail: "zoe@example.com",
          gradingStatus: "needs-grading",
          missingGrade: null,
        },
        {
          studentId: "ada",
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
          gradingStatus: "missing",
          missingGrade: null,
        },
      ]);
    });

    it("leaves out students enrolled only in another class", async () => {
      await enrollStudent("ada", "Ada Lovelace");
      await enrollStudent("bob", "Bob Brown", "class-2");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect(
        (await res.json()).students.map((student: ListedStudent) => student.studentId)
      ).toEqual(["ada"]);
    });

    it("lists a student with two enrollment documents once", async () => {
      await enrollStudent("ada", "Ada Lovelace");
      await getAdminDb()
        .collection("users")
        .doc("ada")
        .collection("classes")
        .add({ class_id: classId });

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).students).toHaveLength(1);
    });

    it("lists a student who submitted but is no longer enrolled", async () => {
      await enrollStudent("ada", "Ada Lovelace");
      await addSubmission("zoe", "Zoe Zhang");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const { students } = await res.json();
      expect(rowFor(students, "zoe")?.gradingStatus).toBe("needs-grading");
      expect(rowFor(students, "ada")?.gradingStatus).toBe("missing");
    });

    it("orders work to grade, then graded work, then missing, by name in each", async () => {
      await enrollStudent("missing-amy", "Amy Adams");
      await enrollStudent("graded-ben", "Ben Brown");
      await enrollStudent("resubmitted-cal", "Cal Cole");
      await enrollStudent("ungraded-dee", "Dee Dunn");
      await enrollStudent("graded-abe", "Abe Ames");
      await addSubmission("graded-ben", "Ben Brown");
      await addSubmission("graded-abe", "Abe Ames");
      await addSubmission("resubmitted-cal", "Cal Cole", "2026-11-03T09:00:00.000Z");
      await addSubmission("ungraded-dee", "Dee Dunn");
      await addGrade("graded-ben", 70);
      await addGrade("graded-abe", 90);
      await addGrade("resubmitted-cal", 60, "", "2026-11-01T09:00:00.000Z");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect(
        (await res.json()).students.map((student: ListedStudent) => [
          student.studentId,
          student.gradingStatus,
        ])
      ).toEqual([
        ["resubmitted-cal", "resubmitted"],
        ["ungraded-dee", "needs-grading"],
        ["graded-abe", "graded"],
        ["graded-ben", "graded"],
        ["missing-amy", "missing"],
      ]);
    });

    it("lists the assignment's submissions by student name, with names and emails", async () => {
      await addSubmission("zoe", "Zoe Zhang", "2026-10-30T09:00:00.000Z");
      await addSubmission("ada", "Ada Lovelace", "2026-10-31T09:00:00.000Z");
      await assignmentDoc("assignment-2").set({ ...assignment, name: "Project 2" });
      await addSubmission("bob", "Bob Brown", undefined, "assignment-2");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).students).toEqual([
        {
          ...submissionResponse("ada", "2026-10-31T09:00:00.000Z"),
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
          gradingStatus: "needs-grading",
          missingGrade: null,
        },
        {
          ...submissionResponse("zoe", "2026-10-30T09:00:00.000Z"),
          studentName: "Zoe Zhang",
          studentEmail: "zoe@example.com",
          gradingStatus: "needs-grading",
          missingGrade: null,
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
      expect((await res.json()).students).toEqual([
        {
          ...submissionResponse("ada"),
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
          gradingStatus: "needs-grading",
          missingGrade: null,
        },
        {
          ...submissionResponse("zoe"),
          studentName: "Zoe Zhang",
          studentEmail: "zoe@example.com",
          gradingStatus: "needs-grading",
          missingGrade: null,
        },
        {
          ...submissionResponse("abe"),
          studentName: null,
          studentEmail: null,
          gradingStatus: "needs-grading",
          missingGrade: null,
        },
        {
          ...submissionResponse("ghost"),
          studentName: null,
          studentEmail: null,
          gradingStatus: "needs-grading",
          missingGrade: null,
        },
      ]);
    });

    it("includes each submission's grade from the grades collection", async () => {
      await addSubmission("ada", "Ada Lovelace");
      await addSubmission("zoe", "Zoe Zhang");
      const grade = await addGrade("ada", 87.5, "Strong work");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const { students } = await res.json();
      expect(rowFor(students, "ada")).toMatchObject({
        grade: 87.5,
        feedback: "Strong work",
        gradedAt: grade.gradedAt,
        gradeUpdatedAt: null,
        gradingStatus: "graded",
      });
      expect(rowFor(students, "zoe")).toMatchObject({
        gradingStatus: "needs-grading",
        grade: null,
        feedback: "",
        gradedAt: null,
        gradeUpdatedAt: null,
      });
    });

    it("includes when each edited grade was last updated", async () => {
      await addSubmission("ada", "Ada Lovelace");
      await addSubmission("zoe", "Zoe Zhang");
      const edited = await addGrade("ada", 92, "Regraded", undefined, {
        updatedAt: "2026-11-04T09:00:00.000Z",
        updatedBy: "owner",
      });
      await addGrade("zoe", 80);

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const { students } = await res.json();
      expect(rowFor(students, "ada")).toMatchObject({
        grade: 92,
        feedback: "Regraded",
        gradedAt: edited.gradedAt,
        gradeUpdatedAt: edited.updatedAt,
      });
      expect(rowFor(students, "zoe")).toMatchObject({
        grade: 80,
        gradeUpdatedAt: null,
      });
    });

    it("flags a submission whose file is not the version that was graded", async () => {
      await addSubmission("ada", "Ada Lovelace", "2026-11-03T09:00:00.000Z");
      await addSubmission("zoe", "Zoe Zhang", "2026-11-01T09:00:00.000Z");
      await addGrade("ada", 90, "", "2026-11-01T08:00:00.000Z");
      await addGrade("zoe", 80, "", "2026-11-01T09:00:00.000Z");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const { students } = await res.json();
      expect(rowFor(students, "ada")).toMatchObject({
        grade: 90,
        resubmittedAfterGrading: true,
        gradingStatus: "resubmitted",
      });
      expect(rowFor(students, "zoe")).toMatchObject({
        grade: 80,
        resubmittedAfterGrading: false,
        gradingStatus: "graded",
      });
    });

    it("includes a missing-work grade on the row of a student without a submission", async () => {
      await enrollStudent("ada", "Ada Lovelace");
      const grade = await addMissingGrade("ada", 0, "Nothing turned in", {
        updatedAt: "2026-11-03T08:00:00.000Z",
        updatedBy: "owner",
      });

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).students).toEqual([
        {
          studentId: "ada",
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
          gradingStatus: "missing-graded",
          missingGrade: {
            score: 0,
            feedback: "Nothing turned in",
            gradedAt: grade.gradedAt,
            updatedAt: "2026-11-03T08:00:00.000Z",
          },
        },
      ]);
    });

    it("orders missing work with a grade after missing work without one", async () => {
      await enrollStudent("abe", "Abe Ames");
      await enrollStudent("zoe", "Zoe Zhang");
      await enrollStudent("ben", "Ben Brown");
      await addSubmission("ben", "Ben Brown");
      await addMissingGrade("abe", 0);

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect(
        (await res.json()).students.map((student: ListedStudent) => [
          student.studentId,
          student.gradingStatus,
        ])
      ).toEqual([
        ["ben", "needs-grading"],
        ["zoe", "missing"],
        ["abe", "missing-graded"],
      ]);
    });

    it("flags a submission that arrived after a missing-work grade and keeps that grade on the row", async () => {
      await enrollStudent("ada", "Ada Lovelace");
      const missing = await addMissingGrade("ada", 0, "Missing");
      await addSubmission("ada", "Ada Lovelace");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).students).toEqual([
        {
          ...submissionResponse("ada"),
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
          gradingStatus: "submitted-after-missing",
          submittedAfterMissingGrade: true,
          missingGrade: {
            score: 0,
            feedback: "Missing",
            gradedAt: missing.gradedAt,
            updatedAt: null,
          },
        },
      ]);
    });

    it("lists a student with a missing-work grade who is no longer enrolled", async () => {
      await enrollStudent("ada", "Ada Lovelace");
      await enrollStudent("zoe", "Zoe Zhang", "class-2");
      await addMissingGrade("zoe", 0);

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const { students } = await res.json();
      expect(rowFor(students, "zoe")?.gradingStatus).toBe("missing-graded");
      expect(rowFor(students, "ada")?.gradingStatus).toBe("missing");
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
      expect((await res.json()).students[0].fileUrl).toBeNull();
    });
  });

  describe("as an enrolled student", () => {
    it("returns a null submission when the student has not submitted", async () => {
      const { idToken } = await createEnrolledStudent();

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        role: "student",
        submission: null,
        missingGrade: null,
      });
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
        missingGrade: null,
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

    it("returns the student's edited grade and when it was updated", async () => {
      const { uid, idToken } = await createEnrolledStudent();
      await addSubmission(uid, null);
      const grade = await addGrade(uid, 95, "Regraded part 2", undefined, {
        updatedAt: "2026-11-04T09:00:00.000Z",
        updatedBy: "owner",
      });

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect((await res.json()).submission).toEqual({
        ...submissionResponse(uid),
        grade: 95,
        feedback: "Regraded part 2",
        gradedAt: grade.gradedAt,
        gradeUpdatedAt: "2026-11-04T09:00:00.000Z",
        resubmittedAfterGrading: false,
      });
    });

    it("returns the student's own missing-work grade when they have not submitted", async () => {
      const { uid, idToken } = await createEnrolledStudent();
      const grade = await addMissingGrade(uid, 0, "Nothing turned in");
      await addMissingGrade("zoe", 0, "Someone else's");

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        role: "student",
        submission: null,
        missingGrade: {
          score: 0,
          feedback: "Nothing turned in",
          gradedAt: grade.gradedAt,
          updatedAt: null,
        },
      });
    });

    it("returns no missing-work grade when only another student has one", async () => {
      const { idToken } = await createEnrolledStudent();
      await addMissingGrade("zoe", 0, "Someone else's");

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect((await res.json()).missingGrade).toBeNull();
    });

    it("flags a submission the student made after a missing-work grade", async () => {
      const { uid, idToken } = await createEnrolledStudent();
      await addMissingGrade(uid, 0, "Missing");
      await addSubmission(uid, null);

      const res = await getSubmissions(idToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        role: "student",
        submission: { ...submissionResponse(uid), submittedAfterMissingGrade: true },
        missingGrade: {
          score: 0,
          feedback: "Missing",
          gradedAt: expect.any(String),
          updatedAt: null,
        },
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
