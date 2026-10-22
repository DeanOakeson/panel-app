import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/classes/[classId]/assignments/[assignmentId]/submissions/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const assignmentId = "assignment-1";

const assignment = {
  name: "Project 1",
  description: "Build it",
  points: 100,
  dueDate: "2026-11-01",
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
      `http://localhost/api/classes/${ids.classId}/assignments/${ids.assignmentId}/submissions`,
      { headers }
    ),
    { params: Promise.resolve(ids) }
  );
}

/** Stores a student's submission, and their users profile when `name` is given. */
async function addSubmission(
  studentUid: string,
  name: string | null,
  submission: Record<string, unknown>,
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
    .set(submission);
}

let ownerToken: string;

beforeEach(async () => {
  await clearEmulators();

  const owner = await createSignedInUser("owner@example.com", "professor");
  ownerToken = owner.idToken;

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: owner.uid });
  await assignmentDoc().set(assignment);
});

describe("GET /api/classes/[classId]/assignments/[assignmentId]/submissions", () => {
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

    it("returns 403 for a student enrolled in the class", async () => {
      const { uid, idToken } = await createSignedInUser("student@example.com", "student");
      await getAdminDb()
        .collection("users")
        .doc(uid)
        .collection("classes")
        .add({ class_id: classId });
      await addSubmission(uid, null, { text: "Mine", submittedAt: "2026-10-30T12:00:00.000Z" });

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

    it("returns the assignment and an empty list when nobody has submitted", async () => {
      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        assignment: { id: assignmentId, ...assignment },
        submissions: [],
      });
    });

    it("lists the assignment's submissions by student name", async () => {
      await addSubmission("zoe", "Zoe Zhang", {
        url: "https://example.com/zoe",
        submittedAt: "2026-10-30T09:00:00.000Z",
      });
      await addSubmission("ada", "Ada Lovelace", {
        text: "My essay",
        submittedAt: "2026-10-31T09:00:00.000Z",
      });
      await assignmentDoc("assignment-2").set({ ...assignment, name: "Project 2" });
      await addSubmission("ada", "Ada Lovelace", { text: "Other work" }, "assignment-2");

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.submissions).toEqual([
        {
          id: "ada",
          text: "My essay",
          submittedAt: "2026-10-31T09:00:00.000Z",
          studentName: "Ada Lovelace",
          studentEmail: "ada@example.com",
          grade: null,
        },
        {
          id: "zoe",
          url: "https://example.com/zoe",
          submittedAt: "2026-10-30T09:00:00.000Z",
          studentName: "Zoe Zhang",
          studentEmail: "zoe@example.com",
          grade: null,
        },
      ]);
    });

    it("lists a submission whose student has no profile", async () => {
      await addSubmission("ghost", null, { text: "Still here" });

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      expect((await res.json()).submissions).toEqual([
        {
          id: "ghost",
          text: "Still here",
          studentName: null,
          studentEmail: null,
          grade: null,
        },
      ]);
    });

    it("includes each submission's grade", async () => {
      const grade = {
        score: 90,
        feedback: "Strong work",
        gradedBy: "owner",
        gradedAt: "2026-11-02T09:00:00.000Z",
      };
      await addSubmission("ada", "Ada Lovelace", { text: "My essay" });
      await addSubmission("zoe", "Zoe Zhang", { text: "Mine" });
      await assignmentDoc().collection("grades").doc("ada").set(grade);

      const res = await getSubmissions(ownerToken);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.submissions.map((submission: { grade: unknown }) => submission.grade)).toEqual([
        grade,
        null,
      ]);
    });
  });
});
