import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  PATCH,
  POST,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId]/route";
import { POST as postGrade } from "@/app/api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade/route";
import {
  GET as getSubmissions,
  POST as postSubmission,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/submit/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const storage = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ storage: { from: storage.from } }),
}));

const classId = "class-1";
const assignmentId = "assignment-1";
const gradedAt = "2026-11-01T10:00:00.000Z";

type Ids = { classId: string; assignmentId: string; studentId: string };

function assignmentDoc() {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
}

function missingGradeDoc(id: string) {
  return assignmentDoc().collection("missingGrades").doc(id);
}

function submissionDoc(id: string) {
  return assignmentDoc().collection("submissions").doc(id);
}

function gradeDoc(id: string) {
  return assignmentDoc().collection("grades").doc(id);
}

function sendMissingGrade(
  method: "POST" | "PATCH",
  body: unknown,
  idToken: string | undefined,
  ids: Ids
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const handler = method === "POST" ? POST : PATCH;

  return handler(
    new NextRequest(
      `http://localhost/api/classes/${ids.classId}/assignments/${ids.assignmentId}/missing-grades/${ids.studentId}`,
      {
        method,
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve(ids) }
  );
}

/** Sends the student's first or later file through the real submit route. */
function submitFile(idToken: string, name = "late.pdf") {
  const body = new FormData();
  body.append("file", new File([new Uint8Array(2048)], name, { type: "application/pdf" }));

  return postSubmission(
    new NextRequest(
      `http://localhost/api/classes/${classId}/assignments/${assignmentId}/submit`,
      { method: "POST", headers: { authorization: `Bearer ${idToken}` }, body }
    ),
    { params: Promise.resolve({ classId, assignmentId }) }
  );
}

function getRosterOrOwn(idToken: string) {
  return getSubmissions(
    new NextRequest(
      `http://localhost/api/classes/${classId}/assignments/${assignmentId}/submit`,
      { headers: { authorization: `Bearer ${idToken}` } }
    ),
    { params: Promise.resolve({ classId, assignmentId }) }
  );
}

let ownerUid: string;
let ownerToken: string;
let studentUid: string;
let studentToken: string;
let ids: Ids;

function postMissing(body: unknown, idToken?: string, to = ids) {
  return sendMissingGrade("POST", body, idToken, to);
}

function patchMissing(body: unknown, idToken?: string, to = ids) {
  return sendMissingGrade("PATCH", body, idToken, to);
}

/** Stores a missing-work grade for the enrolled student, as graded by another professor. */
async function storeMissingGrade(overrides: Record<string, unknown> = {}) {
  const grade = {
    studentId: studentUid,
    classId,
    assignmentId,
    score: 10,
    feedback: "Nothing turned in",
    gradedBy: "original-grader",
    gradedAt,
    ...overrides,
  };
  await missingGradeDoc(studentUid).set(grade);

  return grade;
}

beforeEach(async () => {
  await clearEmulators();

  vi.restoreAllMocks();
  storage.from.mockReset().mockReturnValue(storage);
  storage.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  storage.remove.mockReset().mockResolvedValue({ data: [], error: null });
  storage.createSignedUrl.mockReset().mockImplementation(async (path: string) => ({
    data: { signedUrl: `https://files.example.com/${path}` },
    error: null,
  }));

  ({ uid: ownerUid, idToken: ownerToken } = await createSignedInUser(
    "owner@example.com",
    "professor"
  ));
  ({ uid: studentUid, idToken: studentToken } = await createSignedInUser(
    "ada@example.com",
    "student"
  ));
  ids = { classId, assignmentId, studentId: studentUid };

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: ownerUid });
  await assignmentDoc().set({ name: "Project 1", points: 100, dueDate: "2099-11-01" });
  await getAdminDb()
    .collection("users")
    .doc(studentUid)
    .collection("classes")
    .doc(classId)
    .set({ class_id: classId });
});

