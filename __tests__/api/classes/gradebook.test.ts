import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/classes/[classId]/gradebook/route";
import { GET as listAssignments } from "@/app/api/classes/[classId]/assignments/route";
import {
  PATCH as patchGrade,
  POST as postGrade,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade/route";
import { POST as postMissingGrade } from "@/app/api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId]/route";
import type { WriteBatch } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import type { Gradebook, GradebookCell } from "@/lib/gradebook";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const otherClassId = "class-2";
const pastDueDate = "2020-01-15";
const futureDueDate = "2099-11-01";
const firstVersion = "2026-10-30T12:00:00.000Z";
const secondVersion = "2026-10-31T12:00:00.000Z";
const gradedAt = "2026-11-01T09:00:00.000Z";

// #region Helpers

function classDoc(id = classId) {
  return getAdminDb().collection("classes").doc(id);
}

function assignmentDoc(assignmentId: string, inClass = classId) {
  return classDoc(inClass).collection("assignments").doc(assignmentId);
}

/** Calls the gradebook route as the holder of `idToken`. */
function getGradebook(idToken?: string, forClass = classId) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return GET(
    new NextRequest(`http://localhost/api/classes/${forClass}/gradebook`, { headers }),
    { params: Promise.resolve({ classId: forClass }) }
  );
}

/** Returns the gradebook for the holder of `idToken`, expecting a 200. */
async function loadGradebook(idToken: string): Promise<Gradebook> {
  const res = await getGradebook(idToken);

  expect(res.status).toBe(200);
  return res.json();
}

/** Returns a student's cell for an assignment, or undefined when either is absent. */
function cellOf(gradebook: Gradebook, studentId: string, assignmentId: string) {
  const student = gradebook.students.find((row) => row.id === studentId);
  const index = gradebook.assignments.findIndex((assignment) => assignment.id === assignmentId);

  return student?.cells[index];
}

/** Stores a student's profile and enrolls them in a class. */
async function enrollStudent(uid: string, inClass = classId, profile = true) {
  const userRef = getAdminDb().collection("users").doc(uid);

  if (profile) {
    await userRef.set({ name: `Student ${uid}`, email: `${uid}@example.com`, role: "student" });
  }

  await userRef.collection("classes").doc(inClass).set({ class_id: inClass });
}

/** Stores an assignment. */
async function addAssignment(
  assignmentId: string,
  fields: { name?: string; points?: number; dueDate?: string | null; createdAt?: string } = {},
  inClass = classId
) {
  await assignmentDoc(assignmentId, inClass).set({
    name: fields.name ?? assignmentId,
    points: fields.points ?? 100,
    dueDate: fields.dueDate === undefined ? pastDueDate : fields.dueDate,
    createdAt: fields.createdAt ?? "2026-09-01T00:00:00.000Z",
  });
}

/** Stores a submission. */
async function addSubmission(
  assignmentId: string,
  studentId: string,
  submittedAt = firstVersion,
  inClass = classId
) {
  await assignmentDoc(assignmentId, inClass).collection("submissions").doc(studentId).set({
    studentId,
    filePath: `${inClass}/${assignmentId}/${studentId}/1-work.pdf`,
    fileName: "work.pdf",
    fileType: "application/pdf",
    fileSize: 1024,
    submittedAt,
    status: "submitted",
  });
}

/** Stores a grade for the version submitted at `submittedAt`. */
async function addGrade(
  assignmentId: string,
  studentId: string,
  score: number,
  feedback = "",
  submittedAt = firstVersion,
  inClass = classId
) {
  await assignmentDoc(assignmentId, inClass).collection("grades").doc(studentId).set({
    studentId,
    classId: inClass,
    assignmentId,
    score,
    feedback,
    submittedAt,
    gradedBy: "owner",
    gradedAt,
  });
}

/** Stores a missing-work grade: a grade of 0 with no submittedAt. */
async function addMissingGrade(assignmentId: string, studentId: string, feedback = "") {
  await assignmentDoc(assignmentId).collection("grades").doc(studentId).set({
    studentId,
    classId,
    assignmentId,
    score: 0,
    feedback,
    submittedAt: null,
    gradedBy: "owner",
    gradedAt,
  });
}

