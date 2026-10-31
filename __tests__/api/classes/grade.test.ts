import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PATCH, POST } from "@/app/api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const assignmentId = "assignment-1";
const studentId = "ada";
const submittedAt = "2026-10-31T09:00:00.000Z";

function assignmentDoc() {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
}

function gradeDoc(id = studentId) {
  return assignmentDoc().collection("grades").doc(id);
}

function sendGrade(
  method: "POST" | "PATCH",
  body: unknown,
  idToken?: string,
  ids = { classId, assignmentId, studentId }
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const handler = method === "POST" ? POST : PATCH;

  return handler(
    new NextRequest(
      `http://localhost/api/classes/${ids.classId}/assignments/${ids.assignmentId}/submissions/${ids.studentId}/grade`,
      {
        method,
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve(ids) }
  );
}

function postGrade(
  body: unknown,
  idToken?: string,
  ids = { classId, assignmentId, studentId }
) {
  return sendGrade("POST", body, idToken, ids);
}

function patchGrade(
  body: unknown,
  idToken?: string,
  ids = { classId, assignmentId, studentId }
) {
  return sendGrade("PATCH", body, idToken, ids);
}

let ownerUid: string;
let ownerToken: string;

beforeEach(async () => {
  await clearEmulators();

  ({ uid: ownerUid, idToken: ownerToken } = await createSignedInUser(
    "owner@example.com",
    "professor"
  ));

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: ownerUid });
  await assignmentDoc().set({ name: "Project 1", points: 100, dueDate: null });
  await assignmentDoc()
    .collection("submissions")
    .doc(studentId)
    .set({
      studentId,
      filePath: `${classId}/${assignmentId}/${studentId}/1-essay.pdf`,
      fileName: "essay.pdf",
      fileType: "application/pdf",
      fileSize: 2048,
      submittedAt,
      status: "submitted",
    });
});

describe("POST /api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade", () => {
  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const res = await postGrade({ submittedAt, score: 90 });

      expect(res.status).toBe(401);
      expect((await gradeDoc().get()).exists).toBe(false);
    });
  });

  describe("authorization", () => {
    it.each(["professor", "student", "admin"])(
      "returns 403 for a %s who is not the class's professor",
      async (role) => {
        const { idToken } = await createSignedInUser(`${role}@example.com`, role);

        const res = await postGrade({ submittedAt, score: 90 }, idToken);

        expect(res.status).toBe(403);
        expect((await gradeDoc().get()).exists).toBe(false);
      }
    );
  });

  describe("as the class's professor", () => {
    it("returns 404 for a class that does not exist", async () => {
      const res = await postGrade({ submittedAt, score: 90 }, ownerToken, {
        classId: "missing",
        assignmentId,
        studentId,
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 for an assignment that does not exist", async () => {
      const res = await postGrade({ submittedAt, score: 90 }, ownerToken, {
        classId,
        assignmentId: "missing",
        studentId,
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 for a student who has not submitted", async () => {
      const res = await postGrade({ submittedAt, score: 90 }, ownerToken, {
        classId,
        assignmentId,
        studentId: "zoe",
      });

      expect(res.status).toBe(404);
      expect((await gradeDoc("zoe").get()).exists).toBe(false);
    });

    it.each([
      { label: "a missing score", body: { submittedAt, feedback: "Nice" } },
      { label: "a negative score", body: { submittedAt, score: -1 } },
      { label: "a score above the assignment's points", body: { submittedAt, score: 101 } },
      { label: "a score that is not a number", body: { submittedAt, score: "90" } },
      {
        label: "feedback over 5000 characters",
        body: { submittedAt, score: 90, feedback: "x".repeat(5001) },
      },
      { label: "a missing submittedAt", body: { score: 90 } },
      { label: "an empty submittedAt", body: { submittedAt: "", score: 90 } },
    ])("returns 400 for $label", async ({ body }) => {
      const res = await postGrade(body, ownerToken);

      expect(res.status).toBe(400);
      expect((await gradeDoc().get()).exists).toBe(false);
    });

    it("returns 400 for a body that is not JSON", async () => {
      const res = await postGrade("{not json", ownerToken);

      expect(res.status).toBe(400);
      expect((await gradeDoc().get()).exists).toBe(false);
    });

    it("saves the score, trimmed feedback, the graded version, and who graded it", async () => {
      const res = await postGrade({ submittedAt, score: 87.5, feedback: "  Strong work  " }, ownerToken);

      expect(res.status).toBe(201);
      const saved = (await gradeDoc().get()).data();
      expect(saved).toEqual({
        studentId,
        classId,
        assignmentId,
        score: 87.5,
        feedback: "Strong work",
        submittedAt,
        gradedBy: ownerUid,
        gradedAt: expect.any(String),
      });
      expect((await res.json()).grade).toEqual(saved);
    });

    it.each([0, 100])("accepts a score of %d with no feedback", async (score) => {
      const res = await postGrade({ submittedAt, score }, ownerToken);

      expect(res.status).toBe(201);
      expect((await gradeDoc().get()).data()).toMatchObject({ score, feedback: "" });
    });

    it("returns 409 with the stored grade for a submission that is already graded", async () => {
      await postGrade({ submittedAt, score: 90, feedback: "First" }, ownerToken);

      const res = await postGrade({ submittedAt, score: 50, feedback: "Second" }, ownerToken);

      expect(res.status).toBe(409);
      const stored = (await gradeDoc().get()).data();
      expect(stored).toMatchObject({ score: 90, feedback: "First" });
      expect(await res.json()).toEqual({
        error: expect.stringMatching(/already been graded/),
        grade: stored,
      });
    });

    it("returns 409 and saves nothing when the student resubmitted after the professor opened it", async () => {
      await assignmentDoc()
        .collection("submissions")
        .doc(studentId)
        .update({ submittedAt: "2026-11-01T09:00:00.000Z", fileName: "essay-v2.pdf" });

      const res = await postGrade({ submittedAt, score: 90 }, ownerToken);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/resubmitted/) });
      expect((await gradeDoc().get()).exists).toBe(false);
    });
  });
});