describe("POST /api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId]", () => {
  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const res = await postMissing({ score: 0 });

      expect(res.status).toBe(401);
      expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
    });
  });

  describe("authorization", () => {
    it("returns 403 for a professor who does not teach the class", async () => {
      const { idToken } = await createSignedInUser("other@example.com", "professor");

      const res = await postMissing({ score: 0 }, idToken);

      expect(res.status).toBe(403);
      expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
    });

    it("returns 403 for an enrolled student, even for their own missing work", async () => {
      const res = await postMissing({ score: 100 }, studentToken);

      expect(res.status).toBe(403);
      expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
    });

    it("lets an admin grade missing work", async () => {
      const { uid, idToken } = await createSignedInUser("admin@example.com", "admin");

      const res = await postMissing({ score: 15, feedback: "Late policy" }, idToken);

      expect(res.status).toBe(201);
      expect((await missingGradeDoc(studentUid).get()).data()).toMatchObject({
        score: 15,
        feedback: "Late policy",
        gradedBy: uid,
      });
    });
  });

  describe("as the class's professor", () => {
    it("returns 404 for a class that does not exist", async () => {
      const res = await postMissing({ score: 0 }, ownerToken, { ...ids, classId: "missing" });

      expect(res.status).toBe(404);
    });

    it("returns 404 for an assignment that does not exist", async () => {
      const res = await postMissing({ score: 0 }, ownerToken, {
        ...ids,
        assignmentId: "missing",
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 and saves nothing for a student who is not enrolled", async () => {
      const res = await postMissing({ score: 0 }, ownerToken, { ...ids, studentId: "zoe" });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/not enrolled/) });
      expect((await missingGradeDoc("zoe").get()).exists).toBe(false);
    });

    it("returns 404 for a student enrolled only in another class", async () => {
      const { uid } = await createSignedInUser("bob@example.com", "student");
      await getAdminDb()
        .collection("users")
        .doc(uid)
        .collection("classes")
        .doc("class-2")
        .set({ class_id: "class-2" });

      const res = await postMissing({ score: 0 }, ownerToken, { ...ids, studentId: uid });

      expect(res.status).toBe(404);
      expect((await missingGradeDoc(uid).get()).exists).toBe(false);
    });

    it.each([
      { label: "a missing score", body: { feedback: "Nothing" } },
      { label: "a negative score", body: { score: -1 } },
      { label: "a score above the assignment's points", body: { score: 101 } },
      { label: "a score that is not a number", body: { score: "0" } },
      { label: "feedback over 5000 characters", body: { score: 0, feedback: "x".repeat(5001) } },
    ])("returns 400 for $label", async ({ body }) => {
      const res = await postMissing(body, ownerToken);

      expect(res.status).toBe(400);
      expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
    });

    it("returns 400 for a body that is not JSON", async () => {
      const res = await postMissing("{not json", ownerToken);

      expect(res.status).toBe(400);
      expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
    });

    it("saves the score, trimmed feedback and who graded it against the student, assignment and course", async () => {
      const before = Date.now();

      const res = await postMissing({ score: 12.5, feedback: "  Never turned in  " }, ownerToken);

      expect(res.status).toBe(201);
      const saved = (await missingGradeDoc(studentUid).get()).data();
      expect(saved).toEqual({
        studentId: studentUid,
        classId,
        assignmentId,
        score: 12.5,
        feedback: "Never turned in",
        gradedBy: ownerUid,
        gradedAt: expect.any(String),
      });
      expect(Date.parse(saved?.gradedAt)).toBeGreaterThanOrEqual(before);
      expect((await res.json()).grade).toEqual(saved);
    });

    it("creates no submission, no grade and no file", async () => {
      const res = await postMissing({ score: 0 }, ownerToken);

      expect(res.status).toBe(201);
      expect((await submissionDoc(studentUid).get()).exists).toBe(false);
      expect((await gradeDoc(studentUid).get()).exists).toBe(false);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it.each([0, 100])("accepts a score of %d with no feedback", async (score) => {
      const res = await postMissing({ score }, ownerToken);

      expect(res.status).toBe(201);
      expect((await missingGradeDoc(studentUid).get()).data()).toMatchObject({
        score,
        feedback: "",
      });
    });

    it("returns 409 and saves nothing for a student who has submitted", async () => {
      await submissionDoc(studentUid).set({
        studentId: studentUid,
        filePath: "x/1-work.pdf",
        fileName: "work.pdf",
        submittedAt: "2026-10-31T09:00:00.000Z",
        status: "submitted",
      });

      const res = await postMissing({ score: 0 }, ownerToken);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/Grade their submission/) });
      expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
    });

    it("returns 409 with the stored grade for missing work that is already graded", async () => {
      await postMissing({ score: 10, feedback: "First" }, ownerToken);

      const res = await postMissing({ score: 50, feedback: "Second" }, ownerToken);

      expect(res.status).toBe(409);
      const stored = (await missingGradeDoc(studentUid).get()).data();
      expect(stored).toMatchObject({ score: 10, feedback: "First" });
      expect(await res.json()).toEqual({
        error: expect.stringMatching(/already been graded/),
        grade: stored,
      });
    });
  });
});