/** Sends a JSON request to a grading route handler. */
function send<Params>(
  handler: (request: NextRequest, context: { params: Promise<Params> }) => Promise<Response>,
  method: "POST" | "PATCH",
  url: string,
  params: Params,
  idToken: string,
  body: unknown
) {
  return handler(
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
}

// #endregion

let ownerUid: string;
let ownerToken: string;

beforeEach(async () => {
  await clearEmulators();

  ({ uid: ownerUid, idToken: ownerToken } = await createSignedInUser(
    "owner@example.com",
    "professor"
  ));

  await classDoc().set({
    name: "Software Engineering",
    courseCode: "CS 3450",
    term: "Fall",
    year: 2026,
    section: "001",
    professor_id: ownerUid,
  });
  await classDoc(otherClassId).set({ name: "Other course", professor_id: ownerUid });
});

describe("GET /api/classes/[classId]/gradebook access", () => {
  beforeEach(async () => {
    await addAssignment("project-1");
    await enrollStudent("ava");
  });

  it("returns 401 without a token", async () => {
    expect((await getGradebook()).status).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    expect((await getGradebook("not-a-token")).status).toBe(401);
  });

  it("returns 404 for a class that does not exist", async () => {
    expect((await getGradebook(ownerToken, "no-such-class")).status).toBe(404);
  });

  it("returns 403 to an enrolled student", async () => {
    const { uid, idToken } = await createSignedInUser("student@example.com", "student");
    await enrollStudent(uid, classId, false);

    const res = await getGradebook(idToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only this class's professor can view the gradebook.",
    });
  });

  it("returns 403 to a student who is not enrolled", async () => {
    const { idToken } = await createSignedInUser("student@example.com", "student");

    expect((await getGradebook(idToken)).status).toBe(403);
  });

  it("returns 403 to a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");

    const res = await getGradebook(idToken);

    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("students");
  });

  it("gives the class's professor the gradebook with grading allowed", async () => {
    const gradebook = await loadGradebook(ownerToken);

    expect(gradebook.canGradeSubmissions).toBe(true);
    expect(gradebook.class).toEqual({
      id: classId,
      name: "Software Engineering",
      courseCode: "CS 3450",
      term: "Fall",
      year: 2026,
      section: "001",
    });
    expect(gradebook.students.map((student) => student.id)).toEqual(["ava"]);
  });

  it("gives an admin the gradebook without grading submissions", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const gradebook = await loadGradebook(idToken);

    expect(gradebook.canGradeSubmissions).toBe(false);
    expect(gradebook.students).toHaveLength(1);
  });
});

