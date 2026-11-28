// PANEL-113: a professor can turn resubmission off or limit the number of
// attempts, and the submit route enforces it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as createAssignment } from "@/app/api/classes/[classId]/assignments/route";
import { PATCH as patchAssignment } from "@/app/api/classes/[classId]/assignments/[assignmentId]/route";
import {
  GET as getSubmissions,
  POST as submit,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/submit/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  countAttempts,
  getAttemptLimit,
  parseResubmissionSettings,
  resubmissionBlockedReason,
} from "@/lib/resubmission";
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
const ids = { classId, assignmentId };

function assignmentDoc(id = assignmentId) {
  return getAdminDb().collection("classes").doc(classId).collection("assignments").doc(id);
}

function submissionDoc(studentUid: string) {
  return assignmentDoc().collection("submissions").doc(studentUid);
}

function pdf(name = "essay.pdf") {
  const bytes = new Uint8Array(2048);
  bytes.set(new TextEncoder().encode("%PDF-"));
  return new File([bytes], name, { type: "application/pdf" });
}

function jsonRequest(method: string, url: string, idToken: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function create(idToken: string, body: Record<string, unknown>) {
  const res = await createAssignment(
    jsonRequest("POST", `http://localhost/api/classes/${classId}/assignments`, idToken, {
      name: "Essay",
      points: 10,
      dueDate: "2099-12-31",
      ...body,
    }),
    { params: Promise.resolve({ classId }) }
  );
  if (!res) throw new Error("The create route returned no response.");
  return res;
}

function patch(idToken: string, body: Record<string, unknown>) {
  return patchAssignment(
    jsonRequest("PATCH", `http://localhost/api/classes/${classId}/assignments/${assignmentId}`, idToken, body),
    { params: Promise.resolve(ids) }
  );
}

function postSubmission(idToken: string, name = "essay.pdf") {
  const body = new FormData();
  body.append("file", pdf(name));
  return submit(
    new NextRequest(`http://localhost/api/classes/${classId}/assignments/${assignmentId}/submit`, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}` },
      body,
    }),
    { params: Promise.resolve(ids) }
  );
}

async function ownSubmissions(idToken: string) {
  const res = await getSubmissions(
    new NextRequest(`http://localhost/api/classes/${classId}/assignments/${assignmentId}/submit`, {
      headers: { authorization: `Bearer ${idToken}` },
    }),
    { params: Promise.resolve(ids) }
  );
  expect(res.status).toBe(200);
  return res.json();
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
  storage.list.mockReset().mockResolvedValue({ data: [], error: null });
  storage.createSignedUrl.mockReset().mockResolvedValue({
    data: { signedUrl: "https://files.example.com/signed" },
    error: null,
  });

  const professor = await createSignedInUser("prof@example.com", "professor");
  professorToken = professor.idToken;
  await getAdminDb().collection("classes").doc(classId).set({ name: "CS 6300", professor_id: professor.uid });

  // An assignment from before PANEL-113: no resubmission fields at all
  await assignmentDoc().set({ name: "Project 1", points: 100, dueDate: "2099-12-31" });
});

