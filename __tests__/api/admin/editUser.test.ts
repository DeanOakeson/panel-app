import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/users/[uid]/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { HOME_PATHS, getHomePath } from "@/lib/homePath";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

/**
 * Builds the PATCH request the way the admin user list page sends it, plus the
 * `{ params }` context Next hands the route (a promise in Next 15+).
 */
function patchUser(uid: string, body: unknown, idToken?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return PATCH(
    new NextRequest(`http://localhost/api/admin/users/${uid}`, {
      method: "PATCH",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ uid }) }
  );
}

function profile(uid: string) {
  return getAdminDb().collection("users").doc(uid).get();
}

let adminToken: string;

/** The admin's own uid, as the route sees it via their token. */
let adminUid: string;

beforeEach(async () => {
  await clearEmulators();

  const admin = await createSignedInUser("admin@example.com", "admin");
  adminToken = admin.idToken;
  adminUid = admin.uid;
});

describe("PATCH /api/admin/users/[uid]", () => {
  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, { name: "Renamed" });

      expect(res.status).toBe(401);
      expect((await profile(target.uid)).data()?.name).toBeUndefined();
    });

    it("returns 401 for a token the Auth emulator did not issue", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, { name: "Renamed" }, "not-a-real-token");

      expect(res.status).toBe(401);
      expect((await profile(target.uid)).data()?.name).toBeUndefined();
    });
  });

  describe("authorization", () => {
    it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
      const caller = await createSignedInUser(`${role}@example.com`, role);
      const target = await createSignedInUser("target@example.com", "student");

      const res = await patchUser(target.uid, { name: "Renamed" }, caller.idToken);

      expect(res.status).toBe(403);
      expect((await profile(target.uid)).data()?.name).toBeUndefined();
    });

    it("returns 403 when the caller has no users profile", async () => {
      const ghost = await createSignedInUser("ghost@example.com");
      const target = await createSignedInUser("target@example.com", "student");

      const res = await patchUser(target.uid, { name: "Renamed" }, ghost.idToken);

      expect(res.status).toBe(403);
    });
  });

  describe("editing", () => {
    it("renames a user and reports the stored profile", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, { name: "  Ada Lovelace  " }, adminToken);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        success: true,
        uid: target.uid,
        name: "Ada Lovelace",
        email: "student@example.com",
        role: "student",
      });
      expect((await profile(target.uid)).data()).toMatchObject({
        name: "Ada Lovelace",
        role: "student",
      });
    });

    it("changes the role and the read-back shows it", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, { role: "professor" }, adminToken);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ role: "professor" });
      expect((await profile(target.uid)).data()?.role).toBe("professor");
    });

    it("accepts a role in any case with surrounding space", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, { role: " Professor " }, adminToken);

      expect(res.status).toBe(200);
      expect((await profile(target.uid)).data()?.role).toBe("professor");
    });

    it("leaves fields it was not given alone", async () => {
      const target = await createSignedInUser("student@example.com", "student");
      await getAdminDb()
        .collection("users")
        .doc(target.uid)
        .set({ name: "Grace", major: "CS" }, { merge: true });

      const res = await patchUser(target.uid, { role: "professor" }, adminToken);

      expect(res.status).toBe(200);
      expect((await profile(target.uid)).data()).toMatchObject({
        name: "Grace",
        major: "CS",
        role: "professor",
      });
    });

    it("returns 404 for an unknown uid", async () => {
      const res = await patchUser("no-such-uid", { name: "Nobody" }, adminToken);

      expect(res.status).toBe(404);
    });
  });

  describe("role guardrails", () => {
    it.each(["admin", "ADMIN", " Admin ", "janitor", "", "studnet"])(
      "refuses the role %j",
      async (role) => {
        const target = await createSignedInUser("student@example.com", "student");

        const res = await patchUser(target.uid, { role }, adminToken);

        expect(res.status).toBe(400);
        expect((await profile(target.uid)).data()?.role).toBe("student");
      }
    );

    it("refuses to change the admin's own role", async () => {
      const res = await patchUser(adminUid, { role: "student" }, adminToken);

      expect(res.status).toBe(400);
      expect((await profile(adminUid)).data()?.role).toBe("admin");
    });

    it("still lets an admin rename themselves", async () => {
      const res = await patchUser(adminUid, { name: "K. Pett" }, adminToken);

      expect(res.status).toBe(200);
      expect((await profile(adminUid)).data()).toMatchObject({
        name: "K. Pett",
        role: "admin",
      });
    });
  });

  describe("professorStatus on promotion", () => {
    // An admin moving someone into `professor` is the approval itself; the
    // status has to follow or the user is a professor who still looks pending.
    it.each(["pending", "rejected", "not_requested", undefined])(
      "sets professorStatus to approved when promoting from %j",
      async (professorStatus) => {
        const target = await createSignedInUser("stud@example.com", "student");
        if (professorStatus !== undefined) {
          await getAdminDb()
            .collection("users")
            .doc(target.uid)
            .set({ professorStatus }, { merge: true });
        }

        const res = await patchUser(target.uid, { role: "professor" }, adminToken);

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({
          role: "professor",
          professorStatus: "approved",
        });
        expect((await profile(target.uid)).data()).toMatchObject({
          role: "professor",
          professorStatus: "approved",
        });
      }
    );

    it("no longer routes a promoted user to /pending-approval", async () => {
      // The concrete failure the review pointed at: a pending applicant
      // promoted here stayed `pending`, so lib/homePath.ts kept sending them to
      // the approval queue and Reject there demoted them back to student.
      const target = await createSignedInUser("stud@example.com", "student");
      await getAdminDb()
        .collection("users")
        .doc(target.uid)
        .set({ professorStatus: "pending" }, { merge: true });

      await patchUser(target.uid, { role: "professor" }, adminToken);

      const stored = (await profile(target.uid)).data();
      expect(
        getHomePath({ role: stored?.role, professorStatus: stored?.professorStatus })
      ).toBe(HOME_PATHS.professor);
    });

    it("leaves professorStatus alone on a name-only edit of a professor", async () => {
      const target = await createSignedInUser("prof@example.com", "professor");
      await getAdminDb()
        .collection("users")
        .doc(target.uid)
        .set({ professorStatus: "approved" }, { merge: true });

      const res = await patchUser(target.uid, { name: "Renamed" }, adminToken);

      expect(res.status).toBe(200);
      expect((await profile(target.uid)).data()?.professorStatus).toBe("approved");
    });
  });

  describe("professorStatus on demotion", () => {
    it.each(["pending", "approved"])(
      "resets a %s professorStatus when demoting to student",
      async (professorStatus) => {
        const target = await createSignedInUser("prof@example.com", "professor");
        await getAdminDb()
          .collection("users")
          .doc(target.uid)
          .set({ professorStatus }, { merge: true });

        const res = await patchUser(target.uid, { role: "student" }, adminToken);

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({
          role: "student",
          professorStatus: "not_requested",
        });
        expect((await profile(target.uid)).data()).toMatchObject({
          role: "student",
          professorStatus: "not_requested",
        });
      }
    );

    it.each(["not_requested", "rejected", undefined])(
      "leaves a %j professorStatus untouched when demoting",
      async (professorStatus) => {
        const target = await createSignedInUser("prof@example.com", "professor");
        if (professorStatus !== undefined) {
          await getAdminDb()
            .collection("users")
            .doc(target.uid)
            .set({ professorStatus }, { merge: true });
        }

        const res = await patchUser(target.uid, { role: "student" }, adminToken);

        expect(res.status).toBe(200);
        expect((await profile(target.uid)).data()).toMatchObject({
          role: "student",
          ...(professorStatus === undefined ? {} : { professorStatus }),
        });
      }
    );

    it("does not touch professorStatus when the role is unchanged", async () => {
      const target = await createSignedInUser("prof@example.com", "professor");
      await getAdminDb()
        .collection("users")
        .doc(target.uid)
        .set({ professorStatus: "approved" }, { merge: true });

      const res = await patchUser(target.uid, { name: "Renamed" }, adminToken);

      expect(res.status).toBe(200);
      expect((await profile(target.uid)).data()?.professorStatus).toBe("approved");
    });
  });

  describe("request validation", () => {
    it("returns 400 for a body that is not an object", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, "[]", adminToken);

      expect(res.status).toBe(400);
    });

    it("returns 400 when neither name nor role is given", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, { major: "CS" }, adminToken);

      expect(res.status).toBe(400);
      expect((await profile(target.uid)).data()?.major).toBeUndefined();
    });

    it.each(["email", "password", "uid", "professorStatus"])(
      "returns 400 when the body tries to set the read-only field %s",
      async (field) => {
        const target = await createSignedInUser("student@example.com", "student");

        const res = await patchUser(target.uid, { name: "Ok", [field]: "x" }, adminToken);

        expect(res.status).toBe(400);
        expect((await profile(target.uid)).data()).toMatchObject({ role: "student" });
      }
    );

    it("returns 400 for a blank or oversized name", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      expect((await patchUser(target.uid, { name: "   " }, adminToken)).status).toBe(400);
      expect(
        (await patchUser(target.uid, { name: "x".repeat(201) }, adminToken)).status
      ).toBe(400);
      expect((await profile(target.uid)).data()?.name).toBeUndefined();
    });

    it("returns 400 for malformed JSON", async () => {
      const target = await createSignedInUser("student@example.com", "student");

      const res = await patchUser(target.uid, "{", adminToken);

      expect(res.status).toBe(400);
    });
  });
});