describe("GET /api/classes/[classId]/gradebook cells", () => {
  it("shows every status on a closed assignment, telling a graded 0 from missing work", async () => {
    await addAssignment("closed", { points: 100, dueDate: pastDueDate });
    for (const uid of ["zero", "scored", "ungraded", "resubmitted", "absent", "marked", "late"]) {
      await enrollStudent(uid);
    }
    await addSubmission("closed", "zero");
    await addGrade("closed", "zero", 0);
    await addSubmission("closed", "scored");
    await addGrade("closed", "scored", 90, "Clear requirements.\nAdd criteria.");
    await addSubmission("closed", "ungraded");
    await addSubmission("closed", "resubmitted", secondVersion);
    await addGrade("closed", "resubmitted", 82, "Good start", firstVersion);
    await addMissingGrade("closed", "marked", "Nothing turned in");
    await addMissingGrade("closed", "late");
    await addSubmission("closed", "late", secondVersion);

    const gradebook = await loadGradebook(ownerToken);
    const cells = Object.fromEntries(
      gradebook.students.map((student) => [student.id, student.cells[0]])
    );

    expect(gradebook.assignments[0]).toMatchObject({ id: "closed", closed: true, points: 100 });
    expect(cells.zero).toEqual({
      status: "graded",
      score: 0,
      submittedAt: firstVersion,
      grade: {
        score: 0,
        feedback: "",
        gradedAt,
        updatedAt: null,
        submittedAt: firstVersion,
      },
      missingGrade: null,
    });
    expect(cells.scored).toMatchObject({
      status: "graded",
      score: 90,
      grade: { feedback: "Clear requirements.\nAdd criteria." },
    });
    expect(cells.ungraded).toMatchObject({ status: "needs-grading", score: null, grade: null });
    expect(cells.resubmitted).toMatchObject({
      status: "resubmitted",
      score: 82,
      submittedAt: secondVersion,
      grade: { submittedAt: firstVersion },
    });
    expect(cells.absent).toEqual({
      status: "missing",
      score: null,
      submittedAt: null,
      grade: null,
      missingGrade: null,
    });
    expect(cells.marked).toEqual({
      status: "missing-graded",
      score: 0,
      submittedAt: null,
      grade: null,
      missingGrade: { score: 0, feedback: "Nothing turned in", gradedAt, updatedAt: null },
    });
    expect(cells.late).toMatchObject({
      status: "submitted-after-missing",
      score: 0,
      submittedAt: secondVersion,
      grade: null,
      missingGrade: { score: 0 },
    });
  });

  it("shows a submission regraded over a missing-work grade as plain graded", async () => {
    await addAssignment("closed");
    await enrollStudent("late");
    await addMissingGrade("closed", "late", "Was missing");
    await addSubmission("closed", "late", secondVersion);

    const regraded = await send(
      patchGrade,
      "PATCH",
      `/api/classes/${classId}/assignments/closed/submissions/late/grade`,
      { classId, assignmentId: "closed", studentId: "late" },
      ownerToken,
      { score: 60, feedback: "Late but done", submittedAt: secondVersion, lastSavedAt: gradedAt }
    );
    expect(regraded.status).toBe(200);

    const cell = cellOf(await loadGradebook(ownerToken), "late", "closed");

    expect(cell).toMatchObject({
      status: "graded",
      score: 60,
      submittedAt: secondVersion,
      grade: { feedback: "Late but done", submittedAt: secondVersion },
      missingGrade: null,
    });
  });

  it("leaves open assignments and those without a due date unclosed", async () => {
    await addAssignment("open", { dueDate: futureDueDate });
    await addAssignment("undated", { dueDate: null });
    await enrollStudent("ava");

    const gradebook = await loadGradebook(ownerToken);

    expect(gradebook.assignments).toEqual([
      expect.objectContaining({ id: "open", closed: false, closesAt: expect.any(String) }),
      expect.objectContaining({ id: "undated", closed: false, closesAt: null, dueDate: null }),
    ]);
    expect(gradebook.students[0].cells.map((cell) => cell?.status)).toEqual([
      "missing",
      "missing",
    ]);
  });

  it("lists a student who left the class only where they have work", async () => {
    await addAssignment("first", { dueDate: "2020-01-01" });
    await addAssignment("second", { dueDate: "2020-01-02" });
    await enrollStudent("ava");
    await getAdminDb().collection("users").doc("gone").set({
      name: "Gone Student",
      email: "gone@example.com",
      role: "student",
    });
    await addSubmission("first", "gone");

    const gradebook = await loadGradebook(ownerToken);
    const gone = gradebook.students.find((student) => student.id === "gone");

    expect(gradebook.students.map((student) => student.id)).toEqual(["ava", "gone"]);
    expect(gone?.enrolled).toBe(false);
    expect(gone?.cells.map((cell) => cell?.status ?? null)).toEqual(["needs-grading", null]);
  });

  it("lists a student without a profile with no name or email", async () => {
    await addAssignment("first");
    await enrollStudent("ghost", classId, false);

    const gradebook = await loadGradebook(ownerToken);

    expect(gradebook.students).toEqual([
      expect.objectContaining({ id: "ghost", name: null, email: null, enrolled: true }),
    ]);
  });

  it("never shows another class's students, assignments or work", async () => {
    await addAssignment("mine");
    await addAssignment("theirs", {}, otherClassId);
    await enrollStudent("ava");
    await enrollStudent("other", otherClassId);
    await addSubmission("theirs", "other", firstVersion, otherClassId);
    await addGrade("theirs", "other", 50, "", firstVersion, otherClassId);

    const gradebook = await loadGradebook(ownerToken);

    expect(gradebook.assignments.map((assignment) => assignment.id)).toEqual(["mine"]);
    expect(gradebook.students.map((student) => student.id)).toEqual(["ava"]);
  });
});