describe("PATCH /api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade", () => {
  const gradedAt = "2026-11-01T10:00:00.000Z";
  const lastSavedAt = gradedAt;

  /** Stores a grade for the submission, as graded by another professor. */
  async function storeGrade(overrides: Record<string, unknown> = {}) {
    const grade = {
      studentId,
      classId,
      assignmentId,
      score: 70,
      feedback: "First pass",
      submittedAt,
      gradedBy: "original-grader",
      gradedAt,
      ...overrides,
    };
    await gradeDoc().set(grade);

    return grade;
  }

  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const stored = await storeGrade();

      const res = await patchGrade({ submittedAt, lastSavedAt, score: 90 });

      expect(res.status).toBe(401);
      expect((await gradeDoc().get()).data()).toEqual(stored);
    });
  });

  describe("authorization", () => {
    it.each(["professor", "student", "admin"])(
      "returns 403 for a %s who is not the class's professor",
      async (role) => {
        const stored = await storeGrade();
        const { idToken } = await createSignedInUser(`${role}@example.com`, role);

        const res = await patchGrade({ submittedAt, lastSavedAt, score: 90 }, idToken);

        expect(res.status).toBe(403);
        expect((await gradeDoc().get()).data()).toEqual(stored);
      }
    );
  });

  describe("as the class's professor", () => {
    it("returns 404 for a class that does not exist", async () => {
      const res = await patchGrade({ submittedAt, lastSavedAt, score: 90 }, ownerToken, {
        classId: "missing",
        assignmentId,
        studentId,
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 for an assignment that does not exist", async () => {
      const res = await patchGrade({ submittedAt, lastSavedAt, score: 90 }, ownerToken, {
        classId,
        assignmentId: "missing",
        studentId,
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 for a student who has not submitted", async () => {
      const res = await patchGrade({ submittedAt, lastSavedAt, score: 90 }, ownerToken, {
        classId,
        assignmentId,
        studentId: "zoe",
      });

      expect(res.status).toBe(404);
      expect((await gradeDoc("zoe").get()).exists).toBe(false);
    });

    it("returns 404 and creates nothing for a submission that has not been graded", async () => {
      const res = await patchGrade({ submittedAt, lastSavedAt, score: 90 }, ownerToken);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/not been graded/) });
      expect((await gradeDoc().get()).exists).toBe(false);
    });

    it.each([
      { label: "a missing score", body: { submittedAt, lastSavedAt, feedback: "Nice" } },
      { label: "a negative score", body: { submittedAt, lastSavedAt, score: -1 } },
      {
        label: "a score above the assignment's points",
        body: { submittedAt, lastSavedAt, score: 101 },
      },
      { label: "a score that is not a number", body: { submittedAt, lastSavedAt, score: "90" } },
      {
        label: "feedback over 5000 characters",
        body: { submittedAt, lastSavedAt, score: 90, feedback: "x".repeat(5001) },
      },
      { label: "a missing submittedAt", body: { lastSavedAt, score: 90 } },
      { label: "an empty submittedAt", body: { submittedAt: "", lastSavedAt, score: 90 } },
      { label: "a missing lastSavedAt", body: { submittedAt, score: 90 } },
      { label: "an empty lastSavedAt", body: { submittedAt, lastSavedAt: "", score: 90 } },
    ])("returns 400 for $label", async ({ body }) => {
      const stored = await storeGrade();

      const res = await patchGrade(body, ownerToken);

      expect(res.status).toBe(400);
      expect((await gradeDoc().get()).data()).toEqual(stored);
    });

    it("returns 400 for a body that is not JSON", async () => {
      const stored = await storeGrade();

      const res = await patchGrade("{not json", ownerToken);

      expect(res.status).toBe(400);
      expect((await gradeDoc().get()).data()).toEqual(stored);
    });

    it("updates the score and trimmed feedback, records the edit, and keeps the original grading", async () => {
      const stored = await storeGrade();
      const before = Date.now();

      const res = await patchGrade(
        { submittedAt, lastSavedAt, score: 95, feedback: "  Regraded part 2  " },
        ownerToken
      );

      expect(res.status).toBe(200);
      const saved = (await gradeDoc().get()).data();
      expect(saved).toEqual({
        ...stored,
        score: 95,
        feedback: "Regraded part 2",
        updatedAt: expect.any(String),
        updatedBy: ownerUid,
      });
      expect(Date.parse(saved?.updatedAt)).toBeGreaterThanOrEqual(before);
      expect((await res.json()).grade).toEqual(saved);
    });

    it("edits an already edited grade using its updatedAt", async () => {
      await storeGrade();
      const first = await patchGrade({ submittedAt, lastSavedAt, score: 80 }, ownerToken);
      const { grade: firstGrade } = await first.json();

      const res = await patchGrade(
        { submittedAt, lastSavedAt: firstGrade.updatedAt, score: 85, feedback: "Second pass" },
        ownerToken
      );

      expect(res.status).toBe(200);
      expect((await gradeDoc().get()).data()).toMatchObject({
        score: 85,
        feedback: "Second pass",
        gradedAt,
        gradedBy: "original-grader",
      });
    });

    it("returns 409 with the stored grade and changes nothing when the grade was saved since it was opened", async () => {
      const stored = await storeGrade({
        score: 60,
        updatedAt: "2026-11-02T10:00:00.000Z",
        updatedBy: ownerUid,
      });

      const res = await patchGrade({ submittedAt, lastSavedAt: gradedAt, score: 95 }, ownerToken);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: expect.any(String), grade: stored });
      expect((await gradeDoc().get()).data()).toEqual(stored);
    });

    it("returns 409 and changes nothing when the student resubmitted after the professor opened it", async () => {
      const stored = await storeGrade();
      await assignmentDoc()
        .collection("submissions")
        .doc(studentId)
        .update({ submittedAt: "2026-11-03T09:00:00.000Z", fileName: "essay-v2.pdf" });

      const res = await patchGrade({ submittedAt, lastSavedAt, score: 95 }, ownerToken);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/resubmitted/) });
      expect((await gradeDoc().get()).data()).toEqual(stored);
    });

    it("stores the resubmitted version when regrading a resubmission", async () => {
      await storeGrade();
      const resubmittedAt = "2026-11-03T09:00:00.000Z";
      await assignmentDoc()
        .collection("submissions")
        .doc(studentId)
        .update({ submittedAt: resubmittedAt, fileName: "essay-v2.pdf" });

      const res = await patchGrade(
        { submittedAt: resubmittedAt, lastSavedAt, score: 92 },
        ownerToken
      );

      expect(res.status).toBe(200);
      expect((await gradeDoc().get()).data()).toMatchObject({
        score: 92,
        submittedAt: resubmittedAt,
        gradedAt,
      });
    });
  });
});
