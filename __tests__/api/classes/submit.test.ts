import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/classes/[classId]/assignments/[assignmentId]/submit/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const storage = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ storage: { from: storage.from } }),
}));

const classId = "class-1";
const assignmentId = "assignment-1";

function assignmentDoc() {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
}

function submissionDoc(studentUid: string) {
  return assignmentDoc().collection("submissions").doc(studentUid);
}

function pdf(name = "essay.pdf", size = 2048) {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function postSubmission(file: File | null, idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const body = new FormData();
  if (file) body.append("file", file);

  return POST(
    new NextRequest(
      `http://localhost/api/classes/${classId}/assignments/${assignmentId}/submit`,
      { method: "POST", headers, body }
    ),
    { params: Promise.resolve({ classId, assignmentId }) }
  );
}

/** Creates a signed-in student enrolled in the class. */
async function createEnrolledStudent() {
  const student = await createSignedInUser("student@example.com", "student");
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
  storage.from.mockReset().mockReturnValue(storage);
  storage.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  storage.remove.mockReset().mockResolvedValue({ data: [], error: null });

  const owner = await createSignedInUser("owner@example.com", "professor");
  ownerToken = owner.idToken;

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: owner.uid });
  await assignmentDoc().set({ name: "Project 1", points: 100, dueDate: "2099-12-31" });
});

describe("POST /api/classes/[classId]/assignments/[assignmentId]/submit", () => {
  it("returns 401 without a token", async () => {
    const res = await postSubmission(pdf());

    expect(res.status).toBe(401);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("returns 403 for the class's professor", async () => {
    const res = await postSubmission(pdf(), ownerToken);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/only students/i);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("returns 403 for a student who is not enrolled in the class", async () => {
    const { uid, idToken } = await createSignedInUser("student@example.com", "student");

    const res = await postSubmission(pdf(), idToken);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not enrolled/i);
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await submissionDoc(uid).get()).exists).toBe(false);
  });

  it("returns 403 after the due date", async () => {
    const { uid, idToken } = await createEnrolledStudent();
    await assignmentDoc().update({ dueDate: "2020-01-01" });

    const res = await postSubmission(pdf(), idToken);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/due date has passed/i);
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await submissionDoc(uid).get()).exists).toBe(false);
  });

  it.each([
    { label: "no file", file: null },
    { label: "an empty file", file: pdf("empty.pdf", 0) },
    { label: "a file over 10 MB", file: pdf("big.pdf", 10 * 1024 * 1024 + 1) },
    {
      label: "a file type that is not allowed",
      file: new File(["echo hi"], "run.sh", { type: "application/x-sh" }),
    },
  ])("returns 400 for $label", async ({ file }) => {
    const { uid, idToken } = await createEnrolledStudent();

    const res = await postSubmission(file, idToken);

    expect(res.status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await submissionDoc(uid).get()).exists).toBe(false);
  });

  it("uploads the file and saves the submission without grade fields", async () => {
    const { uid, idToken } = await createEnrolledStudent();

    const res = await postSubmission(pdf("my essay.pdf"), idToken);

    expect(res.status).toBe(201);
    expect(storage.from).toHaveBeenCalledWith("assignment-submissions");
    const [uploadedPath, uploadedBody, uploadOptions] = storage.upload.mock.calls[0];
    expect(uploadedPath).toMatch(
      new RegExp(`^${classId}/${assignmentId}/${uid}/\\d+-my_essay\\.pdf$`)
    );
    expect(uploadedBody).toHaveLength(2048);
    expect(uploadOptions).toEqual({ contentType: "application/pdf", upsert: false });

    expect((await submissionDoc(uid).get()).data()).toEqual({
      studentId: uid,
      filePath: uploadedPath,
      fileName: "my essay.pdf",
      fileType: "application/pdf",
      fileSize: 2048,
      submittedAt: expect.any(String),
      status: "submitted",
    });
  });

  it("leaves an existing grade in the grades collection on resubmission", async () => {
    const { uid, idToken } = await createEnrolledStudent();
    await postSubmission(pdf("first.pdf"), idToken);
    const grade = {
      score: 90,
      feedback: "Good",
      gradedBy: "owner",
      gradedAt: "2026-11-02T09:00:00.000Z",
    };
    await assignmentDoc().collection("grades").doc(uid).set(grade);

    const res = await postSubmission(pdf(), idToken);

    expect(res.status).toBe(201);
    expect((await assignmentDoc().collection("grades").doc(uid).get()).data()).toEqual(grade);
    expect((await submissionDoc(uid).get()).data()).toMatchObject({ fileName: "essay.pdf" });
    expect((await submissionDoc(uid).get()).data()).not.toHaveProperty("grade");
  });

  it("returns 500 and saves nothing when the upload fails", async () => {
    const { uid, idToken } = await createEnrolledStudent();
    storage.upload.mockResolvedValue({ data: null, error: new Error("Storage is down") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await postSubmission(pdf(), idToken);

    expect(res.status).toBe(500);
    expect((await submissionDoc(uid).get()).exists).toBe(false);
  });
});
