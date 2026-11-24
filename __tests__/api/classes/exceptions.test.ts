import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DELETE,
  PUT,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/exceptions/[studentId]/route";
import {
  GET as getSubmissions,
  POST as postSubmission,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/submit/route";
import { DELETE as deleteAssignment } from "@/app/api/classes/[classId]/assignments/[assignmentId]/route";
import { POST as postMissingGrade } from "@/app/api/classes/[classId]/assignments/[assignmentId]/missing-grades/[studentId]/route";
import { getClosesAt } from "@/lib/assignmentDeadline";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  CLOSED_MESSAGE,
  EXCEPTION_USED_MESSAGE,
  LOCKED_MESSAGE,
} from "@/lib/submissionException";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const storage = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ storage: { from: storage.from } }),
}));

const classId = "class-1";
const assignmentId = "assignment-1";
const pastDueDate = "2020-01-15";
const futureDate = "2099-12-31";

type Ids = { classId: string; assignmentId: string; studentId: string };

function assignmentDoc() {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
}

function submissionDoc(id: string) {
  return assignmentDoc().collection("submissions").doc(id);
}

function exceptionDoc(id: string) {
  return assignmentDoc().collection("exceptions").doc(id);
}

function sendException(
  method: "PUT" | "DELETE",
  body: unknown,
  idToken: string | undefined,
  ids: Ids
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const handler = method === "PUT" ? PUT : DELETE;

  return handler(
    new NextRequest(
      `http://localhost/api/classes/${ids.classId}/assignments/${ids.assignmentId}/exceptions/${ids.studentId}`,
      {
        method,
        headers,
        body:
          body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve(ids) }
  );
}

/** Sends a PDF through the real submit route as a student. */
function submitFile(idToken: string, name = "essay.pdf") {
  const body = new FormData();
  const bytes = new Uint8Array(2048);
  bytes.set(new TextEncoder().encode("%PDF-1.4\n"));

  body.append("file", new File([bytes], name, { type: "application/pdf" }));

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
let otherUid: string;
let otherToken: string;
let ids: Ids;

function grant(body: unknown, idToken: string | undefined = ownerToken, to = ids) {
  return sendException("PUT", body, idToken, to);
}

function removeException(idToken: string | undefined = ownerToken, to = ids) {
  return sendException("DELETE", undefined, idToken, to);
}

/** Enrolls a user in the class under test. */
function enroll(uid: string) {
  return getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .doc(classId)
    .set({ class_id: classId });
}

/** Stores a submission for a student directly, as an earlier submit would have. */
function storeSubmission(uid: string, fileName = "first.pdf") {
  const entry = {
    studentId: uid,
    filePath: `${classId}/${assignmentId}/${uid}/${fileName}`,
    fileName,
    fileType: "application/pdf",
    fileSize: 2048,
    submittedAt: "2020-01-10T12:00:00.000Z",
    status: "submitted",
    isLate: false,
  };

  return submissionDoc(uid).set({ ...entry, submissionHistory: [entry] });
}

/**
 * Runs `change` after the submit route's early reads and upload, just before
 * its transaction starts, where a concurrent change could otherwise land.
 */
function changeBeforeTransaction(change: () => Promise<unknown>) {
  const db = getAdminDb();
  const runTransaction = db.runTransaction.bind(db);

  vi.spyOn(db, "runTransaction").mockImplementationOnce((async (
    updateFunction: Parameters<typeof runTransaction>[0],
    options?: Parameters<typeof runTransaction>[1]
  ) => {
    await change();
    return runTransaction(updateFunction, options);
  }) as typeof db.runTransaction);
}

beforeEach(async () => {
  await clearEmulators();

  vi.restoreAllMocks();
  storage.from.mockReset().mockReturnValue(storage);
  storage.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  storage.remove.mockReset().mockResolvedValue({ data: [], error: null });
  storage.list.mockReset().mockResolvedValue({ data: [], error: null });
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
  ({ uid: otherUid, idToken: otherToken } = await createSignedInUser(
    "bob@example.com",
    "student"
  ));
  ids = { classId, assignmentId, studentId: studentUid };

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: ownerUid });
  // Closed for the class, which is the case an exception exists for
  await assignmentDoc().set({ name: "Project 1", points: 100, dueDate: pastDueDate });
  await enroll(studentUid);
  await enroll(otherUid);
});