describe("GET /api/classes/[classId]/gradebook empty courses", () => {
  it("returns no students and no assignments for an empty course", async () => {
    const gradebook = await loadGradebook(ownerToken);

    expect(gradebook.assignments).toEqual([]);
    expect(gradebook.students).toEqual([]);
  });

  it("lists students with no cells when there are no assignments", async () => {
    await enrollStudent("ava");

    const gradebook = await loadGradebook(ownerToken);

    expect(gradebook.assignments).toEqual([]);
    expect(gradebook.students).toEqual([
      expect.objectContaining({ id: "ava", enrolled: true, cells: [] }),
    ]);
  });

  it("lists assignments with zero counts when no one is enrolled", async () => {
    await addAssignment("first");

    const gradebook = await loadGradebook(ownerToken);

    expect(gradebook.students).toEqual([]);
    expect(gradebook.assignments[0].grading).toMatchObject({ students: 0, submitted: 0 });
  });
});

describe("GET /api/classes/[classId]/gradebook after grading", () => {
  it("shows a new grade, an edited grade and a missing-work grade on the next load", async () => {
    await addAssignment("closed");
    await enrollStudent("ava");
    await enrollStudent("ben");
    await addSubmission("closed", "ava");

    const gradeUrl = `/api/classes/${classId}/assignments/closed/submissions/ava/grade`;
    const gradeParams = { classId, assignmentId: "closed", studentId: "ava" };

    let gradebook = await loadGradebook(ownerToken);
    expect(cellOf(gradebook, "ava", "closed")?.status).toBe("needs-grading");
    expect(gradebook.assignments[0].grading.toGrade).toBe(1);

    const posted = await send(postGrade, "POST", gradeUrl, gradeParams, ownerToken, {
      score: 70,
      feedback: "First pass",
      submittedAt: firstVersion,
    });
    expect(posted.status).toBe(201);
    const { grade } = await posted.json();

    gradebook = await loadGradebook(ownerToken);
    expect(cellOf(gradebook, "ava", "closed")).toMatchObject({
      status: "graded",
      score: 70,
      grade: { feedback: "First pass" },
    });
    expect(gradebook.assignments[0].grading.toGrade).toBe(0);

    const patched = await send(patchGrade, "PATCH", gradeUrl, gradeParams, ownerToken, {
      score: 75,
      feedback: "Second look",
      submittedAt: firstVersion,
      lastSavedAt: grade.gradedAt,
    });
    expect(patched.status).toBe(200);

    gradebook = await loadGradebook(ownerToken);
    expect(cellOf(gradebook, "ava", "closed")).toMatchObject({
      score: 75,
      grade: { feedback: "Second look", updatedAt: expect.any(String) },
    });

    const missing = await send(
      postMissingGrade,
      "POST",
      `/api/classes/${classId}/assignments/closed/missing-grades/ben`,
      { classId, assignmentId: "closed", studentId: "ben" },
      ownerToken,
      { feedback: "Nothing turned in" }
    );
    expect(missing.status).toBe(201);

    gradebook = await loadGradebook(ownerToken);
    expect(cellOf(gradebook, "ben", "closed")).toMatchObject({
      status: "missing-graded",
      score: 0,
      missingGrade: { feedback: "Nothing turned in" },
    });
  });
});

