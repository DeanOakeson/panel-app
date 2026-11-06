import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  PATCH as patchGradeRoute,
  POST as postGradeRoute,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/grade/route";
import {
  PATCH as patchMissingRoute,
  POST as postMissingRoute,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId]/route";
import { GET as getHistoryRoute } from "@/app/api/classes/[classId]/assignments/[assignmentId]/grade-history/[studentId]/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const assignmentId = "assignment-1";
const submitter = "ada";
const submittedAt = "2026-10-31T09:00:00.000Z";

type Handler = (request: NextRequest, context: { params: Promise<Ids> }) => Promise<Response>;
type Ids = { classId: string; assignmentId: string; studentId: string };

function assignmentDoc() {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
}

function historyOf(studentId: string) {
  return assignmentDoc().collection("grades").doc(studentId).collection("history");
}

/** Returns a grade's history entries, oldest first. */
async function readHistory(studentId: string) {
  const snapshot = await historyOf(studentId).orderBy("savedAt").get();

  return snapshot.docs.map((entry) => entry.data());
}

function send(handler: Handler, method: string, path: string, studentId: string, body: unknown, idToken: string) {
  const ids = { classId, assignmentId, studentId };

  return handler(
    new NextRequest(`http://localhost/api/classes/${classId}/assignments/${assignmentId}/${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve(ids) }
  );
}

const postGrade = (body: unknown, idToken = ownerToken) =>
  send(postGradeRoute, "POST", `submissions/${submitter}/grade`, submitter, body, idToken);
const patchGrade = (body: unknown, idToken = ownerToken) =>
  send(patchGradeRoute, "PATCH", `submissions/${submitter}/grade`, submitter, body, idToken);
const postMissing = (body: unknown, idToken = ownerToken) =>
  send(postMissingRoute, "POST", `missing-grades/${absentUid}`, absentUid, body, idToken);
const patchMissing = (body: unknown, idToken = ownerToken) =>
  send(patchMissingRoute, "PATCH", `missing-grades/${absentUid}`, absentUid, body, idToken);

function getHistory(studentId: string, idToken: string) {
  return getHistoryRoute(
    new NextRequest(
      `http://localhost/api/classes/${classId}/assignments/${assignmentId}/grade-history/${studentId}`,
      { headers: { authorization: `Bearer ${idToken}` } }
    ),
    { params: Promise.resolve({ classId, assignmentId, studentId }) }
  );
}

let ownerUid: string;
let ownerToken: string;
let absentUid: string;
let absentToken: string;

beforeEach(async () => {
  await clearEmulators();

  ({ uid: ownerUid, idToken: ownerToken } = await createSignedInUser("owner@example.com", "professor"));
  await getAdminDb().collection("users").doc(ownerUid).update({ name: "Dr. Owner" });
  ({ uid: absentUid, idToken: absentToken } = await createSignedInUser("absent@example.com", "student"));

  await getAdminDb().collection("classes").doc(classId).set({ name: "CS 6300", professor_id: ownerUid });
  await assignmentDoc().set({ name: "Project 1", points: 100, dueDate: "2020-01-15" });
  await getAdminDb()
    .collection("users")
    .doc(absentUid)
    .collection("classes")
    .doc(classId)
    .set({ class_id: classId });
  await assignmentDoc().collection("submissions").doc(submitter).set({
    studentId: submitter,
    filePath: `${classId}/${assignmentId}/${submitter}/1-essay.pdf`,
    fileName: "essay.pdf",
    submittedAt,
    status: "submitted",
  });
});