describe("PUT /api/classes/[classId]/assignments/[assignmentId]/exceptions/[studentId]", () => {
  describe("authentication and authorization", () => {
    it("returns 401 without a token", async () => {
      const res = await grant({ dueDate: futureDate }, "");

      expect(res.status).toBe(401);
      expect((await exceptionDoc(studentUid).get()).exists).toBe(false);
    });

    it("returns 403 for a professor who does not teach the class", async () => {
      const { idToken } = await createSignedInUser("other@example.com", "professor");

      const res = await grant({ dueDate: futureDate }, idToken);

      expect(res.status).toBe(403);
      expect((await exceptionDoc(studentUid).get()).exists).toBe(false);
    });

    it("returns 403 for the student, even for their own exception", async () => {
      const res = await grant({ dueDate: futureDate }, studentToken);

      expect(res.status).toBe(403);
      expect((await exceptionDoc(studentUid).get()).exists).toBe(false);
    });

    it("lets an admin grant an exception", async () => {
      const { uid, idToken } = await createSignedInUser("admin@example.com", "admin");

      const res = await grant({ dueDate: futureDate }, idToken);

      expect(res.status).toBe(201);
      expect((await exceptionDoc(studentUid).get()).data()).toMatchObject({ grantedBy: uid });
    });
  });

  describe("as the class's professor", () => {
    it("returns 404 for a class that does not exist", async () => {
      const res = await grant({ dueDate: futureDate }, ownerToken, { ...ids, classId: "missing" });

      expect(res.status).toBe(404);
    });

    it("returns 404 for an assignment that does not exist", async () => {
      const res = await grant({ dueDate: futureDate }, ownerToken, {
        ...ids,
        assignmentId: "missing",
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Assignment not found." });
    });

    it("returns 404 and saves nothing for a student who is not enrolled", async () => {
      const { uid } = await createSignedInUser("zoe@example.com", "student");

      const res = await grant({ dueDate: futureDate }, ownerToken, { ...ids, studentId: uid });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "This student is not enrolled in this class." });
      expect((await exceptionDoc(uid).get()).exists).toBe(false);
    });

    it.each([
      { label: "a body that is not JSON", body: "not json" },
      { label: "no due date", body: {} },
      { label: "a due date that is not text", body: { dueDate: 20991231 } },
      { label: "a malformed due date", body: { dueDate: "12/31/2099" } },
      { label: "an impossible due date", body: { dueDate: "2099-02-30" } },
      { label: "a malformed late-until date", body: { dueDate: futureDate, lateUntil: "next week" } },
      { label: "a late-until date that is not text", body: { dueDate: "2099-12-01", lateUntil: 5 } },
      { label: "a late-until date before the due date", body: { dueDate: futureDate, lateUntil: "2099-12-01" } },
      { label: "a late-until date equal to the due date", body: { dueDate: futureDate, lateUntil: futureDate } },
      { label: "an allowResubmit that is not a boolean", body: { dueDate: futureDate, allowResubmit: "true" } },
      { label: "a reason that is not text", body: { dueDate: futureDate, reason: 42 } },
      { label: "a reason over 500 characters", body: { dueDate: futureDate, reason: "x".repeat(501) } },
      { label: "a window that has already ended", body: { dueDate: "2020-02-01" } },
      {
        label: "a late window that has already ended",
        body: { dueDate: "2020-02-01", lateUntil: "2020-02-05" },
      },
    ])("returns 400 and saves nothing for $label", async ({ body }) => {
      const res = await grant(body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
      expect((await exceptionDoc(studentUid).get()).exists).toBe(false);
    });

    it("accepts a reason of exactly 500 characters after trimming", async () => {
      const res = await grant({ dueDate: futureDate, reason: `  ${"x".repeat(500)}  ` });

      expect(res.status).toBe(201);
      expect((await exceptionDoc(studentUid).get()).data()?.reason).toBe("x".repeat(500));
    });

    it("grants an exception against the student, assignment and course", async () => {
      const res = await grant({
        dueDate: "2099-12-01",
        lateUntil: futureDate,
        allowResubmit: true,
        reason: "  Hospital stay  ",
      });

      expect(res.status).toBe(201);
      const stored = (await exceptionDoc(studentUid).get()).data();
      expect(stored).toEqual({
        studentId: studentUid,
        classId,
        assignmentId,
        dueDate: "2099-12-01",
        lateUntil: futureDate,
        allowResubmit: true,
        reason: "Hospital stay",
        grantedBy: ownerUid,
        grantedAt: expect.any(String),
      });
      expect(await res.json()).toEqual({
        exception: {
          dueDate: "2099-12-01",
          lateUntil: futureDate,
          closesAt: getClosesAt(futureDate),
          allowResubmit: true,
          reason: "Hospital stay",
          grantedBy: ownerUid,
          grantedAt: stored?.grantedAt,
          updatedAt: null,
        },
      });
    });

    it("defaults to no late window, no resubmission and no reason", async () => {
      const res = await grant({ dueDate: futureDate, lateUntil: null });

      expect(res.status).toBe(201);
      expect((await exceptionDoc(studentUid).get()).data()).toMatchObject({
        lateUntil: null,
        allowResubmit: false,
        reason: "",
      });
    });

    it("leaves the assignment and other students unchanged", async () => {
      const before = (await assignmentDoc().get()).data();

      await grant({ dueDate: futureDate });

      expect((await assignmentDoc().get()).data()).toEqual(before);
      expect((await exceptionDoc(otherUid).get()).exists).toBe(false);
    });

    it("replaces an exception, keeping who granted it and recording who replaced it", async () => {
      await exceptionDoc(studentUid).set({
        studentId: studentUid,
        classId,
        assignmentId,
        dueDate: "2099-01-01",
        lateUntil: "2099-01-05",
        allowResubmit: true,
        reason: "First reason",
        grantedBy: "original-grader",
        grantedAt: "2026-11-01T10:00:00.000Z",
      });

      const res = await grant({ dueDate: futureDate });

      expect(res.status).toBe(200);
      expect((await exceptionDoc(studentUid).get()).data()).toEqual({
        studentId: studentUid,
        classId,
        assignmentId,
        dueDate: futureDate,
        lateUntil: null,
        allowResubmit: false,
        reason: "",
        grantedBy: "original-grader",
        grantedAt: "2026-11-01T10:00:00.000Z",
        updatedBy: ownerUid,
        updatedAt: expect.any(String),
      });
      expect((await res.json()).exception).toMatchObject({
        grantedBy: "original-grader",
        updatedAt: expect.any(String),
      });
    });
  });
});

describe("DELETE /api/classes/[classId]/assignments/[assignmentId]/exceptions/[studentId]", () => {
  beforeEach(async () => {
    await grant({ dueDate: futureDate });
  });

  it("returns 401 without a token", async () => {
    const res = await removeException("");

    expect(res.status).toBe(401);
    expect((await exceptionDoc(studentUid).get()).exists).toBe(true);
  });

  it("returns 403 for a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");

    const res = await removeException(idToken);

    expect(res.status).toBe(403);
    expect((await exceptionDoc(studentUid).get()).exists).toBe(true);
  });

  it("returns 403 for the student", async () => {
    const res = await removeException(studentToken);

    expect(res.status).toBe(403);
    expect((await exceptionDoc(studentUid).get()).exists).toBe(true);
  });

  it("returns 404 for an assignment that does not exist", async () => {
    const res = await removeException(ownerToken, { ...ids, assignmentId: "missing" });

    expect(res.status).toBe(404);
  });

  it("returns 404 for a student without an exception", async () => {
    const res = await removeException(ownerToken, { ...ids, studentId: otherUid });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "This student has no exception on this assignment.",
    });
  });

  it("removes the exception", async () => {
    const res = await removeException();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect((await exceptionDoc(studentUid).get()).exists).toBe(false);
  });

  it("lets an admin remove an exception", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await removeException(idToken);

    expect(res.status).toBe(200);
    expect((await exceptionDoc(studentUid).get()).exists).toBe(false);
  });

  it("keeps a submission made under the exception, and its lateness", async () => {
    await submitFile(studentToken);
    const before = (await submissionDoc(studentUid).get()).data();

    await removeException();

    expect((await submissionDoc(studentUid).get()).data()).toEqual(before);
  });
});