describe("lib/resubmission", () => {
  it("defaults to resubmission allowed with no limit", () => {
    expect(getAttemptLimit({})).toBeNull();
    expect(getAttemptLimit(undefined)).toBeNull();
    expect(getAttemptLimit({ allowResubmission: true, maxAttempts: 3 })).toBe(3);
    expect(getAttemptLimit({ allowResubmission: false, maxAttempts: 3 })).toBe(1);
  });

  it("counts attempts on submissions saved before attemptCount existed", () => {
    expect(countAttempts(undefined)).toBe(0);
    expect(countAttempts({ filePath: "a.pdf" })).toBe(1);
    expect(countAttempts({ filePath: "c.pdf", submissionHistory: [{ filePath: "b.pdf" }, { filePath: "c.pdf" }] })).toBe(2);
    expect(countAttempts({ attemptCount: 5, submissionHistory: [{ filePath: "c.pdf" }] })).toBe(5);
  });

  it.each([
    [{ allowResubmission: "no" }],
    [{ maxAttempts: 1 }],
    [{ maxAttempts: 0 }],
    [{ maxAttempts: 2.5 }],
    [{ maxAttempts: 101 }],
    [{ maxAttempts: "3" }],
  ])("rejects %o", (body) => {
    expect(parseResubmissionSettings(body).ok).toBe(false);
  });

  it("explains why a student can't submit again", () => {
    const submitted = { attemptCount: 1 };
    expect(resubmissionBlockedReason({ allowResubmission: false }, undefined)).toBeNull();
    expect(resubmissionBlockedReason({ allowResubmission: false }, submitted)).toMatch(/doesn't allow resubmissions/);
    expect(resubmissionBlockedReason({ maxAttempts: 2 }, submitted)).toBeNull();
    expect(resubmissionBlockedReason({ maxAttempts: 2 }, { attemptCount: 2 })).toBe(
      "You have used all 2 attempts for this assignment."
    );
  });
});

describe("POST /api/classes/[classId]/assignments resubmission settings", () => {
  it("allows resubmission with no limit unless the professor says otherwise", async () => {
    const res = await create(professorToken, {});

    expect(res.status).toBe(201);
    const { assignment } = await res.json();
    expect(assignment).toMatchObject({ allowResubmission: true, maxAttempts: null });
    expect((await assignmentDoc(assignment.id).get()).data()).toMatchObject({
      allowResubmission: true,
      maxAttempts: null,
    });
  });

  it("saves resubmission off, or an attempt limit", async () => {
    const off = await (await create(professorToken, { allowResubmission: false })).json();
    expect((await assignmentDoc(off.assignment.id).get()).data()).toMatchObject({ allowResubmission: false });

    const limited = await (await create(professorToken, { maxAttempts: 3 })).json();
    expect((await assignmentDoc(limited.assignment.id).get()).data()).toMatchObject({
      allowResubmission: true,
      maxAttempts: 3,
    });
  });

  it.each([[{ allowResubmission: "false" }], [{ maxAttempts: 1 }], [{ maxAttempts: -2 }]])(
    "returns 400 for %o and creates nothing",
    async (body) => {
      const res = await create(professorToken, body);

      expect(res.status).toBe(400);
      const all = await getAdminDb().collection("classes").doc(classId).collection("assignments").get();
      expect(all.size).toBe(1);
    }
  );
});

describe("PATCH /api/classes/[classId]/assignments/[assignmentId] resubmission settings", () => {
  it("turns resubmission off and on, and sets and clears a limit", async () => {
    expect((await patch(professorToken, { allowResubmission: false })).status).toBe(200);
    expect((await assignmentDoc().get()).data()).toMatchObject({ allowResubmission: false, name: "Project 1" });

    expect((await patch(professorToken, { allowResubmission: true, maxAttempts: 4 })).status).toBe(200);
    expect((await assignmentDoc().get()).data()).toMatchObject({ allowResubmission: true, maxAttempts: 4 });

    expect((await patch(professorToken, { maxAttempts: null })).status).toBe(200);
    expect((await assignmentDoc().get()).data()).toMatchObject({ maxAttempts: null });
  });

  it("returns 400 for a bad value and keeps the settings", async () => {
    await assignmentDoc().update({ allowResubmission: true, maxAttempts: 3 });

    for (const body of [{ allowResubmission: 0 }, { maxAttempts: 1 }, { maxAttempts: "five" }]) {
      expect((await patch(professorToken, body)).status).toBe(400);
    }
    expect((await assignmentDoc().get()).data()).toMatchObject({ allowResubmission: true, maxAttempts: 3 });
  });

  it("returns 403 for a student and saves nothing", async () => {
    const student = await createEnrolledStudent();

    expect((await patch(student.idToken, { allowResubmission: false })).status).toBe(403);
    expect((await assignmentDoc().get()).data()?.allowResubmission).toBeUndefined();
  });
});

describe("POST .../submit with resubmission settings", () => {
  it("keeps today's behaviour on an existing assignment: resubmission allowed", async () => {
    const student = await createEnrolledStudent();

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await postSubmission(student.idToken, `v${attempt}.pdf`)).status).toBe(201);
    }

    expect((await submissionDoc(student.uid).get()).data()).toMatchObject({ fileName: "v5.pdf", attemptCount: 5 });
    expect((await ownSubmissions(student.idToken)).attemptCount).toBe(5);
  });

  it("with resubmission off, accepts the first submission and refuses the next with 403", async () => {
    await assignmentDoc().update({ allowResubmission: false });
    const student = await createEnrolledStudent();

    expect((await postSubmission(student.idToken, "first.pdf")).status).toBe(201);
    storage.upload.mockClear();

    const res = await postSubmission(student.idToken, "second.pdf");

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "Your professor doesn't allow resubmissions for this assignment, and you have already submitted it."
    );
    // Refused before the upload, and the first submission stays
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await submissionDoc(student.uid).get()).data()).toMatchObject({ fileName: "first.pdf", attemptCount: 1 });
  });

  it("with maxAttempts set, refuses the attempt after the limit", async () => {
    await assignmentDoc().update({ allowResubmission: true, maxAttempts: 2 });
    const student = await createEnrolledStudent();

    expect((await postSubmission(student.idToken, "one.pdf")).status).toBe(201);
    expect((await postSubmission(student.idToken, "two.pdf")).status).toBe(201);

    const res = await postSubmission(student.idToken, "three.pdf");

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You have used all 2 attempts for this assignment.");
    expect((await submissionDoc(student.uid).get()).data()).toMatchObject({ fileName: "two.pdf", attemptCount: 2 });
  });

  it("counts every attempt, even after older files rotate out of the history", async () => {
    await assignmentDoc().update({ maxAttempts: 4 });
    const student = await createEnrolledStudent();

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect((await postSubmission(student.idToken, `v${attempt}.pdf`)).status).toBe(201);
    }
    const saved = (await submissionDoc(student.uid).get()).data();
    expect(saved?.submissionHistory).toHaveLength(3);
    expect(saved?.attemptCount).toBe(4);

    expect((await postSubmission(student.idToken, "v5.pdf")).status).toBe(403);
  });

  it("applies a professor turning resubmission off while the assignment is open", async () => {
    const student = await createEnrolledStudent();
    const other = await createEnrolledStudent("other@example.com");
    expect((await postSubmission(student.idToken)).status).toBe(201);

    expect((await patch(professorToken, { allowResubmission: false })).status).toBe(200);

    expect((await postSubmission(student.idToken)).status).toBe(403);
    // A student who hasn't submitted yet still gets their one submission
    expect((await postSubmission(other.idToken)).status).toBe(201);
    expect((await postSubmission(other.idToken)).status).toBe(403);
  });

  it("counts a submission saved before PANEL-113 as an attempt", async () => {
    await assignmentDoc().update({ allowResubmission: false });
    const student = await createEnrolledStudent();
    await submissionDoc(student.uid).set({
      studentId: student.uid,
      filePath: `${classId}/${assignmentId}/${student.uid}/old.pdf`,
      fileName: "old.pdf",
      submittedAt: "2026-11-01T12:00:00.000Z",
    });

    expect((await postSubmission(student.idToken)).status).toBe(403);
  });
});

