import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/admin/users/[uid]/route";
import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

/**
 * Orphan-path coverage for the user-delete cascade, found by re-reading the
 * write paths after the first review round. The original cascade collected the
 * user's submissions by walking `users/{uid}/classes/*` first, which assumes the
 * user is still enrolled in every class whose assignments they submitted. The
 * admin unenroll route (`app/api/admin/classes/[classId]/enrollments/[studentId]`)
 * deletes only the enrollment mirror and explicitly leaves submissions behind,
 * so the assumption breaks on the ordinary enroll -> submit -> unenroll ->
 * delete sequence, and the collectionGroup sweep in the main delete test could
 * not see it because that test never unenrolls.
 */

function deleteUser(uid: string, idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return DELETE(
    new NextRequest(`http://localhost/api/admin/users/${uid}`, {
      method: "DELETE",
      headers,
    }),
    { params: Promise.resolve({ uid }) }
  );
}

const db = () => getAdminDb();

let adminToken: string;
let adminUid: string;

beforeEach(async () => {
  await clearEmulators();
  vi.restoreAllMocks();

  const admin = await createSignedInUser("admin@example.com", "admin");
  adminToken = admin.idToken;
  adminUid = admin.uid;
});

async function seedClassWithAssignment(classId: string) {
  await db()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: adminUid });
  await db()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc("a1")
    .set({ title: "Homework 1" });
}

async function seedEnrollMirror(uid: string, classId: string) {
  await db()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .doc(classId)
    .set({ class_id: classId });
}

async function seedSubmission(uid: string, classId: string, content: string) {
  // `studentId` mirrors what the submit route writes
  // (`.../submit/route.ts` sets studentId alongside the file fields); the
  // cascade's uid sweep depends on it being there.
  await db()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc("a1")
    .collection("submissions")
    .doc(uid)
    .set({ content, studentId: uid });
}

async function seedGrade(uid: string, classId: string) {
  await db()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc("a1")
    .collection("grades")
    .doc(uid)
    .set({
      studentId: uid,
      classId,
      assignmentId: "a1",
      score: 9,
      feedback: "ok",
      submittedAt: "2026-01-01T00:00:00.000Z",
      gradedBy: adminUid,
      gradedAt: "2026-01-02T00:00:00.000Z",
    });
}

async function seedMissingGrade(uid: string, classId: string) {
  await db()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc("a1")
    .collection("missingGrades")
    .doc(uid)
    .set({
      studentId: uid,
      classId,
      assignmentId: "a1",
      score: 0,
      feedback: "Missing",
      gradedBy: adminUid,
      gradedAt: "2026-01-02T00:00:00.000Z",
    });
}