describe("submitting with an exception", () => {
  it("still refuses a student without an exception on a closed assignment", async () => {
    await grant({ dueDate: futureDate }, ownerToken, { ...ids, studentId: otherUid });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CLOSED_MESSAGE });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("still refuses a student without an exception on a locked assignment", async () => {
    await assignmentDoc().update({ dueDate: futureDate, isLocked: true });
    await grant({ dueDate: futureDate }, ownerToken, { ...ids, studentId: otherUid });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: LOCKED_MESSAGE });
  });

  it("accepts a submission past the class deadline, on time under the exception", async () => {
    await grant({ dueDate: futureDate });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(201);
    expect((await submissionDoc(studentUid).get()).data()).toMatchObject({
      studentId: studentUid,
      isLate: false,
      submissionHistory: [expect.objectContaining({ isLate: false })],
    });
  });

  it("accepts a submission to a locked assignment", async () => {
    await assignmentDoc().update({ dueDate: futureDate, isLocked: true });
    await grant({ dueDate: futureDate });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(201);
    expect((await submissionDoc(studentUid).get()).data()).toMatchObject({ isLate: false });
  });

  it("marks a submission late during the exception's late window", async () => {
    await exceptionDoc(studentUid).set({
      studentId: studentUid,
      classId,
      assignmentId,
      dueDate: "2020-06-01",
      lateUntil: futureDate,
      allowResubmit: false,
      reason: "",
      grantedBy: ownerUid,
      grantedAt: "2026-11-01T10:00:00.000Z",
    });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(201);
    expect((await submissionDoc(studentUid).get()).data()).toMatchObject({ isLate: true });
  });

  it("measures lateness against the class due date when it is later than the exception's", async () => {
    // The professor extended the class past the exception's due date
    await assignmentDoc().update({ dueDate: futureDate });
    await exceptionDoc(studentUid).set({
      studentId: studentUid,
      classId,
      assignmentId,
      dueDate: "2020-06-01",
      lateUntil: "2099-06-01",
      allowResubmit: false,
      reason: "",
      grantedBy: ownerUid,
      grantedAt: "2026-11-01T10:00:00.000Z",
    });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(201);
    expect((await submissionDoc(studentUid).get()).data()).toMatchObject({ isLate: false });
  });

  it("marks a submission late for the class without an exception, as before", async () => {
    await assignmentDoc().update({ dueDate: pastDueDate, lateUntil: futureDate });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(201);
    expect((await submissionDoc(studentUid).get()).data()).toMatchObject({ isLate: true });
  });

  it("refuses once the exception's window has ended", async () => {
    await exceptionDoc(studentUid).set({
      studentId: studentUid,
      classId,
      assignmentId,
      dueDate: "2020-02-01",
      lateUntil: "2020-02-05",
      allowResubmit: true,
      reason: "",
      grantedBy: ownerUid,
      grantedAt: "2020-01-20T10:00:00.000Z",
    });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Your extension ended Feb 5, 11:59 PM MT. You can no longer submit this assignment.",
    });
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await submissionDoc(studentUid).get()).exists).toBe(false);
  });

  it("lets a student without a submission hand one in when resubmission is not allowed", async () => {
    await grant({ dueDate: futureDate, allowResubmit: false });

    const first = await submitFile(studentToken);
    const second = await submitFile(studentToken, "second.pdf");

    expect(first.status).toBe(201);
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ error: EXCEPTION_USED_MESSAGE });
    expect((await submissionDoc(studentUid).get()).data()).toMatchObject({ fileName: "essay.pdf" });
  });

  it("refuses a student who submitted before the close when resubmission is not allowed", async () => {
    await storeSubmission(studentUid);
    await grant({ dueDate: futureDate, allowResubmit: false });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: EXCEPTION_USED_MESSAGE });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("lets a student replace their submission when resubmission is allowed", async () => {
    await storeSubmission(studentUid);
    await assignmentDoc().update({ isLocked: true });
    await grant({ dueDate: futureDate, allowResubmit: true });

    const res = await submitFile(studentToken, "second.pdf");

    expect(res.status).toBe(201);
    const stored = (await submissionDoc(studentUid).get()).data();
    expect(stored).toMatchObject({ fileName: "second.pdf", isLate: false });
    expect(stored?.submissionHistory.map((entry: { fileName: string }) => entry.fileName)).toEqual([
      "first.pdf",
      "second.pdf",
    ]);
  });

  it("refuses once the exception is removed", async () => {
    await grant({ dueDate: futureDate });
    await removeException();

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CLOSED_MESSAGE });
  });

  it("refuses a student unenrolled after the grant, whose exception stays", async () => {
    await grant({ dueDate: futureDate });
    await getAdminDb().collection("users").doc(studentUid).collection("classes").doc(classId).delete();

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect((await exceptionDoc(studentUid).get()).exists).toBe(true);
  });

  it("refuses and removes the uploaded file when the exception is removed before the write", async () => {
    await grant({ dueDate: futureDate });
    changeBeforeTransaction(() => exceptionDoc(studentUid).delete());

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CLOSED_MESSAGE });
    const [uploadedPath] = storage.upload.mock.calls[0];
    expect(storage.remove).toHaveBeenCalledWith([uploadedPath]);
    expect((await submissionDoc(studentUid).get()).exists).toBe(false);
  });

  it("refuses when a parallel submission lands before the write and resubmission is not allowed", async () => {
    await grant({ dueDate: futureDate, allowResubmit: false });
    changeBeforeTransaction(() => storeSubmission(studentUid, "parallel.pdf"));

    const res = await submitFile(studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: EXCEPTION_USED_MESSAGE });
    expect((await submissionDoc(studentUid).get()).data()).toMatchObject({ fileName: "parallel.pdf" });
  });

  it("flags a submission made after a missing-work grade", async () => {
    const missing = await postMissingGrade(
      new NextRequest(
        `http://localhost/api/classes/${classId}/assignments/${assignmentId}/missing-grades/${studentUid}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
          body: JSON.stringify({ feedback: "Nothing turned in" }),
        }
      ),
      { params: Promise.resolve(ids) }
    );
    expect(missing.status).toBe(201);
    await grant({ dueDate: futureDate });

    const res = await submitFile(studentToken);

    expect(res.status).toBe(201);
    const [row] = (await (await getRosterOrOwn(ownerToken)).json()).students.filter(
      (student: { studentId: string }) => student.studentId === studentUid
    );
    expect(row).toMatchObject({
      gradingStatus: "submitted-after-missing",
      submittedAfterMissingGrade: true,
      missingGrade: { score: 0, feedback: "Nothing turned in" },
    });
  });
});

describe("GET /api/classes/[classId]/assignments/[assignmentId]/submit with exceptions", () => {
  it("adds each student's exception to their roster row, and null for the rest", async () => {
    await grant({
      dueDate: "2099-12-01",
      lateUntil: futureDate,
      allowResubmit: true,
      reason: "Hospital stay",
    });
    await storeSubmission(otherUid);

    const res = await getRosterOrOwn(ownerToken);

    expect(res.status).toBe(200);
    const rows: { studentId: string; exception: unknown }[] = (await res.json()).students;
    const byId = new Map(rows.map((row) => [row.studentId, row]));
    expect(byId.get(studentUid)?.exception).toEqual({
      dueDate: "2099-12-01",
      lateUntil: futureDate,
      closesAt: getClosesAt(futureDate),
      allowResubmit: true,
      reason: "Hospital stay",
      grantedBy: ownerUid,
      grantedAt: expect.any(String),
      updatedAt: null,
    });
    expect(byId.get(otherUid)?.exception).toBeNull();
  });

  it("carries the exception on the row of a student who has submitted", async () => {
    await storeSubmission(studentUid);
    await grant({ dueDate: futureDate, allowResubmit: true });

    const rows: { studentId: string; fileName?: string; exception: unknown }[] = (
      await (await getRosterOrOwn(ownerToken)).json()
    ).students;

    expect(rows.find((row) => row.studentId === studentUid)).toMatchObject({
      fileName: "first.pdf",
      exception: { dueDate: futureDate, allowResubmit: true },
    });
  });

  it("gives the student their own exception without the reason or who granted it", async () => {
    await grant({ dueDate: "2099-12-01", lateUntil: futureDate, reason: "Hospital stay" });

    const res = await getRosterOrOwn(studentToken);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exception).toEqual({
      dueDate: "2099-12-01",
      lateUntil: futureDate,
      closesAt: getClosesAt(futureDate),
      allowResubmit: false,
    });
    expect(JSON.stringify(body)).not.toContain("Hospital stay");
    expect(JSON.stringify(body)).not.toContain(ownerUid);
  });

  it("gives the student their exception alongside a submission", async () => {
    await storeSubmission(studentUid);
    await grant({ dueDate: futureDate, allowResubmit: true });

    const body = await (await getRosterOrOwn(studentToken)).json();

    expect(body.submission).toMatchObject({ fileName: "first.pdf" });
    expect(body.exception).toMatchObject({ dueDate: futureDate, allowResubmit: true });
  });

  it("gives another student a null exception", async () => {
    await grant({ dueDate: futureDate });

    const body = await (await getRosterOrOwn(otherToken)).json();

    expect(body.exception).toBeNull();
  });
});

describe("deleting an assignment with exceptions", () => {
  it("removes its exceptions with it", async () => {
    await grant({ dueDate: futureDate });

    const res = await deleteAssignment(
      new NextRequest(`http://localhost/api/classes/${classId}/assignments/${assignmentId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
      { params: Promise.resolve({ classId, assignmentId }) }
    );

    expect(res.status).toBe(200);
    expect((await exceptionDoc(studentUid).get()).exists).toBe(false);
    expect((await assignmentDoc().get()).exists).toBe(false);
  });
});
