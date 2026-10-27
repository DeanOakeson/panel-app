import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade/route";
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

function postGrade(
  body: unknown,
  idToken?: string,
  ids = { classId, assignmentId, studentId }
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return POST(
    new NextRequest(
      `http://localhost/api/classes/${ids.classId}/assignments/${ids.assignmentId}/submissions/${ids.studentId}/grade`,
      {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve(ids) }
  );
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

    it("returns 409 for a submission that is already graded", async () => {
      await postGrade({ submittedAt, score: 90, feedback: "First" }, ownerToken);

      const res = await postGrade({ submittedAt, score: 50, feedback: "Second" }, ownerToken);

      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/already been graded/);
      expect((await gradeDoc().get()).data()).toMatchObject({
        score: 90,
        feedback: "First",
      });
    });

    it("returns 409 and saves nothing when the student resubmitted after the professor opened it", async () => {
      await assignmentDoc()
        .collection("submissions")
        .doc(studentId)
        .update({ submittedAt: "2026-11-01T09:00:00.000Z", fileName: "essay-v2.pdf" });

      const res = await postGrade({ submittedAt, score: 90 }, ownerToken);

      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/resubmitted/);
      expect((await gradeDoc().get()).exists).toBe(false);
    });
  });
});