// Exceptions (PANEL-114) only widen access: one that allows resubmitting
// lets its student past the class's resubmission setting.
describe("resubmission settings with a per-student exception", () => {
  async function grantException(studentUid: string, allowResubmit: boolean) {
    await assignmentDoc()
      .collection("exceptions")
      .doc(studentUid)
      .set({
        studentId: studentUid,
        dueDate: "2099-12-31",
        lateUntil: null,
        allowResubmit,
        reason: "Extension",
        grantedBy: "prof",
        grantedAt: "2026-11-20T12:00:00.000Z",
      });
  }

  it("lets a student with an exception that allows resubmitting resubmit after the class closes", async () => {
    const student = await createEnrolledStudent();
    await assignmentDoc().update({ allowResubmission: false });
    expect((await postSubmission(student.idToken, "first.pdf")).status).toBe(201);

    await assignmentDoc().update({ dueDate: "2020-01-01" });
    await grantException(student.uid, true);

    expect((await postSubmission(student.idToken, "second.pdf")).status).toBe(201);
    expect((await submissionDoc(student.uid).get()).data()).toMatchObject({ fileName: "second.pdf", attemptCount: 2 });
  });

  it("still applies the class setting while the class window is open", async () => {
    const student = await createEnrolledStudent();
    await assignmentDoc().update({ allowResubmission: false });
    await grantException(student.uid, true);
    expect((await postSubmission(student.idToken)).status).toBe(201);

    // The class rules let the student in, not the exception, so resubmission stays off
    expect((await postSubmission(student.idToken)).status).toBe(403);
  });

  it("refuses a resubmission when the exception doesn't allow it", async () => {
    const student = await createEnrolledStudent();
    expect((await postSubmission(student.idToken)).status).toBe(201);
    await assignmentDoc().update({ dueDate: "2020-01-01", maxAttempts: 5 });
    await grantException(student.uid, false);

    const res = await postSubmission(student.idToken);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "Your extension does not allow replacing a submission you have already made."
    );
  });
});