describe("PATCH /api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId]", () => {
  const lastSavedAt = gradedAt;

  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const stored = await storeMissingGrade();

      const res = await patchMissing({ lastSavedAt, score: 90 });

      expect(res.status).toBe(401);
      expect((await missingGradeDoc(studentUid).get()).data()).toEqual(stored);
    });
  });

  describe("authorization", () => {
    it.each(["professor", "student"])(
      "returns 403 for a %s who is not the class's professor",
      async (role) => {
        const stored = await storeMissingGrade();
        const { idToken } = await createSignedInUser(`${role}-2@example.com`, role);

        const res = await patchMissing({ lastSavedAt, score: 90 }, idToken);

        expect(res.status).toBe(403);
        expect((await missingGradeDoc(studentUid).get()).data()).toEqual(stored);
      }
    );

    it("lets an admin edit a missing-work grade", async () => {
      await storeMissingGrade();
      const { uid, idToken } = await createSignedInUser("admin@example.com", "admin");

      const res = await patchMissing({ lastSavedAt, score: 20 }, idToken);

      expect(res.status).toBe(200);
      expect((await missingGradeDoc(studentUid).get()).data()).toMatchObject({
        score: 20,
        updatedBy: uid,
        gradedBy: "original-grader",
      });
    });
  });

  describe("as the class's professor", () => {
    it("returns 404 and creates nothing when the missing work has not been graded", async () => {
      const res = await patchMissing({ lastSavedAt, score: 90 }, ownerToken);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/not been graded/) });
      expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
    });

    it.each([
      { label: "a missing score", body: { lastSavedAt, feedback: "Nice" } },
      { label: "a score above the assignment's points", body: { lastSavedAt, score: 101 } },
      {
        label: "feedback over 5000 characters",
        body: { lastSavedAt, score: 90, feedback: "x".repeat(5001) },
      },
      { label: "a missing lastSavedAt", body: { score: 90 } },
      { label: "an empty lastSavedAt", body: { lastSavedAt: "", score: 90 } },
    ])("returns 400 for $label", async ({ body }) => {
      const stored = await storeMissingGrade();

      const res = await patchMissing(body, ownerToken);

      expect(res.status).toBe(400);
      expect((await missingGradeDoc(studentUid).get()).data()).toEqual(stored);
    });

    it("updates the score and trimmed feedback, records the edit, and keeps the original grading", async () => {
      const stored = await storeMissingGrade();
      const before = Date.now();

      const res = await patchMissing(
        { lastSavedAt, score: 30, feedback: "  Partial credit for the draft  " },
        ownerToken
      );

      expect(res.status).toBe(200);
      const saved = (await missingGradeDoc(studentUid).get()).data();
      expect(saved).toEqual({
        ...stored,
        score: 30,
        feedback: "Partial credit for the draft",
        updatedAt: expect.any(String),
        updatedBy: ownerUid,
      });
      expect(Date.parse(saved?.updatedAt)).toBeGreaterThanOrEqual(before);
      expect((await res.json()).grade).toEqual(saved);
    });

    it("edits an already edited grade using its updatedAt", async () => {
      await storeMissingGrade();
      const first = await patchMissing({ lastSavedAt, score: 20 }, ownerToken);
      const { grade: firstGrade } = await first.json();

      const res = await patchMissing(
        { lastSavedAt: firstGrade.updatedAt, score: 25, feedback: "Second pass" },
        ownerToken
      );

      expect(res.status).toBe(200);
      expect((await missingGradeDoc(studentUid).get()).data()).toMatchObject({
        score: 25,
        feedback: "Second pass",
        gradedAt,
        gradedBy: "original-grader",
      });
    });

    it("returns 409 with the stored grade and changes nothing when the grade was saved since it was opened", async () => {
      const stored = await storeMissingGrade({
        score: 5,
        updatedAt: "2026-11-02T10:00:00.000Z",
        updatedBy: ownerUid,
      });

      const res = await patchMissing({ lastSavedAt: gradedAt, score: 95 }, ownerToken);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: expect.any(String), grade: stored });
      expect((await missingGradeDoc(studentUid).get()).data()).toEqual(stored);
    });
  });
});