describe("DELETE /api/admin/users/[uid] cascade — orphan paths", () => {
  it("removes a submission left behind by an earlier unenroll", async () => {
    // enroll -> submit -> unenroll -> delete user
    const target = await createSignedInUser("student@example.com", "student");
    await seedClassWithAssignment("class-1");
    await seedEnrollMirror(target.uid, "class-1");
    await seedSubmission(target.uid, "class-1", "done");

    // What the admin unenroll route actually deletes: the mirror only.
    await db()
      .collection("users")
      .doc(target.uid)
      .collection("classes")
      .doc("class-1")
      .delete();

    const res = await deleteUser(target.uid, adminToken);

    expect(res.status).toBe(200);

    const stragglers = await db()
      .collectionGroup("submissions")
      .where("content", "==", "done")
      .get();

    // Fail first: the submissions walk only covers currently-enrolled classes.
    expect(stragglers.empty).toBe(true);
  });

  it("removes the graded user's grade doc", async () => {
    const target = await createSignedInUser("student@example.com", "student");
    await seedClassWithAssignment("class-1");
    await seedEnrollMirror(target.uid, "class-1");
    await seedSubmission(target.uid, "class-1", "done");
    await seedGrade(target.uid, "class-1");

    const res = await deleteUser(target.uid, adminToken);

    expect(res.status).toBe(200);

    const grade = await db()
      .collection("classes")
      .doc("class-1")
      .collection("assignments")
      .doc("a1")
      .collection("grades")
      .doc(target.uid)
      .get();

    expect(grade.exists).toBe(false);
  });

  it("reports the grade docs it removed", async () => {
    const target = await createSignedInUser("student@example.com", "student");
    await seedClassWithAssignment("class-1");
    await seedEnrollMirror(target.uid, "class-1");
    await seedSubmission(target.uid, "class-1", "done");
    await seedGrade(target.uid, "class-1");

    const res = await deleteUser(target.uid, adminToken);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ removedGrades: 1 });
  });

  it("removes a grade whose submission was already replaced", async () => {
    const target = await createSignedInUser("student@example.com", "student");
    await seedClassWithAssignment("class-1");
    await seedEnrollMirror(target.uid, "class-1");
    await seedGrade(target.uid, "class-1"); // no live submission doc
    await deleteUser(target.uid, adminToken);

    const stragglers = await db()
      .collectionGroup("grades")
      .where("studentId", "==", target.uid)
      .get();

    expect(stragglers.empty).toBe(true);
  });

  it("removes the user's missing-work grades, enrolled or not, and reports them", async () => {
    const target = await createSignedInUser("student@example.com", "student");
    await seedClassWithAssignment("class-1");
    await seedClassWithAssignment("class-2");
    await seedEnrollMirror(target.uid, "class-1");
    await seedMissingGrade(target.uid, "class-1");
    await seedMissingGrade(target.uid, "class-2"); // not enrolled in class-2

    const res = await deleteUser(target.uid, adminToken);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ removedMissingGrades: 2 });

    const stragglers = await db()
      .collectionGroup("missingGrades")
      .where("studentId", "==", target.uid)
      .get();

    expect(stragglers.empty).toBe(true);
  });

  it("removes the history under the user's grades and missing-work grades", async () => {
    const target = await createSignedInUser("student@example.com", "student");
    await seedClassWithAssignment("class-1");
    await seedEnrollMirror(target.uid, "class-1");
    await seedSubmission(target.uid, "class-1", "done");
    await seedGrade(target.uid, "class-1");
    await seedMissingGrade(target.uid, "class-1");

    const assignment = db().collection("classes").doc("class-1").collection("assignments").doc("a1");
    const entry = { score: 0, feedback: "", savedBy: adminUid, savedAt: "2026-01-02T00:00:00.000Z", action: "created" };
    await assignment.collection("grades").doc(target.uid).collection("history").add(entry);
    await assignment.collection("missingGrades").doc(target.uid).collection("history").add(entry);

    const res = await deleteUser(target.uid, adminToken);

    expect(res.status).toBe(200);
    const [gradeHistory, missingGradeHistory] = await Promise.all([
      assignment.collection("grades").doc(target.uid).collection("history").get(),
      assignment.collection("missingGrades").doc(target.uid).collection("history").get(),
    ]);
    expect(gradeHistory.empty).toBe(true);
    expect(missingGradeHistory.empty).toBe(true);
  });

  it("finishes the cleanup on retry after deleting history fails part way", async () => {
    // Not enrolled, so a retry can only find the grades by their studentId
    const target = await createSignedInUser("student@example.com", "student");
    await seedClassWithAssignment("class-1");
    await seedGrade(target.uid, "class-1");
    await seedMissingGrade(target.uid, "class-1");

    const assignment = db().collection("classes").doc("class-1").collection("assignments").doc("a1");
    const gradeRef = assignment.collection("grades").doc(target.uid);
    const missingGradeRef = assignment.collection("missingGrades").doc(target.uid);
    const entry = { score: 0, feedback: "", savedBy: adminUid, action: "created" };
    for (const ref of [gradeRef, missingGradeRef]) {
      await ref.collection("history").add({ ...entry, savedAt: "2026-01-02T00:00:00.000Z" });
      await ref.collection("history").add({ ...entry, savedAt: "2026-01-03T00:00:00.000Z" });
    }

    // The first delete removes one document of its target, then fails
    vi.spyOn(db(), "recursiveDelete").mockImplementationOnce((async (
      ref: DocumentReference | CollectionReference
    ) => {
      if ("doc" in ref) {
        await (await ref.limit(1).get()).docs[0]?.ref.delete();
      } else {
        await ref.delete();
      }

      throw new Error("Interrupted");
    }) as ReturnType<typeof db>["recursiveDelete"]);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const interrupted = await deleteUser(target.uid, adminToken);

    expect(interrupted.status).toBe(500);
    expect((await gradeRef.get()).exists).toBe(true);
    expect((await missingGradeRef.get()).exists).toBe(true);

    const retried = await deleteUser(target.uid, adminToken);

    expect(retried.status).toBe(200);
    const remaining = await Promise.all([
      gradeRef.get(),
      missingGradeRef.get(),
      gradeRef.collection("history").get(),
      missingGradeRef.collection("history").get(),
    ]);
    expect(remaining.map((snapshot) => ("exists" in snapshot ? snapshot.exists : !snapshot.empty))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