describe("submission grade history", () => {
  it("records a created entry in the same save as the grade", async () => {
    const res = await postGrade({ submittedAt, score: 80, feedback: "  First pass  " });
    const { grade } = await res.json();

    expect(res.status).toBe(201);
    expect(await readHistory(submitter)).toEqual([
      {
        score: 80,
        feedback: "First pass",
        submittedAt,
        savedBy: ownerUid,
        savedAt: grade.gradedAt,
        action: "created",
      },
    ]);
  });

  it("adds an edited entry for each edit and keeps the earlier ones", async () => {
    const created = await (await postGrade({ submittedAt, score: 80 })).json();
    const first = await (
      await patchGrade({ submittedAt, score: 85, feedback: "Second", lastSavedAt: created.grade.gradedAt })
    ).json();
    const second = await (
      await patchGrade({ submittedAt, score: 90, feedback: "Third", lastSavedAt: first.grade.updatedAt })
    ).json();

    const history = await readHistory(submitter);
    expect(history.map((entry) => [entry.action, entry.score, entry.feedback])).toEqual([
      ["created", 80, ""],
      ["edited", 85, "Second"],
      ["edited", 90, "Third"],
    ]);
    expect(history[2]).toMatchObject({ savedBy: ownerUid, savedAt: second.grade.updatedAt, submittedAt });
  });

  it("records a grade saved before history was kept as it stood, then the edit", async () => {
    await assignmentDoc().collection("grades").doc(submitter).set({
      studentId: submitter,
      classId,
      assignmentId,
      score: 60,
      feedback: "Legacy",
      submittedAt,
      gradedBy: "earlier-grader",
      gradedAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-02T10:00:00.000Z",
      updatedBy: "earlier-editor",
    });

    const res = await patchGrade({ submittedAt, score: 70, lastSavedAt: "2026-11-02T10:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(await readHistory(submitter)).toEqual([
      {
        score: 60,
        feedback: "Legacy",
        submittedAt,
        savedBy: "earlier-editor",
        savedAt: "2026-11-02T10:00:00.000Z",
        action: "edited",
      },
      expect.objectContaining({ score: 70, action: "edited", savedBy: ownerUid }),
    ]);
  });

  it.each([
    {
      label: "a duplicate grade (409)",
      act: async () => postGrade({ submittedAt, score: 50 }),
    },
    {
      label: "a stale edit (409)",
      act: async () => patchGrade({ submittedAt, score: 50, lastSavedAt: "2020-01-01T00:00:00.000Z" }),
    },
    {
      label: "an invalid edit (400)",
      act: async () => patchGrade({ submittedAt, score: 500, lastSavedAt: "ignored" }),
    },
  ])("writes no history for $label", async ({ act }) => {
    await postGrade({ submittedAt, score: 80 });

    const res = await act();

    expect([400, 409]).toContain(res.status);
    expect(await readHistory(submitter)).toHaveLength(1);
  });

  it("writes no history for an invalid new grade", async () => {
    const res = await postGrade({ submittedAt, score: -1 });

    expect(res.status).toBe(400);
    expect(await readHistory(submitter)).toHaveLength(0);
  });
});

describe("missing-work grade history", () => {
  it("records a created entry and an edited entry for each edit", async () => {
    const created = await (await postMissing({ score: 0, feedback: "Nothing in" })).json();
    const first = await (
      await patchMissing({ score: 0, feedback: "Emailed late", lastSavedAt: created.grade.gradedAt })
    ).json();
    await patchMissing({ score: 0, feedback: "Excused part", lastSavedAt: first.grade.updatedAt });

    const history = await readHistory(absentUid);
    expect(history.map((entry) => [entry.action, entry.feedback])).toEqual([
      ["created", "Nothing in"],
      ["edited", "Emailed late"],
      ["edited", "Excused part"],
    ]);
    expect(history[0]).toEqual({
      score: 0,
      feedback: "Nothing in",
      savedBy: ownerUid,
      savedAt: created.grade.gradedAt,
      action: "created",
    });
  });

  it("writes no history for a stale or invalid edit", async () => {
    await postMissing({ score: 0 });

    const stale = await patchMissing({ score: 0, lastSavedAt: "2020-01-01T00:00:00.000Z" });
    const invalid = await patchMissing({ score: 0, feedback: "x".repeat(5001), lastSavedAt: "ignored" });

    expect(stale.status).toBe(409);
    expect(invalid.status).toBe(400);
    expect(await readHistory(absentUid)).toHaveLength(1);
  });
});

describe("GET /api/classes/[classId]/assignments/[assignmentId]/grade-history/[studentId]", () => {
  it("gives the class's professor both histories, oldest first, with who saved each", async () => {
    const created = await (await postGrade({ submittedAt, score: 80 })).json();
    await patchGrade({ submittedAt, score: 90, lastSavedAt: created.grade.gradedAt });

    const res = await getHistory(submitter, ownerToken);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.grade.map((entry: { action: string; score: number; savedByName: string }) => [
        entry.action,
        entry.score,
        entry.savedByName,
      ])
    ).toEqual([
      ["created", 80, "Dr. Owner"],
      ["edited", 90, "Dr. Owner"],
    ]);
  });

  it("gives an admin the history, with no submittedAt on a missing-work grade's versions", async () => {
    await postMissing({ score: 0, feedback: "Nothing in" });
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await getHistory(absentUid, idToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      grade: [
        {
          score: 0,
          feedback: "Nothing in",
          savedBy: ownerUid,
          savedAt: expect.any(String),
          action: "created",
          savedByName: "Dr. Owner",
        },
      ],
    });
  });

  it("returns 403 to the student whose grade it is", async () => {
    await postMissing({ score: 0 });

    const res = await getHistory(absentUid, absentToken);

    expect(res.status).toBe(403);
  });

  it("returns 403 to a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");

    const res = await getHistory(submitter, idToken);

    expect(res.status).toBe(403);
  });

  it("returns 404 for an assignment that does not exist", async () => {
    await assignmentDoc().delete();

    const res = await getHistory(submitter, ownerToken);

    expect(res.status).toBe(404);
  });
});
