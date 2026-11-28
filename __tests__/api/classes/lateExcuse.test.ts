// PANEL-115: instruction changes are tracked apart from deadline changes,
// each submission records the instructions and due date it answered, and a
// professor can excuse lateness without changing what was recorded as late.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as createAssignment } from "@/app/api/classes/[classId]/assignments/route";
import { PATCH as patchAssignment } from "@/app/api/classes/[classId]/assignments/[assignmentId]/route";
import {
  DELETE as removeExcuse,
  PUT as excuse,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/submissions/[studentId]/late-excuse/route";
import {
  GET as getSubmissions,
  POST as submit,
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
const ids = { classId, assignmentId };
const base = `http://localhost/api/classes/${classId}/assignments`;

const assignmentDoc = (id = assignmentId) =>
  getAdminDb().collection("classes").doc(classId).collection("assignments").doc(id);
const submissionDoc = (uid: string) => assignmentDoc().collection("submissions").doc(uid);

function jsonRequest(method: string, url: string, idToken: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function patch(idToken: string, body: Record<string, unknown>) {
  const res = await patchAssignment(jsonRequest("PATCH", `${base}/${assignmentId}`, idToken, body), {
    params: Promise.resolve(ids),
  });
  if (!res) throw new Error("The PATCH route returned no response.");
  return res;
}

function postSubmission(idToken: string) {
  const bytes = new Uint8Array(2048);
  bytes.set(new TextEncoder().encode("%PDF-"));
  const body = new FormData();
  body.append("file", new File([bytes], "essay.pdf", { type: "application/pdf" }));
  return submit(
    new NextRequest(`${base}/${assignmentId}/submit`, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}` },
      body,
    }),
    { params: Promise.resolve(ids) }
  );
}

const excuseRoute = (studentId: string) => `${base}/${assignmentId}/submissions/${studentId}/late-excuse`;
const excuseParams = (studentId: string) => ({ params: Promise.resolve({ ...ids, studentId }) });

const putExcuse = (idToken: string, studentId: string, body: unknown) =>
  excuse(jsonRequest("PUT", excuseRoute(studentId), idToken, body), excuseParams(studentId));
const deleteExcuse = (idToken: string, studentId: string) =>
  removeExcuse(jsonRequest("DELETE", excuseRoute(studentId), idToken), excuseParams(studentId));

async function professorRow(idToken: string, studentId: string) {
  const res = await getSubmissions(
    new NextRequest(`${base}/${assignmentId}/submit`, { headers: { authorization: `Bearer ${idToken}` } }),
    { params: Promise.resolve(ids) }
  );
  expect(res.status).toBe(200);
  const { students } = await res.json();
  return students.find((row: { studentId: string }) => row.studentId === studentId);
}

async function createEnrolledStudent(email = "student@example.com") {
  const student = await createSignedInUser(email, "student");
  await getAdminDb().collection("users").doc(student.uid).collection("classes").add({ class_id: classId });
  return student;
}

let professorToken: string;

beforeEach(async () => {
  await clearEmulators();

  storage.from.mockReset().mockReturnValue(storage);
  storage.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  storage.remove.mockReset().mockResolvedValue({ data: [], error: null });
  storage.createSignedUrl.mockReset().mockResolvedValue({
    data: { signedUrl: "https://files.example.com/signed" },
    error: null,
  });

  const professor = await createSignedInUser("prof@example.com", "professor");
  professorToken = professor.idToken;
  await getAdminDb().collection("classes").doc(classId).set({ name: "CS 6300", professor_id: professor.uid });
  // An assignment from before PANEL-115: no instructionsRevision
  await assignmentDoc().set({
    name: "Essay",
    description: "Write 500 words.",
    points: 20,
    dueDate: "2099-12-31",
  });
});

/** Submits on time, then moves the due date into the past with a late window, and submits late. */
async function submitLate(idToken: string, { onTimeFirst }: { onTimeFirst: boolean }) {
  if (onTimeFirst) expect((await postSubmission(idToken)).status).toBe(201);
  await assignmentDoc().update({ dueDate: "2020-01-01", lateUntil: "2099-12-31" });
  expect((await postSubmission(idToken)).status).toBe(201);
}

describe("instructionsRevision", () => {
  it("starts at 0 on a new assignment", async () => {
    const res = await createAssignment(
      jsonRequest("POST", base, professorToken, { name: "Quiz", points: 10, dueDate: "2099-12-31" }),
      { params: Promise.resolve({ classId }) }
    );
    const { assignment } = await res!.json();

    expect((await assignmentDoc(assignment.id).get()).data()?.instructionsRevision).toBe(0);
  });

  it("increases only when the description changes, not for deadline or other edits", async () => {
    let res = await patch(professorToken, { description: "Write 600 words." });
    expect(res.status).toBe(200);
    expect((await res.json()).assignment.instructionsRevision).toBe(1);
    expect((await assignmentDoc().get()).data()).toMatchObject({
      instructionsRevision: 1,
      instructionsUpdatedAt: expect.any(String),
    });

    // The same text, with spaces trimmed, isn't a change
    res = await patch(professorToken, { description: "  Write 600 words.  " });
    expect((await res.json()).assignment.instructionsRevision).toBe(1);

    await patch(professorToken, { dueDate: "2099-11-30", points: 25, name: "Essay 1" });
    expect((await assignmentDoc().get()).data()?.instructionsRevision).toBe(1);

    await patch(professorToken, { description: "Write 600 words, with sources." });
    expect((await assignmentDoc().get()).data()?.instructionsRevision).toBe(2);
  });
});

describe("each submitted version records what it answered", () => {
  it("stores the instructions revision and the due date at submit time", async () => {
    const student = await createEnrolledStudent();
    await postSubmission(student.idToken);
    await patch(professorToken, { description: "Write 500 words. Cite two sources." });
    await patch(professorToken, { dueDate: "2099-12-30" });
    await postSubmission(student.idToken);

    const history = (await submissionDoc(student.uid).get()).data()?.submissionHistory;
    expect(history.map((entry: Record<string, unknown>) => [entry.instructionsRevision, entry.dueDateAtSubmit])).toEqual([
      [0, "2099-12-31"],
      [1, "2099-12-30"],
    ]);
  });

  it("records the student's own due date when only their exception let the submission in", async () => {
    const student = await createEnrolledStudent();
    await assignmentDoc().update({ dueDate: "2020-01-01" });
    await assignmentDoc().collection("exceptions").doc(student.uid).set({
      studentId: student.uid,
      dueDate: "2099-06-30",
      lateUntil: null,
      allowResubmit: false,
      reason: "Medical extension",
      grantedBy: "prof",
      grantedAt: "2026-11-20T12:00:00.000Z",
    });

    expect((await postSubmission(student.idToken)).status).toBe(201);

    expect((await submissionDoc(student.uid).get()).data()).toMatchObject({
      isLate: false,
      dueDateAtSubmit: "2099-06-30",
    });
  });

  it("applies no late penalty to a resubmission after a description fix, and keeps the first late on record", async () => {
    const student = await createEnrolledStudent();
    await submitLate(student.idToken, { onTimeFirst: false });

    await patch(professorToken, { description: "Write 500 words. (Fixed: the rubric link.)" });
    expect((await postSubmission(student.idToken)).status).toBe(201);

    const row = await professorRow(professorToken, student.uid);
    expect(row.isLate).toBe(true);
    expect(row.lateness).toMatchObject({
      late: true,
      newerInstructions: true,
      firstOnTime: false,
      penalty: false,
    });
    // The first version is still recorded as late
    const saved = (await submissionDoc(student.uid).get()).data();
    expect(saved?.submissionHistory[0]).toMatchObject({ isLate: true, instructionsRevision: 0 });
  });
});

describe("PUT late-excuse", () => {
  it("excuses the lateness without changing isLate or the history", async () => {
    const student = await createEnrolledStudent();
    await submitLate(student.idToken, { onTimeFirst: true });
    const before = (await submissionDoc(student.uid).get()).data()!;

    const res = await putExcuse(professorToken, student.uid, {
      reason: "  Doctor's note  ",
      submittedAt: before.submittedAt,
    });

    expect(res.status).toBe(200);
    const { lateExcused } = await res.json();
    expect(lateExcused).toEqual({
      by: expect.any(String),
      at: expect.any(String),
      reason: "Doctor's note",
      submittedAt: before.submittedAt,
    });

    const after = (await submissionDoc(student.uid).get()).data()!;
    const { lateExcused: stored, ...rest } = after;
    expect(stored).toEqual(lateExcused);
    expect(rest).toEqual(before);
    expect(after.isLate).toBe(true);

    expect((await professorRow(professorToken, student.uid)).lateness).toMatchObject({
      late: true,
      excused: { reason: "Doctor's note" },
      penalty: false,
    });
  });

  it("doesn't excuse a later late resubmission", async () => {
    const student = await createEnrolledStudent();
    await submitLate(student.idToken, { onTimeFirst: false });
    const { submittedAt } = (await submissionDoc(student.uid).get()).data()!;
    await putExcuse(professorToken, student.uid, { reason: "Flu", submittedAt });

    expect((await postSubmission(student.idToken)).status).toBe(201);

    const row = await professorRow(professorToken, student.uid);
    expect(row.lateness).toMatchObject({ late: true, excused: null, penalty: true });
    // The excuse stays on the submission for the version it covered
    expect((await submissionDoc(student.uid).get()).data()?.lateExcused).toMatchObject({ submittedAt });
  });

  it("refuses work that was on time, and a version the professor didn't review", async () => {
    const student = await createEnrolledStudent();
    await postSubmission(student.idToken);
    const { submittedAt } = (await submissionDoc(student.uid).get()).data()!;

    let res = await putExcuse(professorToken, student.uid, { reason: "Flu", submittedAt });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This version was turned in on time.");

    await submitLate(student.idToken, { onTimeFirst: false });
    res = await putExcuse(professorToken, student.uid, { reason: "Flu", submittedAt });
    expect(res.status).toBe(409);
    expect((await submissionDoc(student.uid).get()).data()?.lateExcused).toBeUndefined();
  });

  it.each([[{ submittedAt: "x" }], [{ reason: "   ", submittedAt: "x" }], [{ reason: "x".repeat(501), submittedAt: "x" }], [{ reason: "Flu" }]])(
    "returns 400 for %o",
    async (body) => {
      const student = await createEnrolledStudent();
      expect((await putExcuse(professorToken, student.uid, body)).status).toBe(400);
    }
  );

  it("returns 404 without a submission", async () => {
    const student = await createEnrolledStudent();
    expect((await putExcuse(professorToken, student.uid, { reason: "Flu", submittedAt: "x" })).status).toBe(404);
  });

  it("returns 403 to a student and to another professor, and saves nothing", async () => {
    const student = await createEnrolledStudent();
    await submitLate(student.idToken, { onTimeFirst: false });
    const { submittedAt } = (await submissionDoc(student.uid).get()).data()!;
    const other = await createSignedInUser("other@example.com", "professor");

    for (const token of [student.idToken, other.idToken]) {
      expect((await putExcuse(token, student.uid, { reason: "Please", submittedAt })).status).toBe(403);
      expect((await deleteExcuse(token, student.uid)).status).toBe(403);
    }
    expect((await submissionDoc(student.uid).get()).data()?.lateExcused).toBeUndefined();
  });
});

describe("DELETE late-excuse", () => {
  it("removes the excuse, so the penalty applies again", async () => {
    const student = await createEnrolledStudent();
    await submitLate(student.idToken, { onTimeFirst: false });
    const { submittedAt } = (await submissionDoc(student.uid).get()).data()!;
    await putExcuse(professorToken, student.uid, { reason: "Flu", submittedAt });

    const res = await deleteExcuse(professorToken, student.uid);

    expect(res.status).toBe(200);
    const saved = (await submissionDoc(student.uid).get()).data();
    expect(saved?.lateExcused).toBeUndefined();
    expect(saved?.isLate).toBe(true);
    expect((await professorRow(professorToken, student.uid)).lateness).toMatchObject({ excused: null, penalty: true });
  });

  it("returns 404 without a submission", async () => {
    const student = await createEnrolledStudent();
    expect((await deleteExcuse(professorToken, student.uid)).status).toBe(404);
  });
});