describe("GET /api/classes/[classId]/gradebook consistency", () => {
  it("counts each assignment exactly like the assignments list", async () => {
    await addAssignment("closed", { dueDate: pastDueDate });
    await addAssignment("open", { dueDate: futureDueDate });
    for (const uid of ["ava", "ben", "cara", "dev", "eve"]) {
      await enrollStudent(uid);
    }
    await addSubmission("closed", "ava");
    await addGrade("closed", "ava", 90);
    await addSubmission("closed", "ben", secondVersion);
    await addGrade("closed", "ben", 80);
    await addSubmission("closed", "cara");
    await addMissingGrade("closed", "dev");
    await addMissingGrade("closed", "eve");
    await addSubmission("closed", "eve", secondVersion);
    await addSubmission("closed", "gone");
    await addMissingGrade("closed", "left");
    await addSubmission("open", "ava");

    const gradebook = await loadGradebook(ownerToken);
    const listed = await listAssignments(
      new NextRequest(`http://localhost/api/classes/${classId}/assignments`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
      { params: Promise.resolve({ classId }) }
    );
    const { assignments } = await listed.json();

    for (const assignment of gradebook.assignments) {
      const match = assignments.find((listedOne: { id: string }) => listedOne.id === assignment.id);

      expect(assignment.grading).toEqual(match.grading);
    }

    const closedCells = gradebook.students
      .map((student) => student.cells[0])
      .filter((cell): cell is GradebookCell => cell !== null);
    expect(closedCells).toHaveLength(assignments.find((one: { id: string }) => one.id === "closed").grading.students);
  });
});

describe("GET /api/classes/[classId]/gradebook performance", () => {
  it(
    "answers in under 2 seconds for 40 students and 12 assignments",
    async () => {
      const db = getAdminDb();
      const studentIds = Array.from({ length: 40 }, (_, index) => `student-${index}`);
      const assignmentIds = Array.from({ length: 12 }, (_, index) => `assignment-${index}`);
      const writes: ((batch: WriteBatch) => void)[] = [];

      for (const studentId of studentIds) {
        const userRef = db.collection("users").doc(studentId);
        writes.push((batch) =>
          batch.set(userRef, { name: studentId, email: `${studentId}@example.com`, role: "student" })
        );
        writes.push((batch) =>
          batch.set(userRef.collection("classes").doc(classId), { class_id: classId })
        );
      }

      for (const [assignmentIndex, assignmentId] of assignmentIds.entries()) {
        const ref = assignmentDoc(assignmentId);
        writes.push((batch) =>
          batch.set(ref, {
            name: `Assignment ${assignmentIndex}`,
            points: 100,
            dueDate: assignmentIndex < 8 ? pastDueDate : futureDueDate,
            createdAt: `2026-09-${String(assignmentIndex + 1).padStart(2, "0")}T00:00:00.000Z`,
          })
        );

        for (const [studentIndex, studentId] of studentIds.entries()) {
          if (studentIndex % 10 === 9) {
            writes.push((batch) =>
              batch.set(ref.collection("grades").doc(studentId), {
                studentId,
                score: 0,
                feedback: "Missing",
                submittedAt: null,
                gradedAt,
              })
            );
            continue;
          }

          writes.push((batch) =>
            batch.set(ref.collection("submissions").doc(studentId), {
              studentId,
              submittedAt: firstVersion,
              status: "submitted",
            })
          );

          if (studentIndex % 3 !== 0) {
            writes.push((batch) =>
              batch.set(ref.collection("grades").doc(studentId), {
                studentId,
                score: studentIndex,
                feedback: `Feedback for ${studentId} on ${assignmentId}`,
                submittedAt: firstVersion,
                gradedAt,
              })
            );
          }
        }
      }

      for (let start = 0; start < writes.length; start += 400) {
        const batch = db.batch();
        for (const write of writes.slice(start, start + 400)) write(batch);
        await batch.commit();
      }

      await loadGradebook(ownerToken);

      const timings: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        const gradebook = await loadGradebook(ownerToken);
        timings.push(performance.now() - started);

        expect(gradebook.students).toHaveLength(40);
        expect(gradebook.assignments).toHaveLength(12);
      }

      const median = timings.sort((first, second) => first - second)[1];
      console.log(`Gradebook median for 40 students x 12 assignments: ${median.toFixed(0)} ms`);

      expect(median).toBeLessThan(2000);
    },
    60_000
  );
});
