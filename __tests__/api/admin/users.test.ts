import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/users/route";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const validBody = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "student",
  password: "secret123",
};

function postUser(body: unknown, idToken?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return POST(
    new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

async function expectNoAccount(email: string) {
  await expect(getAdminAuth().getUserByEmail(email)).rejects.toMatchObject({
    code: "auth/user-not-found",
  });
}

async function accountCount() {
  return (await getAdminAuth().listUsers()).users.length;
}

beforeEach(clearEmulators);

describe("POST /api/admin/users", () => {
  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const res = await postUser(validBody);

      expect(res.status).toBe(401);
      await expectNoAccount(validBody.email);
    });

    it("returns 401 for a token the Auth emulator did not issue", async () => {
      const res = await postUser(validBody, "not-a-real-token");

      expect(res.status).toBe(401);
      await expectNoAccount(validBody.email);
    });
  });

  describe("authorization", () => {
    it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
      const { idToken } = await createSignedInUser(`${role}@example.com`, role);

      const res = await postUser(validBody, idToken);

      expect(res.status).toBe(403);
      await expectNoAccount(validBody.email);
    });

    it("returns 403 for a signed-in user with no profile", async () => {
      const { idToken } = await createSignedInUser("no-profile@example.com");

      const res = await postUser(validBody, idToken);

      expect(res.status).toBe(403);
      await expectNoAccount(validBody.email);
    });
  });

  describe("as an admin", () => {
    let idToken: string;

    beforeEach(async () => {
      ({ idToken } = await createSignedInUser("admin@example.com", "admin"));
    });

    it.each([
      ["a blank name", { ...validBody, name: "   " }],
      ["a malformed email", { ...validBody, email: "not-an-email" }],
      ["an unknown role", { ...validBody, role: "teacher" }],
      ["a password under 6 characters", { ...validBody, password: "12345" }],
    ])("returns 400 for %s", async (_, body) => {
      const res = await postUser(body, idToken);

      expect(res.status).toBe(400);
      expect(await accountCount()).toBe(1);
    });

    it("returns 400 for a body that is not JSON", async () => {
      const res = await postUser("{not json", idToken);

      expect(res.status).toBe(400);
      expect(await accountCount()).toBe(1);
    });

    it.each(["admin", "ADMIN", " Admin "])(
      "refuses to assign the role %j",
      async (role) => {
        const res = await postUser({ ...validBody, role }, idToken);

        expect(res.status).toBe(400);
        expect(await accountCount()).toBe(1);
        const admins = await getAdminDb()
          .collection("users")
          .where("role", "==", "admin")
          .get();
        expect(admins.size).toBe(1);
      }
    );

    it("creates the Auth account and users profile", async () => {
      const res = await postUser(
        { ...validBody, email: "  Ada@Example.COM ", role: "Professor" },
        idToken
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        email: "ada@example.com",
        role: "professor",
      });

      const account = await getAdminAuth().getUser(body.uid);
      expect(account).toMatchObject({
        email: "ada@example.com",
        displayName: "Ada Lovelace",
      });

      const profile = await getAdminDb().collection("users").doc(body.uid).get();
      expect(profile.data()).toMatchObject({
        name: "Ada Lovelace",
        email: "ada@example.com",
        role: "professor",
      });
    });

    it("returns 409 for an email that already has an account", async () => {
      const { uid } = await createSignedInUser(validBody.email, "student");

      const res = await postUser({ ...validBody, role: "professor" }, idToken);

      expect(res.status).toBe(409);
      const profile = await getAdminDb().collection("users").doc(uid).get();
      expect(profile.data()?.role).toBe("student");
    });
  });
});
