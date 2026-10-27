import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/admin/users/[uid]/route";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

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

async function authAccountExists(uid: string) {
  try {
    await getAdminAuth().getUser(uid);
    return true;
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "auth/user-not-found") return false;
    throw err;
  }
}

let adminToken: string;
let adminUid: string;

beforeEach(async () => {
  await clearEmulators();

  const admin = await createSignedInUser("admin@example.com", "admin");
  adminToken = admin.idToken;
  adminUid = admin.uid;
});

/**
 * Seeds `classes/class-1` with the deleted user enrolled and holding one
 * submission, the shape the submit route writes
 * (`classes/{classId}/assignments/{assignmentId}/submissions/{uid}`).
 */
async function seedEnrollmentAndSubmission(uid: string, classId = "class-1") {
  await db()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: adminUid });
  await db()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .doc(classId)
    .set({ class_id: classId });
  await db()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc("a1")
    .set({ title: "Homework 1" });
  await db()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc("a1")
    .collection("submissions")
    .doc(uid)
    .set({ content: "done" });
}

describe("DELETE /api/admin/users/[uid]", () => {
  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await deleteUser(target.uid);

      expect(res.status).toBe(401);
      expect(await authAccountExists(target.uid)).toBe(true);
      expect((await db().collection("users").doc(target.uid).get()).exists).toBe(true);
    });

    it("returns 401 for a token the Auth emulator did not issue", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await deleteUser(target.uid, "not-a-real-token");

      expect(res.status).toBe(401);
      expect(await authAccountExists(target.uid)).toBe(true);
    });
  });

  describe("authorization", () => {
    it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
      const caller = await createSignedInUser(`${role}@example.com`, role);
      const target = await createSignedInUser("target@example.com", "student");

      const res = await deleteUser(target.uid, caller.idToken);

      expect(res.status).toBe(403);
      expect(await authAccountExists(target.uid)).toBe(true);
    });

    it("refuses to delete the admin's own account", async () => {
      const res = await deleteUser(adminUid, adminToken);

      expect(res.status).toBe(403);
      expect(await authAccountExists(adminUid)).toBe(true);
      expect((await db().collection("users").doc(adminUid).get()).exists).toBe(true);
    });
  });

  it("returns 404 when neither the profile nor the Auth account exists", async () => {
    const res = await deleteUser("no-such-uid", adminToken);

    expect(res.status).toBe(404);
  });

  describe("on success", () => {
    it("removes the Auth account and the profile", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await deleteUser(target.uid, adminToken);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        success: true,
        deleted: target.uid,
      });
      expect(await authAccountExists(target.uid)).toBe(false);
      expect((await db().collection("users").doc(target.uid).get()).exists).toBe(false);
    });

    it("removes enrollment mirrors and submissions with no orphans left", async () => {
      const target = await createSignedInUser("student@example.com", "student");
      await seedEnrollmentAndSubmission(target.uid);

      const res = await deleteUser(target.uid, adminToken);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        removedEnrollments: 1,
        removedSubmissions: 1,
      });

      const mirrors = await db()
        .collection("users")
        .doc(target.uid)
        .collection("classes")
        .get();
      expect(mirrors.empty).toBe(true);
      expect((await db().collection("users").doc(target.uid).get()).exists).toBe(false);

      const submissions = await db()
        .collection("classes")
        .doc("class-1")
        .collection("assignments")
        .doc("a1")
        .collection("submissions")
        .get();
      expect(submissions.empty).toBe(true);

      // Nothing anywhere still points at the removed uid.
      const stragglers = await db()
        .collectionGroup("submissions")
        .where("content", "==", "done")
        .get();
      expect(stragglers.empty).toBe(true);
    });

    it("leaves a class the user taught in place", async () => {
      const professor = await createSignedInUser("prof@example.com", "professor");
      await db()
        .collection("classes")
        .doc("class-taught")
        .set({ name: "CS 6470", professor_id: professor.uid });

      const res = await deleteUser(professor.uid, adminToken);

      expect(res.status).toBe(200);
      const taught = await db().collection("classes").doc("class-taught").get();
      expect(taught.exists).toBe(true);
      expect(taught.data()?.professor_id).toBe(professor.uid);
    });

    it("does not touch other users' enrollments or profiles", async () => {
      const target = await createSignedInUser("student@example.com", "student");
      const other = await createSignedInUser("other@example.com", "student");
      await seedEnrollmentAndSubmission(target.uid);
      await seedEnrollmentAndSubmission(other.uid);
      await db()
        .collection("classes")
        .doc("class-1")
        .collection("assignments")
        .doc("a1")
        .collection("submissions")
        .doc(other.uid)
        .set({ content: "also done" });

      const res = await deleteUser(target.uid, adminToken);

      expect(res.status).toBe(200);
      expect((await db().collection("users").doc(other.uid).get()).exists).toBe(true);
      expect(
        (
          await db()
            .collection("users")
            .doc(other.uid)
            .collection("classes")
            .doc("class-1")
            .get()
        ).exists
      ).toBe(true);
      expect(
        (
          await db()
            .collection("classes")
            .doc("class-1")
            .collection("assignments")
            .doc("a1")
            .collection("submissions")
            .doc(other.uid)
            .get()
        ).exists
      ).toBe(true);
    });

    it("deletes the profile when only the profile exists (no Auth account)", async () => {
      const orphanUid = "profile-only-uid";
      await db()
        .collection("users")
        .doc(orphanUid)
        .set({ email: "orphan@example.com", role: "student" });

      const res = await deleteUser(orphanUid, adminToken);

      expect(res.status).toBe(200);
      expect((await db().collection("users").doc(orphanUid).get()).exists).toBe(false);
    });

    it("deletes the Auth account when the profile is already gone", async () => {
      const target = await createSignedInUser("student@example.com", "student");
      await db().collection("users").doc(target.uid).delete();

      const res = await deleteUser(target.uid, adminToken);

      expect(res.status).toBe(200);
      expect(await authAccountExists(target.uid)).toBe(false);
    });

    it("reports every enrollment mirror it removed", async () => {
      const target = await createSignedInUser("student@example.com", "student");
      await seedEnrollmentAndSubmission(target.uid, "class-1");
      await seedEnrollmentAndSubmission(target.uid, "class-2");

      const res = await deleteUser(target.uid, adminToken);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        removedEnrollments: 2,
        removedSubmissions: 2,
      });
    });
  });
});