describe("missing-work grades alongside submissions and their grades", () => {
  it("leaves the submission grading endpoint returning 404 for a student with only a missing-work grade", async () => {
    await storeMissingGrade();

    const res = await postGrade(
      new NextRequest(
        `http://localhost/api/classes/${classId}/assignments/${assignmentId}/submissions/${studentUid}/grade`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ score: 0, submittedAt: gradedAt }),
        }
      ),
      { params: Promise.resolve(ids) }
    );

    expect(res.status).toBe(404);
    expect((await gradeDoc(studentUid).get()).exists).toBe(false);
    expect((await submissionDoc(studentUid).get()).exists).toBe(false);
  });

  it("keeps the missing-work grade when the student submits later, and flags the submission", async () => {
    const created = await postMissing({ score: 0, feedback: "Missing" }, ownerToken);
    const stored = (await created.json()).grade;

    const submitted = await submitFile(studentToken);

    expect(submitted.status).toBe(201);
    expect((await missingGradeDoc(studentUid).get()).data()).toEqual(stored);

    const roster = await getRosterOrOwn(ownerToken);
    const [row] = (await roster.json()).students;
    expect(row).toMatchObject({
      studentId: studentUid,
      gradingStatus: "submitted-after-missing",
      fileName: "late.pdf",
      grade: null,
      submittedAfterMissingGrade: true,
      missingGrade: {
        score: 0,
        feedback: "Missing",
        gradedAt: stored.gradedAt,
        updatedAt: null,
      },
    });

    const own = await getRosterOrOwn(studentToken);
    expect(await own.json()).toMatchObject({
      role: "student",
      submission: { fileName: "late.pdf", submittedAfterMissingGrade: true, grade: null },
      missingGrade: { score: 0, feedback: "Missing" },
    });
  });

  it("grades the later submission as a separate grade and keeps both records", async () => {
    const created = await postMissing({ score: 0, feedback: "Missing" }, ownerToken);
    const missingGrade = (await created.json()).grade;
    await submitFile(studentToken);
    const { submittedAt } = (await submissionDoc(studentUid).get()).data()!;

    const graded = await postGrade(
      new NextRequest(
        `http://localhost/api/classes/${classId}/assignments/${assignmentId}/submissions/${studentUid}/grade`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({ score: 70, feedback: "Late but solid", submittedAt }),
        }
      ),
      { params: Promise.resolve(ids) }
    );

    expect(graded.status).toBe(201);
    expect((await gradeDoc(studentUid).get()).data()).toMatchObject({
      score: 70,
      submittedAt,
    });
    expect((await missingGradeDoc(studentUid).get()).data()).toEqual(missingGrade);

    const roster = await getRosterOrOwn(ownerToken);
    const [row] = (await roster.json()).students;
    expect(row).toMatchObject({
      gradingStatus: "graded",
      grade: 70,
      submittedAfterMissingGrade: true,
      missingGrade: { score: 0 },
    });
  });

  it("refuses a missing-work grade once the student has submitted through the submit route", async () => {
    await submitFile(studentToken, "on-time.pdf");

    const res = await postMissing({ score: 0 }, ownerToken);

    expect(res.status).toBe(409);
    expect((await missingGradeDoc(studentUid).get()).exists).toBe(false);
  });
});
